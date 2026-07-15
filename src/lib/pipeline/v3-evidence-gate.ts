import type { ContentUnits, RawChapter } from "@/types/schema"
import type { LLMClient } from "../llm-client"
import { formatJsonParam, normalizePidKey } from "../prompt-loader"
import type {
  V3EvidenceRefinementArtifact,
  V3RefinedEvidenceCandidate,
} from "./v3-evidence-refinement-types"
import type { V3EvidenceGateArtifact } from "./v3-evidence-gate-types"
import {
  buildV3EvidenceGateFromDecisions,
  type RawGateDecision,
} from "./v3-evidence-gate-core"

const GATE_BATCH_PARAGRAPHS = 5
const GATE_BATCH_CHARS = 4000
const GATE_BATCH_PARALLELISM = 3

interface RunParams {
  chapter: RawChapter
  llmClient: LLMClient
  docId: string
  chapterId: string
  classifyLog: ContentUnits
  evidenceRefinement: V3EvidenceRefinementArtifact
  parents?: Record<string, string>
  onProgress?: (progress: string) => void
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
    const wouldOverflowCount = current.length >= GATE_BATCH_PARAGRAPHS
    const wouldOverflowChars = current.length > 0 && currentChars + paragraph.text.length > GATE_BATCH_CHARS

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

function compactCandidate(candidate: V3RefinedEvidenceCandidate): Record<string, unknown> {
  return {
    refined_candidate_id: candidate.refined_candidate_id,
    source_candidate_ids: candidate.source_candidate_ids,
    candidate_type: candidate.candidate_type,
    status: candidate.status,
    pid: candidate.pid,
    span: candidate.span,
    start_char: candidate.start_char,
    end_char: candidate.end_char,
    normalized: candidate.normalized,
    label: candidate.label,
    subject_hint: candidate.subject_hint,
    object_hint: candidate.object_hint,
    owner_span: candidate.owner_span,
    target_span: candidate.target_span,
    cue_span: candidate.cue_span,
    goal_text: candidate.goal_text,
    cause_text: candidate.cause_text,
    effect_text: candidate.effect_text,
    rationale: candidate.rationale,
  }
}

export async function runV3EvidenceGate({
  chapter,
  llmClient,
  docId,
  chapterId,
  classifyLog,
  evidenceRefinement,
  parents = {},
  onProgress,
}: RunParams): Promise<V3EvidenceGateArtifact> {
  onProgress?.("EVID.3: gating event-ready evidence candidates...")

  const narrativeParagraphs = narrativeParagraphsFromContentUnits(chapter, classifyLog)
  const paragraphBatches = chunkParagraphs(narrativeParagraphs)

  async function extractBatch(batch: RawChapter["paragraphs"], batchLabel: string): Promise<RawGateDecision[]> {
    const pidSet = new Set(batch.map((paragraph) => paragraph.pid))
    const batchCandidates = evidenceRefinement.refined_candidates.filter((candidate) => pidSet.has(candidate.pid))
    if (batchCandidates.length === 0) return []

    onProgress?.(`EVID.3: ${batchLabel} running (${batchCandidates.length} candidates)`)

    const result = await llmClient.gateV3Evidence({
      paragraphs_json: formatJsonParam(batch.map((paragraph) => ({
        pid: paragraph.pid,
        text: paragraph.text,
      }))),
      refined_candidates_json: formatJsonParam(batchCandidates.map(compactCandidate)),
    })
    return Array.isArray(result.gated_candidates)
      ? result.gated_candidates as RawGateDecision[]
      : []
  }

  const batchResults = await mapWithConcurrency(
    paragraphBatches,
    GATE_BATCH_PARALLELISM,
    (batch, batchIndex) => extractBatch(batch, `batch ${batchIndex + 1}/${paragraphBatches.length}`),
  )

  return buildV3EvidenceGateFromDecisions({
    docId,
    chapterId,
    evidenceRefinement,
    decisions: batchResults.flat(),
    parents,
  })
}
