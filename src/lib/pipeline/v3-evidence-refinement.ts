import type { ContentUnits, RawChapter } from "@/types/schema"
import type { LLMClient } from "@/lib/llm-client"
import { hasExactMentionLocation, resolveMentionLocation } from "@/lib/mention-locations"
import { formatJsonParam, normalizePidKey } from "@/lib/prompt-loader"
import type {
  V3EvidenceArtifact,
  V3EvidenceCandidate,
  V3EvidenceCandidateType,
} from "@/lib/pipeline/v3-evidence-types"
import {
  normalizeRefinementStatus,
  normalizeRejectionReason,
  V3_EVIDENCE_REFINEMENT_PROFILE,
  type V3EvidenceRefinementArtifact,
  type V3ObjectiveRejectionReason,
  type V3RefinedEvidenceCandidate,
  type V3RefinementAction,
  type V3RejectedEvidenceCandidate,
  type V3RejectedEvidenceReason,
} from "@/lib/pipeline/v3-evidence-refinement-types"
import { isV3EvidenceCandidateType } from "@/lib/pipeline/v3-evidence-types"
import { sourcesCompatibleWithRefinedType } from "@/lib/pipeline/v3-evidence-refinement-core"

const SOURCE_STAGE_IDS = ["EVID.1A", "EVID.1B", "EVID.1C", "EVID.1D"] as const
const V3_REFINEMENT_BATCH_PARAGRAPHS = 4
const V3_REFINEMENT_BATCH_CHARS = 3000
const V3_REFINEMENT_PARALLELISM = 4

interface RawRefinedCandidate {
  source_candidate_ids?: unknown
  candidate_type?: unknown
  status?: unknown
  actions?: unknown
  pid?: unknown
  span?: unknown
  start_char?: unknown
  end_char?: unknown
  normalized?: unknown
  label?: unknown
  subject_hint?: unknown
  object_hint?: unknown
  owner_span?: unknown
  target_span?: unknown
  cue_span?: unknown
  goal_text?: unknown
  cause_text?: unknown
  effect_text?: unknown
  rationale?: unknown
  confidence?: unknown
}

interface RawRejectedCandidate {
  source_candidate_id?: unknown
  reason?: unknown
  original_reason?: unknown
}

interface BatchResult {
  refined: V3RefinedEvidenceCandidate[]
  rejected: V3RejectedEvidenceCandidate[]
}

function narrativeParagraphsFromContentUnits(
  chapter: RawChapter,
  classifyLog: ContentUnits,
): RawChapter["paragraphs"] {
  const narrativePids = new Set(
    classifyLog.units
      .filter((unit) => unit.is_story_text)
      .map((unit) => normalizePidKey(unit.pid)),
  )

  return chapter.paragraphs.filter((paragraph) =>
    narrativePids.has(normalizePidKey(paragraph.pid)),
  )
}

function chunkParagraphs(paragraphs: RawChapter["paragraphs"]): Array<RawChapter["paragraphs"]> {
  const batches: Array<RawChapter["paragraphs"]> = []
  let current: RawChapter["paragraphs"] = []
  let currentChars = 0

  for (const paragraph of paragraphs) {
    const wouldOverflowCount = current.length >= V3_REFINEMENT_BATCH_PARAGRAPHS
    const wouldOverflowChars =
      current.length > 0 && currentChars + paragraph.text.length > V3_REFINEMENT_BATCH_CHARS

    if (wouldOverflowCount || wouldOverflowChars) {
      batches.push(current)
      current = []
      currentChars = 0
    }

    current.push(paragraph)
    currentChars += paragraph.text.length
  }

  if (current.length > 0) batches.push(current)
  return batches
}

function isLikelyTruncatedJsonError(error: unknown): boolean {
  const message = error instanceof Error
    ? `${error.message} ${String((error as { cause?: unknown }).cause ?? "")}`
    : String(error)

  return /Unexpected end of JSON input|finish_reason=length|truncated|unterminated/i.test(message)
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await worker(items[index], index)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()),
  )

  return results
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function sourceIdsFromRaw(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter((id): id is string => typeof id === "string" && id.trim().length > 0)))
}

function actionsFromRaw(value: unknown): V3RefinementAction[] {
  if (!Array.isArray(value)) return []
  const allowed = new Set<V3RefinementAction>([
    "merged",
    "span_corrected",
    "type_corrected",
    "normalized",
  ])
  return Array.from(new Set(value.filter((action): action is V3RefinementAction => allowed.has(action))))
}

function addOptionalText(
  target: V3RefinedEvidenceCandidate,
  key: keyof Pick<
    V3RefinedEvidenceCandidate,
    | "normalized"
    | "label"
    | "subject_hint"
    | "object_hint"
    | "owner_span"
    | "target_span"
    | "cue_span"
    | "goal_text"
    | "cause_text"
    | "effect_text"
    | "rationale"
  >,
  value: unknown,
): void {
  const text = textValue(value)
  if (text) target[key] = text
}

function sourceCandidatesFromArtifacts(artifacts: V3EvidenceArtifact[]): V3EvidenceCandidate[] {
  return artifacts.flatMap((artifact) => artifact.candidates)
}

function buildFallbackCandidate(source: V3EvidenceCandidate): V3RefinedEvidenceCandidate {
  return {
    refined_candidate_id: "",
    source_candidate_ids: [source.candidate_id],
    candidate_type: source.candidate_type,
    status: "kept_context",
    actions: [],
    pid: source.pid,
    span: source.span,
    start_char: source.start_char,
    end_char: source.end_char,
    normalized: source.normalized,
    label: source.label,
    subject_hint: source.subject_hint,
    object_hint: source.object_hint,
    owner_span: source.owner_span,
    target_span: source.target_span,
    cue_span: source.cue_span,
    goal_text: source.goal_text,
    cause_text: source.cause_text,
    effect_text: source.effect_text,
    rationale: source.rationale,
    confidence: source.confidence,
    original_candidates: [source],
  }
}

function toRefinedCandidate(
  raw: RawRefinedCandidate,
  sources: V3EvidenceCandidate[],
  paragraphTextByPid: Map<number, string>,
): V3RefinedEvidenceCandidate | null {
  const firstSource = sources[0]
  if (!firstSource) return null

  const candidateType = isV3EvidenceCandidateType(raw.candidate_type)
    ? raw.candidate_type
    : firstSource.candidate_type
  const compatibleSources = sourcesCompatibleWithRefinedType(sources, candidateType)
  const base = compatibleSources[0] ?? firstSource
  const pid = typeof raw.pid === "number" ? raw.pid : base.pid
  const span = textValue(raw.span) ?? base.span
  const paragraphText = paragraphTextByPid.get(pid)
  if (!paragraphText) return buildFallbackCandidate(base)

  const rawStartChar = numberValue(raw.start_char)
  const rawEndChar = numberValue(raw.end_char)
  const resolvedLocation = hasExactMentionLocation(paragraphText, span, rawStartChar, rawEndChar)
    ? { start_char: rawStartChar as number, end_char: rawEndChar as number }
    : resolveMentionLocation(paragraphText, span)

  if (!resolvedLocation) return buildFallbackCandidate(base)

  const actions = actionsFromRaw(raw.actions)
  if (sources.length > 1 && !actions.includes("merged")) actions.push("merged")
  if (candidateType !== base.candidate_type && !actions.includes("type_corrected")) actions.push("type_corrected")
  if (
    span !== base.span &&
    !actions.includes("span_corrected")
  ) {
    actions.push("span_corrected")
  }

  const refined: V3RefinedEvidenceCandidate = {
    refined_candidate_id: "",
    source_candidate_ids: compatibleSources.map((source) => source.candidate_id),
    candidate_type: candidateType,
    status: normalizeRefinementStatus(raw.status),
    actions,
    pid,
    span,
    start_char: resolvedLocation.start_char,
    end_char: resolvedLocation.end_char,
    original_candidates: compatibleSources,
  }

  addOptionalText(refined, "normalized", raw.normalized ?? base.normalized)
  addOptionalText(refined, "label", raw.label ?? base.label)
  addOptionalText(refined, "subject_hint", raw.subject_hint ?? base.subject_hint)
  addOptionalText(refined, "object_hint", raw.object_hint ?? base.object_hint)
  addOptionalText(refined, "owner_span", raw.owner_span ?? base.owner_span)
  addOptionalText(refined, "target_span", raw.target_span ?? base.target_span)
  addOptionalText(refined, "cue_span", raw.cue_span ?? base.cue_span)
  addOptionalText(refined, "goal_text", raw.goal_text ?? base.goal_text)
  addOptionalText(refined, "cause_text", raw.cause_text ?? base.cause_text)
  addOptionalText(refined, "effect_text", raw.effect_text ?? base.effect_text)
  addOptionalText(refined, "rationale", raw.rationale ?? base.rationale)
  const confidence = numberValue(raw.confidence ?? base.confidence)
  if (confidence !== undefined) refined.confidence = confidence

  return refined
}

function mergeDuplicateRefinedCandidates(
  candidates: V3RefinedEvidenceCandidate[],
): V3RefinedEvidenceCandidate[] {
  const byKey = new Map<string, V3RefinedEvidenceCandidate>()

  for (const candidate of candidates) {
    const key = [
      candidate.pid,
      candidate.start_char,
      candidate.end_char,
      candidate.candidate_type,
      candidate.normalized ?? candidate.span,
    ].join("::")
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, candidate)
      continue
    }

    existing.source_candidate_ids = Array.from(new Set([
      ...existing.source_candidate_ids,
      ...candidate.source_candidate_ids,
    ]))
    existing.original_candidates = [
      ...existing.original_candidates,
      ...candidate.original_candidates.filter((source) =>
        !existing.original_candidates.some((existingSource) => existingSource.candidate_id === source.candidate_id),
      ),
    ]
    existing.actions = Array.from(new Set([...existing.actions, ...candidate.actions, "merged"]))
    if (candidate.status === "kept_core") existing.status = "kept_core"
    else if (existing.status === "kept_context" && candidate.status === "corrected") existing.status = "corrected"
  }

  return Array.from(byKey.values())
}

function finalizeRefinedCandidateIds(candidates: V3RefinedEvidenceCandidate[], chapterId: string): void {
  candidates.forEach((candidate, index) => {
    candidate.refined_candidate_id = `${chapterId}_evid2_${String(index + 1).padStart(4, "0")}`
  })
}

function countStats(
  inputCount: number,
  refined: V3RefinedEvidenceCandidate[],
  rejected: V3RejectedEvidenceCandidate[],
): V3EvidenceRefinementArtifact["refinement_stats"] {
  const rejectedByReason: Record<V3RejectedEvidenceReason, number> = {
    span_not_in_text: 0,
    wrong_pid: 0,
    hallucinated_or_not_in_paragraph: 0,
    not_a_candidate_record: 0,
    not_objective_rejection: 0,
  }
  const byType: Partial<Record<V3EvidenceCandidateType, number>> = {}

  for (const candidate of refined) {
    byType[candidate.candidate_type] = (byType[candidate.candidate_type] ?? 0) + 1
  }
  for (const candidate of rejected) {
    rejectedByReason[candidate.reason] += 1
  }

  return {
    input_candidates: inputCount,
    refined_candidates: refined.length,
    kept_core: refined.filter((candidate) => candidate.status === "kept_core").length,
    kept_context: refined.filter((candidate) => candidate.status === "kept_context").length,
    corrected: refined.filter((candidate) => candidate.status === "corrected").length,
    merged_sources: refined.reduce(
      (sum, candidate) => sum + Math.max(0, candidate.source_candidate_ids.length - 1),
      0,
    ),
    rejected_candidates: rejected.length,
    rejected_by_reason: rejectedByReason,
    by_type: byType,
  }
}

export async function runV3EvidenceRefinement(
  chapter: RawChapter,
  llmClient: LLMClient,
  docId: string,
  chapterId: string,
  classifyLog: ContentUnits,
  evidenceArtifacts: V3EvidenceArtifact[],
  parents: Record<string, string> = {},
  onProgress?: (progress: string) => void,
): Promise<V3EvidenceRefinementArtifact> {
  onProgress?.("EVID.2: refining evidence candidates...")

  const sourceCandidates = sourceCandidatesFromArtifacts(evidenceArtifacts)
  const sourceById = new Map(sourceCandidates.map((candidate) => [candidate.candidate_id, candidate]))
  const narrativeParagraphs = narrativeParagraphsFromContentUnits(chapter, classifyLog)
  const paragraphTextByPid = new Map(chapter.paragraphs.map((paragraph) => [paragraph.pid, paragraph.text]))
  const paragraphBatches = chunkParagraphs(narrativeParagraphs)
  let completedParagraphs = 0

  async function extractBatch(batch: RawChapter["paragraphs"], batchLabel: string): Promise<BatchResult> {
    const pidSet = new Set(batch.map((paragraph) => paragraph.pid))
    const batchCandidates = sourceCandidates.filter((candidate) => pidSet.has(candidate.pid))
    if (batchCandidates.length === 0) return { refined: [], rejected: [] }

    onProgress?.(`EVID.2: ${batchLabel} running (${batchCandidates.length} candidates)`)

    try {
      const result = await llmClient.refineV3Evidence({
        paragraphs_json: formatJsonParam(batch.map((paragraph) => ({
          pid: paragraph.pid,
          text: paragraph.text,
        }))),
        candidates_json: formatJsonParam(batchCandidates),
      })
      const rawRefined = Array.isArray(result.refined_candidates)
        ? result.refined_candidates as RawRefinedCandidate[]
        : []
      const rawRejected = Array.isArray(result.rejected_candidates)
        ? result.rejected_candidates as RawRejectedCandidate[]
        : []
      const handledSourceIds = new Set<string>()
      const refined: V3RefinedEvidenceCandidate[] = []
      const rejected: V3RejectedEvidenceCandidate[] = []

      for (const raw of rawRefined) {
        const sourceIds = sourceIdsFromRaw(raw.source_candidate_ids)
        const sources = sourceIds.flatMap((id) => {
          const source = sourceById.get(id)
          return source ? [source] : []
        })
        const candidate = toRefinedCandidate(raw, sources, paragraphTextByPid)
        if (!candidate) continue
        candidate.source_candidate_ids.forEach((id) => handledSourceIds.add(id))
        refined.push(candidate)
      }

      for (const raw of rawRejected) {
        const sourceCandidateId = textValue(raw.source_candidate_id)
        if (!sourceCandidateId) continue
        const source = sourceById.get(sourceCandidateId)
        if (!source) continue
        const reason = normalizeRejectionReason(raw.reason)

        if (reason === "not_objective_rejection") {
          const fallback = buildFallbackCandidate(source)
          fallback.rationale = textValue(raw.original_reason) ?? fallback.rationale
          refined.push(fallback)
          handledSourceIds.add(sourceCandidateId)
          continue
        }

        rejected.push({
          source_candidate_id: sourceCandidateId,
          reason: reason as V3ObjectiveRejectionReason,
          original_reason: textValue(raw.original_reason),
          candidate: source,
        })
        handledSourceIds.add(sourceCandidateId)
      }

      for (const source of batchCandidates) {
        if (!handledSourceIds.has(source.candidate_id)) {
          refined.push(buildFallbackCandidate(source))
        }
      }

      completedParagraphs += batch.length
      onProgress?.(`EVID.2: processed ${completedParagraphs}/${narrativeParagraphs.length} narrative paragraphs`)

      return {
        refined: mergeDuplicateRefinedCandidates(refined),
        rejected,
      }
    } catch (error) {
      if (batch.length > 1 && isLikelyTruncatedJsonError(error)) {
        const midpoint = Math.ceil(batch.length / 2)
        const left = await extractBatch(batch.slice(0, midpoint), `${batchLabel}.1`)
        const right = await extractBatch(batch.slice(midpoint), `${batchLabel}.2`)
        return {
          refined: [...left.refined, ...right.refined],
          rejected: [...left.rejected, ...right.rejected],
        }
      }

      const pidRange = batch.map((paragraph) => `P${paragraph.pid}`).join(", ")
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`EVID.2 ${batchLabel} failed for ${pidRange}: ${message}`, { cause: error })
    }
  }

  const batchResults = await mapWithConcurrency(
    paragraphBatches,
    V3_REFINEMENT_PARALLELISM,
    (batch, batchIndex) => extractBatch(batch, `batch ${batchIndex + 1}/${paragraphBatches.length}`),
  )

  const refined = mergeDuplicateRefinedCandidates(batchResults.flatMap((batchResult) => batchResult.refined))
  refined.sort((a, b) => (
    a.pid - b.pid ||
    a.start_char - b.start_char ||
    a.end_char - b.end_char ||
    a.candidate_type.localeCompare(b.candidate_type) ||
    a.span.localeCompare(b.span)
  ))
  finalizeRefinedCandidateIds(refined, chapterId)

  const rejected = batchResults.flatMap((batchResult) => batchResult.rejected)

  return {
    run_id: `v3_evidence_refinement__${docId}__${chapterId}`,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: "EVID.2",
    method: "llm+rule",
    parents,
    extraction_profile: V3_EVIDENCE_REFINEMENT_PROFILE,
    source_stage_ids: [...SOURCE_STAGE_IDS],
    prompt_template: "v3_evid2_candidate_refine",
    refinement_stats: countStats(sourceCandidates.length, refined, rejected),
    refined_candidates: refined,
    rejected_candidates: rejected,
  }
}
