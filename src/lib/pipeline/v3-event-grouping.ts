import type { ContentUnits, RawChapter } from "@/types/schema"
import type { LLMClient } from "@/lib/llm-client"
import { formatJsonParam, normalizePidKey } from "@/lib/prompt-loader"
import type { V3EvidenceCandidate, V3EvidenceCandidateType } from "@/lib/pipeline/v3-evidence-types"
import type {
  V3EvidenceClusteringArtifact,
  V3EvidenceEntityCluster,
} from "@/lib/pipeline/v3-evidence-clustering-types"
import type { V3EvidenceGateArtifact } from "@/lib/pipeline/v3-evidence-gate-types"
import type {
  V3EvidenceRefinementArtifact,
  V3RefinedEvidenceCandidate,
} from "@/lib/pipeline/v3-evidence-refinement-types"
import {
  V3_EVENT_GROUPING_PROFILE,
  type V3EventCandidate,
  type V3EventEvidenceOccurrence,
  type V3EventGroupingArtifact,
} from "@/lib/pipeline/v3-event-types"
import {
  eventAxisIdsOfType,
  isCoreEventAxisOccurrence,
} from "@/lib/pipeline/v3-event-axis-core"

const EVENT_BATCH_PARAGRAPHS = 6
const EVENT_BATCH_CHARS = 4500
const EVENT_BATCH_PARALLELISM = 3

interface RawEventCandidate {
  start_pid?: unknown
  end_pid?: unknown
  summary?: unknown
  anchor_action_ids?: unknown
  evidence_ids?: unknown
  cast_ids?: unknown
  place_ids?: unknown
  time_ids?: unknown
  object_ids?: unknown
  goal_ids?: unknown
  causality_ids?: unknown
  rationale?: unknown
}

interface BatchResult {
  events: V3EventCandidate[]
}

type EvidenceOccurrenceSource = Pick<
  V3EvidenceCandidate,
  | "candidate_id"
  | "pid"
  | "span"
  | "start_char"
  | "end_char"
  | "candidate_type"
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
>

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
    const wouldOverflowCount = current.length >= EVENT_BATCH_PARAGRAPHS
    const wouldOverflowChars = current.length > 0 && currentChars + paragraph.text.length > EVENT_BATCH_CHARS

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

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)))
}

function addOptionalText(
  occurrence: V3EventEvidenceOccurrence,
  key: keyof Pick<
    V3EventEvidenceOccurrence,
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
  >,
  value: unknown,
): void {
  const text = textValue(value)
  if (text) occurrence[key] = text
}

function clusterByRefinedCandidateId(
  evidenceClustering?: V3EvidenceClusteringArtifact,
): Map<string, V3EvidenceEntityCluster> {
  const clusters = new Map(evidenceClustering?.entity_clusters.map((cluster) => [cluster.cluster_id, cluster]))
  const byRefinedCandidateId = new Map<string, V3EvidenceEntityCluster>()
  for (const [candidateId, clusterId] of Object.entries(evidenceClustering?.candidate_cluster_map ?? {})) {
    const cluster = clusters.get(clusterId)
    if (cluster) byRefinedCandidateId.set(candidateId, cluster)
  }
  return byRefinedCandidateId
}

export function expandRefinedEvidenceOccurrences(
  refinedCandidates: V3RefinedEvidenceCandidate[],
  evidenceGate: V3EvidenceGateArtifact,
  evidenceClustering?: V3EvidenceClusteringArtifact,
): V3EventEvidenceOccurrence[] {
  const occurrences: V3EventEvidenceOccurrence[] = []
  const clusterByRefinedId = clusterByRefinedCandidateId(evidenceClustering)
  const gateByRefinedId = new Map(
    evidenceGate.gated_candidates.map((candidate) => [candidate.refined_candidate_id, candidate]),
  )

  for (const refined of refinedCandidates) {
    const gate = gateByRefinedId.get(refined.refined_candidate_id)
    if (gate?.gate === "drop") continue

    const cluster = clusterByRefinedId.get(refined.refined_candidate_id)
    const originals: EvidenceOccurrenceSource[] = refined.original_candidates.length > 0
      ? refined.original_candidates
      : refined.source_candidate_ids.map((sourceCandidateId) => ({
        candidate_id: sourceCandidateId,
        pid: refined.pid,
        span: refined.span,
        start_char: refined.start_char,
        end_char: refined.end_char,
        candidate_type: refined.candidate_type,
      }))

    for (const original of originals) {
      const occurrence: V3EventEvidenceOccurrence = {
        source_candidate_id: original.candidate_id,
        refined_candidate_id: refined.refined_candidate_id,
        candidate_type: original.candidate_type ?? refined.candidate_type,
        status: refined.status,
        gate: gate?.gate,
        gate_basis: gate?.basis,
        pid: original.pid,
        span: original.span,
        start_char: original.start_char,
        end_char: original.end_char,
      }
      addOptionalText(occurrence, "normalized", original.normalized ?? refined.normalized)
      addOptionalText(occurrence, "label", original.label ?? refined.label)
      addOptionalText(occurrence, "subject_hint", original.subject_hint ?? refined.subject_hint)
      addOptionalText(occurrence, "object_hint", original.object_hint ?? refined.object_hint)
      addOptionalText(occurrence, "owner_span", original.owner_span ?? refined.owner_span)
      addOptionalText(occurrence, "target_span", original.target_span ?? refined.target_span)
      addOptionalText(occurrence, "cue_span", original.cue_span ?? refined.cue_span)
      addOptionalText(occurrence, "goal_text", original.goal_text ?? refined.goal_text)
      addOptionalText(occurrence, "cause_text", original.cause_text ?? refined.cause_text)
      addOptionalText(occurrence, "effect_text", original.effect_text ?? refined.effect_text)
      if (cluster) {
        occurrence.entity_cluster_id = cluster.cluster_id
        occurrence.entity_cluster_label = cluster.canonical_label
        occurrence.entity_cluster_type = cluster.entity_type
        occurrence.entity_cluster_aliases = cluster.aliases
      }
      occurrences.push(occurrence)
    }
  }

  occurrences.sort((a, b) => (
    a.pid - b.pid ||
    a.start_char - b.start_char ||
    a.end_char - b.end_char ||
    a.candidate_type.localeCompare(b.candidate_type) ||
    a.source_candidate_id.localeCompare(b.source_candidate_id)
  ))

  return occurrences
}

function compactOccurrence(occurrence: V3EventEvidenceOccurrence): Record<string, unknown> {
  return {
    id: occurrence.source_candidate_id,
    refined_id: occurrence.refined_candidate_id,
    type: occurrence.candidate_type,
    status: occurrence.status,
    gate: occurrence.gate,
    gate_basis: occurrence.gate_basis,
    pid: occurrence.pid,
    span: occurrence.span,
    start_char: occurrence.start_char,
    end_char: occurrence.end_char,
    normalized: occurrence.normalized,
    label: occurrence.label,
    subject_hint: occurrence.subject_hint,
    object_hint: occurrence.object_hint,
    owner_span: occurrence.owner_span,
    target_span: occurrence.target_span,
    cue_span: occurrence.cue_span,
    goal_text: occurrence.goal_text,
    cause_text: occurrence.cause_text,
    effect_text: occurrence.effect_text,
    entity_cluster_id: occurrence.entity_cluster_id,
    entity_cluster_label: occurrence.entity_cluster_label,
    entity_cluster_type: occurrence.entity_cluster_type,
    entity_cluster_aliases: occurrence.entity_cluster_aliases,
  }
}

function validIds(ids: unknown, occurrenceById: Map<string, V3EventEvidenceOccurrence>): string[] {
  return stringArray(ids).filter((id) => occurrenceById.has(id))
}

function idsOfType(
  ids: string[],
  occurrenceById: Map<string, V3EventEvidenceOccurrence>,
  candidateType: V3EvidenceCandidateType,
): string[] {
  return eventAxisIdsOfType(ids, occurrenceById, candidateType)
}

function anchorActionIds(
  ids: string[],
  occurrenceById: Map<string, V3EventEvidenceOccurrence>,
): string[] {
  return ids.filter((id) => {
    const occurrence = occurrenceById.get(id)
    return occurrence?.candidate_type === "action" && occurrence.gate !== "support"
  })
}

function pidRangeForIds(ids: string[], occurrenceById: Map<string, V3EventEvidenceOccurrence>): {
  start_pid: number
  end_pid: number
} | null {
  const pids = ids.flatMap((id) => {
    const occurrence = occurrenceById.get(id)
    return occurrence ? [occurrence.pid] : []
  })
  if (pids.length === 0) return null
  return {
    start_pid: Math.min(...pids),
    end_pid: Math.max(...pids),
  }
}

function toEventCandidate(
  raw: RawEventCandidate,
  occurrenceById: Map<string, V3EventEvidenceOccurrence>,
): Omit<V3EventCandidate, "event_id" | "sequence_index"> | null {
  const actionIds = anchorActionIds(validIds(raw.anchor_action_ids, occurrenceById), occurrenceById)
  if (actionIds.length === 0) return null

  const explicitEvidenceIds = validIds(raw.evidence_ids, occurrenceById)
  const typedIds = [
    ...validIds(raw.cast_ids, occurrenceById),
    ...validIds(raw.place_ids, occurrenceById),
    ...validIds(raw.time_ids, occurrenceById),
    ...validIds(raw.object_ids, occurrenceById),
    ...validIds(raw.goal_ids, occurrenceById),
    ...validIds(raw.causality_ids, occurrenceById),
  ]
  const evidenceIds = Array.from(new Set([...actionIds, ...explicitEvidenceIds, ...typedIds]))
  const range = pidRangeForIds(evidenceIds, occurrenceById)
  if (!range) return null

  const startPid = numberValue(raw.start_pid) ?? range.start_pid
  const endPid = numberValue(raw.end_pid) ?? range.end_pid
  const firstAction = occurrenceById.get(actionIds[0])

  return {
    grouping_source: "llm",
    start_pid: Math.min(startPid, endPid),
    end_pid: Math.max(startPid, endPid),
    summary: textValue(raw.summary) ?? firstAction?.label ?? firstAction?.span ?? "Untitled event",
    anchor_action_ids: actionIds,
    evidence_ids: evidenceIds,
    cast_ids: idsOfType(validIds(raw.cast_ids, occurrenceById), occurrenceById, "cast"),
    place_ids: idsOfType(validIds(raw.place_ids, occurrenceById), occurrenceById, "place"),
    time_ids: idsOfType(validIds(raw.time_ids, occurrenceById), occurrenceById, "time"),
    object_ids: idsOfType(validIds(raw.object_ids, occurrenceById), occurrenceById, "object"),
    goal_ids: idsOfType(validIds(raw.goal_ids, occurrenceById), occurrenceById, "goal"),
    causality_ids: idsOfType(validIds(raw.causality_ids, occurrenceById), occurrenceById, "causality"),
    rationale: textValue(raw.rationale),
  }
}

function fallbackEventForAction(
  action: V3EventEvidenceOccurrence,
  nearbyOccurrences: V3EventEvidenceOccurrence[],
): Omit<V3EventCandidate, "event_id" | "sequence_index"> {
  const nearbyCoreIdsOfType = (candidateType: V3EvidenceCandidateType): string[] =>
    nearbyOccurrences
      .filter((occurrence) =>
        occurrence.pid === action.pid &&
        occurrence.candidate_type === candidateType &&
        isCoreEventAxisOccurrence(occurrence)
      )
      .map((occurrence) => occurrence.source_candidate_id)

  const evidenceIds = Array.from(new Set([
    action.source_candidate_id,
    ...nearbyOccurrences
      .filter((occurrence) =>
        occurrence.pid === action.pid &&
        occurrence.candidate_type !== "action" &&
        isCoreEventAxisOccurrence(occurrence)
      )
      .map((occurrence) => occurrence.source_candidate_id),
  ]))

  return {
    grouping_source: "fallback_action",
    start_pid: action.pid,
    end_pid: action.pid,
    summary: action.label ?? action.span,
    anchor_action_ids: [action.source_candidate_id],
    evidence_ids: evidenceIds,
    cast_ids: nearbyCoreIdsOfType("cast"),
    place_ids: nearbyCoreIdsOfType("place"),
    time_ids: nearbyCoreIdsOfType("time"),
    object_ids: nearbyCoreIdsOfType("object"),
    goal_ids: nearbyCoreIdsOfType("goal"),
    causality_ids: nearbyCoreIdsOfType("causality"),
    rationale: "Fallback event preserving an ungrouped action anchor.",
  }
}

function finalizeEventIds(
  events: Array<Omit<V3EventCandidate, "event_id" | "sequence_index">>,
  chapterId: string,
): V3EventCandidate[] {
  return events
    .sort((a, b) => (
      a.start_pid - b.start_pid ||
      a.end_pid - b.end_pid ||
      a.anchor_action_ids[0].localeCompare(b.anchor_action_ids[0])
    ))
    .map((event, index) => ({
      ...event,
      event_id: `${chapterId}_event1_${String(index + 1).padStart(4, "0")}`,
      sequence_index: index + 1,
    }))
}

function countStats(
  occurrences: V3EventEvidenceOccurrence[],
  events: V3EventCandidate[],
): V3EventGroupingArtifact["event_stats"] {
  const byStartPid: Record<string, number> = {}
  for (const event of events) {
    const key = String(event.start_pid)
    byStartPid[key] = (byStartPid[key] ?? 0) + 1
  }

  return {
    input_occurrences: occurrences.length,
    action_anchors: occurrences.filter((occurrence) =>
      occurrence.candidate_type === "action" && occurrence.gate !== "support"
    ).length,
    event_candidates: events.length,
    fallback_events: events.filter((event) => event.grouping_source === "fallback_action").length,
    paragraphs_covered: new Set(events.flatMap((event) => {
      const pids: number[] = []
      for (let pid = event.start_pid; pid <= event.end_pid; pid += 1) pids.push(pid)
      return pids
    })).size,
    by_start_pid: byStartPid,
  }
}

export async function runV3EventGrouping(
  chapter: RawChapter,
  llmClient: LLMClient,
  docId: string,
  chapterId: string,
  classifyLog: ContentUnits,
  evidenceRefinement: V3EvidenceRefinementArtifact,
  evidenceGate: V3EvidenceGateArtifact,
  evidenceClustering: V3EvidenceClusteringArtifact,
  parents: Record<string, string> = {},
  onProgress?: (progress: string) => void,
): Promise<V3EventGroupingArtifact> {
  onProgress?.("EVENT.1: grouping event candidates...")

  const narrativeParagraphs = narrativeParagraphsFromContentUnits(chapter, classifyLog)
  const occurrences = expandRefinedEvidenceOccurrences(evidenceRefinement.refined_candidates, evidenceGate, evidenceClustering)
  const occurrenceById = new Map(occurrences.map((occurrence) => [occurrence.source_candidate_id, occurrence]))
  const paragraphBatches = chunkParagraphs(narrativeParagraphs)
  const groupedActionIds = new Set<string>()

  async function extractBatch(batch: RawChapter["paragraphs"], batchLabel: string): Promise<BatchResult> {
    const pidSet = new Set(batch.map((paragraph) => paragraph.pid))
    const batchOccurrences = occurrences.filter((occurrence) => pidSet.has(occurrence.pid))
    const batchActions = batchOccurrences.filter((occurrence) =>
      occurrence.candidate_type === "action" && occurrence.gate !== "support"
    )
    if (batchActions.length === 0) return { events: [] }

    onProgress?.(`EVENT.1: ${batchLabel} running (${batchActions.length} action anchors)`)

    const result = await llmClient.groupV3Events({
      paragraphs_json: formatJsonParam(batch.map((paragraph) => ({
        pid: paragraph.pid,
        text: paragraph.text,
      }))),
      evidence_occurrences_json: formatJsonParam(batchOccurrences.map(compactOccurrence)),
    })
    const rawEvents = Array.isArray(result.event_candidates)
      ? result.event_candidates as RawEventCandidate[]
      : []
    const events: Array<Omit<V3EventCandidate, "event_id" | "sequence_index">> = []

    for (const rawEvent of rawEvents) {
      const event = toEventCandidate(rawEvent, occurrenceById)
      if (!event) continue
      event.anchor_action_ids.forEach((id) => groupedActionIds.add(id))
      events.push(event)
    }

    onProgress?.(`EVENT.1: ${batchLabel} grouped ${events.length} events`)

    return { events: finalizeEventIds(events, chapterId) }
  }

  const batchResults = await mapWithConcurrency(
    paragraphBatches,
    EVENT_BATCH_PARALLELISM,
    (batch, batchIndex) => extractBatch(batch, `batch ${batchIndex + 1}/${paragraphBatches.length}`),
  )
  const llmEvents = batchResults.flatMap((batchResult) => batchResult.events)
  const fallbackEvents = occurrences
    .filter((occurrence) =>
      occurrence.candidate_type === "action" &&
      occurrence.gate !== "support" &&
      !groupedActionIds.has(occurrence.source_candidate_id)
    )
    .map((action) => fallbackEventForAction(action, occurrences))
  const eventCandidates = finalizeEventIds([...llmEvents, ...fallbackEvents], chapterId)

  return {
    run_id: `v3_event_grouping__${docId}__${chapterId}`,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: "EVENT.1",
    method: "llm+rule",
    parents,
    extraction_profile: V3_EVENT_GROUPING_PROFILE,
    source_stage_ids: ["EVID.3", "EVID.4"],
    prompt_template: "v3_event1_group_events",
    event_stats: countStats(occurrences, eventCandidates),
    evidence_occurrences: occurrences,
    event_candidates: eventCandidates,
  }
}
