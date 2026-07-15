import type { ContentUnits, RawChapter } from "@/types/schema"
import type { LLMClient } from "@/lib/llm-client"
import { hasExactMentionLocation, resolveMentionLocation } from "@/lib/mention-locations"
import { formatParagraphsForLLM, normalizePidKey } from "@/lib/prompt-loader"
import {
  allowedCandidateTypesForEvidencePass,
  candidateKeyForEvidencePass,
  evidencePassConfig,
  isV3EvidenceCandidateType,
  normalizeEvidenceLabel,
  promptTemplateForEvidencePass,
  V3_EVIDENCE_PROFILE,
  type V3DroppedEvidenceCandidate,
  type V3EvidenceArtifact,
  type V3EvidenceCandidate,
  type V3EvidenceCandidateType,
  type V3EvidencePassId,
} from "@/lib/pipeline/v3-evidence-types"

const V3_EVIDENCE_BATCH_PARAGRAPHS = 4
const V3_EVIDENCE_BATCH_CHARS = 3000
const V3_EVIDENCE_PARALLELISM = 4

interface RawV3EvidenceCandidate {
  pid?: unknown
  span?: unknown
  start_char?: unknown
  end_char?: unknown
  candidate_type?: unknown
  label?: unknown
  normalized?: unknown
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

interface BatchResult {
  candidates: V3EvidenceCandidate[]
  drops: V3DroppedEvidenceCandidate[]
  attempted: number
}

type OptionalEvidenceTextField =
  | "subject_hint"
  | "object_hint"
  | "owner_span"
  | "target_span"
  | "cue_span"
  | "goal_text"
  | "cause_text"
  | "effect_text"
  | "rationale"

function chunkParagraphs(paragraphs: RawChapter["paragraphs"]): Array<RawChapter["paragraphs"]> {
  const batches: Array<RawChapter["paragraphs"]> = []
  let current: RawChapter["paragraphs"] = []
  let currentChars = 0

  for (const paragraph of paragraphs) {
    const wouldOverflowCount = current.length >= V3_EVIDENCE_BATCH_PARAGRAPHS
    const wouldOverflowChars =
      current.length > 0 && currentChars + paragraph.text.length > V3_EVIDENCE_BATCH_CHARS

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

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function droppedCandidate(
  reason: string,
  candidate: RawV3EvidenceCandidate,
): V3DroppedEvidenceCandidate {
  return {
    reason,
    pid: typeof candidate.pid === "number" ? candidate.pid : undefined,
    span: textValue(candidate.span),
    candidate_type: isV3EvidenceCandidateType(candidate.candidate_type)
      ? candidate.candidate_type
      : undefined,
    start_char: typeof candidate.start_char === "number" ? candidate.start_char : undefined,
    end_char: typeof candidate.end_char === "number" ? candidate.end_char : undefined,
    label: textValue(candidate.label),
    normalized: textValue(candidate.normalized),
  }
}

function countDropReason(counts: Map<string, number>, reason: string): void {
  counts.set(reason, (counts.get(reason) ?? 0) + 1)
}

function addOptionalText(
  target: V3EvidenceCandidate,
  key: OptionalEvidenceTextField,
  value: unknown,
): void {
  const text = textValue(value)
  if (text) target[key] = text
}

function finalizeCandidateIds(
  candidates: V3EvidenceCandidate[],
  chapterId: string,
  passId: V3EvidencePassId,
): void {
  const idPrefix = passId.toLowerCase().replace(/[^a-z0-9]/g, "")
  const candidateIdCounts = new Map<string, number>()

  candidates.forEach((candidate, index) => {
    if (typeof candidate.candidate_id === "string" && candidate.candidate_id.trim()) {
      const count = (candidateIdCounts.get(candidate.candidate_id) ?? 0) + 1
      candidateIdCounts.set(candidate.candidate_id, count)
      if (count === 1) return
    }

    candidate.candidate_id = `${chapterId}_${idPrefix}_${String(index + 1).padStart(4, "0")}`
  })
}

function countCandidates(candidates: V3EvidenceCandidate[]): Pick<
  V3EvidenceArtifact["extraction_stats"],
  "by_type" | "by_label"
> {
  const byType: Partial<Record<V3EvidenceCandidateType, number>> = {}
  const byLabel: Record<string, number> = {}

  for (const candidate of candidates) {
    byType[candidate.candidate_type] = (byType[candidate.candidate_type] ?? 0) + 1
    const label = candidate.label ?? ""
    if (label) byLabel[label] = (byLabel[label] ?? 0) + 1
  }

  return { by_type: byType, by_label: byLabel }
}

export async function runV3EvidenceExtraction(
  passId: V3EvidencePassId,
  chapter: RawChapter,
  llmClient: LLMClient,
  docId: string,
  chapterId: string,
  classifyLog: ContentUnits,
  parents: Record<string, string> = {},
  onProgress?: (progress: string) => void,
): Promise<V3EvidenceArtifact> {
  const passConfig = evidencePassConfig(passId)
  const candidateKey = candidateKeyForEvidencePass(passId)
  const promptTemplate = promptTemplateForEvidencePass(passId)
  const allowedCandidateTypes = allowedCandidateTypesForEvidencePass(passId)

  onProgress?.(`${passId}: extracting ${passConfig.title.toLowerCase()}...`)

  const narrativeParagraphs = narrativeParagraphsFromContentUnits(chapter, classifyLog)
  const paragraphTextByPid = new Map(chapter.paragraphs.map((paragraph) => [paragraph.pid, paragraph.text]))
  const paragraphBatches = chunkParagraphs(narrativeParagraphs)
  const droppedByReason = new Map<string, number>()
  let completedParagraphs = 0

  async function extractBatch(batch: RawChapter["paragraphs"], batchLabel: string): Promise<BatchResult> {
    onProgress?.(`${passId}: ${batchLabel} running (${batch.length} paragraphs)`)

    try {
      const result = await llmClient.extractV3Evidence(promptTemplate, {
        chapter_text_with_pids: formatParagraphsForLLM(batch),
      })
      const rawCandidates = Array.isArray(result[candidateKey])
        ? result[candidateKey] as RawV3EvidenceCandidate[]
        : []
      const fallbackOccurrenceByPidSpan = new Map<string, number>()
      const candidates: V3EvidenceCandidate[] = []
      const drops: V3DroppedEvidenceCandidate[] = []

      for (const candidate of rawCandidates) {
        if (typeof candidate.pid !== "number") {
          drops.push(droppedCandidate("invalid pid", candidate))
          continue
        }

        if (!isV3EvidenceCandidateType(candidate.candidate_type)) {
          drops.push(droppedCandidate("invalid candidate type", candidate))
          continue
        }

        if (!allowedCandidateTypes.has(candidate.candidate_type)) {
          drops.push(droppedCandidate("candidate type not allowed for pass", candidate))
          continue
        }

        const span = textValue(candidate.span)
        if (!span) {
          drops.push(droppedCandidate("empty span", candidate))
          continue
        }

        const paragraphText = paragraphTextByPid.get(candidate.pid)
        if (!paragraphText) {
          drops.push(droppedCandidate("paragraph not found", candidate))
          continue
        }

        const locationKey = `${candidate.pid}::${span}`
        const fallbackOccurrenceIndex = (fallbackOccurrenceByPidSpan.get(locationKey) ?? 0) + 1
        const rawStartChar = numberValue(candidate.start_char)
        const rawEndChar = numberValue(candidate.end_char)
        const resolvedLocation = hasExactMentionLocation(
          paragraphText,
          span,
          rawStartChar,
          rawEndChar,
        )
          ? {
              start_char: rawStartChar as number,
              end_char: rawEndChar as number,
            }
          : resolveMentionLocation(paragraphText, span, fallbackOccurrenceIndex)

        if (!resolvedLocation) {
          drops.push(droppedCandidate("span location not resolved", candidate))
          continue
        }

        fallbackOccurrenceByPidSpan.set(locationKey, fallbackOccurrenceIndex)

        const label = normalizeEvidenceLabel(candidate.label)
        const normalized = textValue(candidate.normalized)
        const nextCandidate: V3EvidenceCandidate = {
          candidate_id: textValue((candidate as { candidate_id?: unknown }).candidate_id) ?? "",
          pid: candidate.pid,
          span,
          start_char: resolvedLocation.start_char,
          end_char: resolvedLocation.end_char,
          candidate_type: candidate.candidate_type,
          source_pass: passId,
          ...(label ? { label } : {}),
          ...(normalized ? { normalized } : {}),
        }

        addOptionalText(nextCandidate, "subject_hint", candidate.subject_hint)
        addOptionalText(nextCandidate, "object_hint", candidate.object_hint)
        addOptionalText(nextCandidate, "owner_span", candidate.owner_span)
        addOptionalText(nextCandidate, "target_span", candidate.target_span)
        addOptionalText(nextCandidate, "cue_span", candidate.cue_span)
        addOptionalText(nextCandidate, "goal_text", candidate.goal_text)
        addOptionalText(nextCandidate, "cause_text", candidate.cause_text)
        addOptionalText(nextCandidate, "effect_text", candidate.effect_text)
        addOptionalText(nextCandidate, "rationale", candidate.rationale)
        const confidence = numberValue(candidate.confidence)
        if (confidence !== undefined) nextCandidate.confidence = confidence

        candidates.push(nextCandidate)
      }

      completedParagraphs += batch.length
      onProgress?.(`${passId}: processed ${completedParagraphs}/${narrativeParagraphs.length} narrative paragraphs`)

      return {
        candidates,
        drops,
        attempted: rawCandidates.length,
      }
    } catch (error) {
      if (batch.length > 1 && isLikelyTruncatedJsonError(error)) {
        const midpoint = Math.ceil(batch.length / 2)
        const left = await extractBatch(batch.slice(0, midpoint), `${batchLabel}.1`)
        const right = await extractBatch(batch.slice(midpoint), `${batchLabel}.2`)
        return {
          candidates: [...left.candidates, ...right.candidates],
          drops: [...left.drops, ...right.drops],
          attempted: left.attempted + right.attempted,
        }
      }

      const pidRange = batch.map((paragraph) => `P${paragraph.pid}`).join(", ")
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`${passId} ${batchLabel} failed for ${pidRange}: ${message}`, { cause: error })
    }
  }

  onProgress?.(`${passId}: 0/${narrativeParagraphs.length} narrative paragraphs processed`)

  const batchResults = await mapWithConcurrency(
    paragraphBatches,
    V3_EVIDENCE_PARALLELISM,
    (batch, batchIndex) => extractBatch(batch, `batch ${batchIndex + 1}/${paragraphBatches.length}`),
  )

  const candidates = batchResults.flatMap((batchResult) => batchResult.candidates)
  candidates.sort((a, b) => (
    a.pid - b.pid ||
    a.start_char - b.start_char ||
    a.end_char - b.end_char ||
    a.candidate_type.localeCompare(b.candidate_type) ||
    a.span.localeCompare(b.span)
  ))
  finalizeCandidateIds(candidates, chapterId, passId)

  const droppedCandidates = batchResults.flatMap((batchResult) => batchResult.drops)
  for (const drop of droppedCandidates) {
    countDropReason(droppedByReason, drop.reason)
  }

  const attemptedRawCandidates = batchResults.reduce((sum, result) => sum + result.attempted, 0)
  const candidateCounts = countCandidates(candidates)

  return {
    run_id: `v3_evidence__${passId.toLowerCase()}__${docId}__${chapterId}`,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: passId,
    method: "llm",
    parents,
    extraction_profile: V3_EVIDENCE_PROFILE,
    pass_id: passId,
    candidate_key: candidateKey,
    candidate_types: passConfig.allowedCandidateTypes,
    prompt_template: promptTemplate,
    extraction_stats: {
      narrative_paragraphs: narrativeParagraphs.length,
      attempted_raw_candidates: attemptedRawCandidates,
      accepted_candidates: candidates.length,
      dropped_candidates: droppedCandidates.length,
      dropped_by_reason: Object.fromEntries(droppedByReason.entries()),
      ...candidateCounts,
    },
    dropped_candidates: droppedCandidates,
    candidates,
  }
}
