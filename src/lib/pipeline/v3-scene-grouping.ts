import type { LLMClient } from "@/lib/llm-client"
import { formatJsonParam } from "@/lib/prompt-loader"
import type {
  V3EventCandidate,
  V3EventEvidenceOccurrence,
  V3EventGroupingArtifact,
} from "@/lib/pipeline/v3-event-types"
import {
  V3_SCENE_GROUPING_PROFILE,
  type V3SceneAxisEvidence,
  type V3SceneAxisKey,
  type V3SceneCandidate,
  type V3SceneGroupingArtifact,
} from "@/lib/pipeline/v3-scene-types"

const SCENE_AXIS_KEYS: V3SceneAxisKey[] = ["time", "place", "action_focus", "cast"]
const SCENE_AXIS_KEY_SET = new Set<string>(SCENE_AXIS_KEYS)

interface RawSceneAxisEvidence {
  label?: unknown
  evidence_event_ids?: unknown
  note?: unknown
}

interface RawSceneCandidate {
  event_ids?: unknown
  summary?: unknown
  time_axis?: unknown
  place_axis?: unknown
  action_focus_axis?: unknown
  cast_axis?: unknown
  boundary_basis?: unknown
  rationale?: unknown
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)))
}

function eventOrder(events: V3EventCandidate[]): Map<string, number> {
  return new Map(events.map((event, index) => [event.event_id, index]))
}

function sortEventIdsBySourceOrder(ids: string[], orderById: Map<string, number>): string[] {
  return [...ids].sort((a, b) => (orderById.get(a) ?? 0) - (orderById.get(b) ?? 0))
}

function eventRange(eventIds: string[], eventById: Map<string, V3EventCandidate>): {
  start_event_id: string
  end_event_id: string
  start_pid: number
  end_pid: number
} {
  const events = eventIds.map((id) => eventById.get(id)).filter((event): event is V3EventCandidate => Boolean(event))
  return {
    start_event_id: eventIds[0],
    end_event_id: eventIds[eventIds.length - 1],
    start_pid: Math.min(...events.map((event) => event.start_pid)),
    end_pid: Math.max(...events.map((event) => event.end_pid)),
  }
}

function defaultAxisLabel(axisKey: V3SceneAxisKey, eventIds: string[], eventById: Map<string, V3EventCandidate>): string {
  if (axisKey === "action_focus") {
    const firstEvent = eventById.get(eventIds[0])
    return firstEvent?.summary ?? "event focus"
  }
  if (axisKey === "time") return "time continuity"
  if (axisKey === "place") return "place continuity"
  return "cast continuity"
}

function axisEvidence(
  rawAxis: unknown,
  axisKey: V3SceneAxisKey,
  sceneEventIds: string[],
  eventById: Map<string, V3EventCandidate>,
): V3SceneAxisEvidence {
  const axis = rawAxis && typeof rawAxis === "object" ? rawAxis as RawSceneAxisEvidence : {}
  const sceneEventIdSet = new Set(sceneEventIds)
  const evidenceEventIds = stringArray(axis.evidence_event_ids).filter((id) => sceneEventIdSet.has(id))
  const note = textValue(axis.note)
  return {
    label: textValue(axis.label) ?? defaultAxisLabel(axisKey, sceneEventIds, eventById),
    evidence_event_ids: evidenceEventIds.length > 0 ? evidenceEventIds : sceneEventIds,
    ...(note ? { note } : {}),
  }
}

function cleanBoundaryBasis(value: unknown): V3SceneAxisKey[] {
  return stringArray(value).filter((item): item is V3SceneAxisKey => SCENE_AXIS_KEY_SET.has(item))
}

function fallbackSceneForEvent(event: V3EventCandidate): Omit<V3SceneCandidate, "scene_id" | "sequence_index"> {
  const eventIds = [event.event_id]
  const axis: V3SceneAxisEvidence = {
    label: event.summary,
    evidence_event_ids: eventIds,
  }
  return {
    grouping_source: "fallback_event",
    start_event_id: event.event_id,
    end_event_id: event.event_id,
    event_ids: eventIds,
    start_pid: event.start_pid,
    end_pid: event.end_pid,
    summary: event.summary,
    time_axis: axis,
    place_axis: axis,
    action_focus_axis: axis,
    cast_axis: axis,
    boundary_basis: [],
    rationale: "Fallback scene preserving an event omitted by scene grouping.",
  }
}

function toSceneCandidate(
  raw: RawSceneCandidate,
  eventById: Map<string, V3EventCandidate>,
  orderById: Map<string, number>,
  coveredEventIds: Set<string>,
): Omit<V3SceneCandidate, "scene_id" | "sequence_index"> | null {
  const eventIds = sortEventIdsBySourceOrder(
    stringArray(raw.event_ids).filter((id) => eventById.has(id) && !coveredEventIds.has(id)),
    orderById,
  )
  if (eventIds.length === 0) return null

  eventIds.forEach((id) => coveredEventIds.add(id))
  const range = eventRange(eventIds, eventById)
  const firstEvent = eventById.get(eventIds[0])

  return {
    grouping_source: "llm",
    ...range,
    event_ids: eventIds,
    summary: textValue(raw.summary) ?? firstEvent?.summary ?? "Untitled scene",
    time_axis: axisEvidence(raw.time_axis, "time", eventIds, eventById),
    place_axis: axisEvidence(raw.place_axis, "place", eventIds, eventById),
    action_focus_axis: axisEvidence(raw.action_focus_axis, "action_focus", eventIds, eventById),
    cast_axis: axisEvidence(raw.cast_axis, "cast", eventIds, eventById),
    boundary_basis: cleanBoundaryBasis(raw.boundary_basis),
    rationale: textValue(raw.rationale),
  }
}

export function finalizeV3SceneCandidates(
  rawScenes: RawSceneCandidate[],
  events: V3EventCandidate[],
  chapterId: string,
): V3SceneCandidate[] {
  const eventById = new Map(events.map((event) => [event.event_id, event]))
  const orderById = eventOrder(events)
  const coveredEventIds = new Set<string>()
  const scenes: Array<Omit<V3SceneCandidate, "scene_id" | "sequence_index">> = []

  for (const rawScene of rawScenes) {
    const scene = toSceneCandidate(rawScene, eventById, orderById, coveredEventIds)
    if (scene) scenes.push(scene)
  }

  for (const event of events) {
    if (!coveredEventIds.has(event.event_id)) {
      coveredEventIds.add(event.event_id)
      scenes.push(fallbackSceneForEvent(event))
    }
  }

  return scenes
    .sort((a, b) => (
      (orderById.get(a.start_event_id) ?? 0) - (orderById.get(b.start_event_id) ?? 0) ||
      a.start_pid - b.start_pid ||
      a.end_pid - b.end_pid
    ))
    .map((scene, index) => ({
      ...scene,
      scene_id: `${chapterId}_scene0_${String(index + 1).padStart(4, "0")}`,
      sequence_index: index + 1,
    }))
}

function compactOccurrence(
  id: string,
  occurrenceById: Map<string, V3EventEvidenceOccurrence>,
): Record<string, unknown> | null {
  const occurrence = occurrenceById.get(id)
  if (!occurrence) return null
  return {
    id,
    pid: occurrence.pid,
    text: occurrence.normalized ?? occurrence.label ?? occurrence.span,
    span: occurrence.span,
  }
}

function compactOccurrences(
  ids: string[],
  occurrenceById: Map<string, V3EventEvidenceOccurrence>,
): Array<Record<string, unknown>> {
  return ids.flatMap((id) => {
    const occurrence = compactOccurrence(id, occurrenceById)
    return occurrence ? [occurrence] : []
  })
}

function compactEventForScene(
  event: V3EventCandidate,
  occurrenceById: Map<string, V3EventEvidenceOccurrence>,
): Record<string, unknown> {
  return {
    event_id: event.event_id,
    sequence_index: event.sequence_index,
    start_pid: event.start_pid,
    end_pid: event.end_pid,
    summary: event.summary,
    grouping_source: event.grouping_source,
    actions: compactOccurrences(event.anchor_action_ids, occurrenceById),
    cast: compactOccurrences(event.cast_ids, occurrenceById),
    place: compactOccurrences(event.place_ids, occurrenceById),
    time: compactOccurrences(event.time_ids, occurrenceById),
    objects: compactOccurrences(event.object_ids, occurrenceById),
    goals: compactOccurrences(event.goal_ids, occurrenceById),
    causality: compactOccurrences(event.causality_ids, occurrenceById),
  }
}

function countStats(
  events: V3EventCandidate[],
  scenes: V3SceneCandidate[],
): V3SceneGroupingArtifact["scene_stats"] {
  const boundaryBasisCounts: Record<V3SceneAxisKey, number> = {
    time: 0,
    place: 0,
    action_focus: 0,
    cast: 0,
  }
  const coveredEventIds = new Set<string>()
  const coveredPids = new Set<number>()

  for (const scene of scenes) {
    scene.event_ids.forEach((id) => coveredEventIds.add(id))
    for (let pid = scene.start_pid; pid <= scene.end_pid; pid += 1) {
      coveredPids.add(pid)
    }
    for (const axisKey of scene.boundary_basis) {
      boundaryBasisCounts[axisKey] += 1
    }
  }

  return {
    input_events: events.length,
    scene_candidates: scenes.length,
    fallback_scenes: scenes.filter((scene) => scene.grouping_source === "fallback_event").length,
    events_covered: coveredEventIds.size,
    paragraphs_covered: coveredPids.size,
    boundary_basis_counts: boundaryBasisCounts,
  }
}

export async function runV3SceneGrouping(
  eventGrouping: V3EventGroupingArtifact,
  llmClient: LLMClient,
  docId: string,
  chapterId: string,
  parents: Record<string, string> = {},
  onProgress?: (progress: string) => void,
): Promise<V3SceneGroupingArtifact> {
  onProgress?.("SCENE.0: grouping event candidates into scenes...")

  const events = eventGrouping.event_candidates
  if (events.length === 0) {
    return {
      run_id: `v3_scene_grouping__${docId}__${chapterId}`,
      doc_id: docId,
      chapter_id: chapterId,
      stage_id: "SCENE.0",
      method: "llm+rule",
      parents,
      extraction_profile: V3_SCENE_GROUPING_PROFILE,
      source_stage_ids: ["EVENT.1"],
      prompt_template: "v3_scene0_group_scenes",
      scene_stats: countStats(events, []),
      scene_candidates: [],
    }
  }

  const occurrenceById = new Map(
    eventGrouping.evidence_occurrences.map((occurrence) => [occurrence.source_candidate_id, occurrence]),
  )
  const result = await llmClient.groupV3Scenes({
    event_candidates_json: formatJsonParam(events.map((event) => compactEventForScene(event, occurrenceById))),
  })
  const rawScenes = Array.isArray(result.scene_candidates)
    ? result.scene_candidates as RawSceneCandidate[]
    : []
  const scenes = finalizeV3SceneCandidates(rawScenes, events, chapterId)

  onProgress?.(`SCENE.0: grouped ${events.length} events into ${scenes.length} scenes`)

  return {
    run_id: `v3_scene_grouping__${docId}__${chapterId}`,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: "SCENE.0",
    method: "llm+rule",
    parents,
    extraction_profile: V3_SCENE_GROUPING_PROFILE,
    source_stage_ids: ["EVENT.1"],
    prompt_template: "v3_scene0_group_scenes",
    scene_stats: countStats(events, scenes),
    scene_candidates: scenes,
  }
}
