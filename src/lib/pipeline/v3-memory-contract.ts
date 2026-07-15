import type { V3EventCandidate, V3EventEvidenceOccurrence, V3EventGroupingArtifact } from "./v3-event-types"
import type { V3SceneCandidate, V3SceneGroupingArtifact } from "./v3-scene-types"
import type {
  V3MemoryAxisRefs,
  V3MemoryContractArtifact,
  V3MemoryDiagnostic,
  V3MemoryEvidenceRef,
} from "./v3-memory-contract-types"

const V3_MEMORY_CONTRACT_STAGE_ID = "MEM.0"
const V3_MEMORY_CONTRACT_PROFILE = "v3_narrative_memory_contract"
const V3_MEMORY_CONTRACT_VERSION = "v3-memory-contract-0.1"

interface BuildV3MemoryContractParams {
  docId: string
  chapterId: string
  parents?: Record<string, string>
  eventGrouping: V3EventGroupingArtifact
  sceneGrouping: V3SceneGroupingArtifact
}

type AxisKey = keyof V3MemoryAxisRefs

const AXIS_SOURCES: Array<{ axis: AxisKey; field: keyof Pick<
  V3EventCandidate,
  "anchor_action_ids" | "cast_ids" | "place_ids" | "time_ids" | "object_ids" | "goal_ids" | "causality_ids"
> }> = [
  { axis: "action", field: "anchor_action_ids" },
  { axis: "cast", field: "cast_ids" },
  { axis: "place", field: "place_ids" },
  { axis: "time", field: "time_ids" },
  { axis: "object", field: "object_ids" },
  { axis: "goal", field: "goal_ids" },
  { axis: "causality", field: "causality_ids" },
]

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)))
}

function emptyAxisRefs(): V3MemoryAxisRefs {
  return {
    action: [],
    cast: [],
    place: [],
    time: [],
    object: [],
    goal: [],
    causality: [],
  }
}

function diagnostic(
  code: V3MemoryDiagnostic["code"],
  severity: V3MemoryDiagnostic["severity"],
  message: string,
  refId?: string,
): V3MemoryDiagnostic {
  return {
    code,
    severity,
    message,
    ...(refId ? { ref_id: refId } : {}),
  }
}

function evidenceRefFromOccurrence(occurrence: V3EventEvidenceOccurrence): V3MemoryEvidenceRef {
  return {
    source_candidate_id: occurrence.source_candidate_id,
    refined_candidate_id: occurrence.refined_candidate_id,
    candidate_type: occurrence.candidate_type,
    gate: occurrence.gate,
    gate_basis: occurrence.gate_basis,
    pid: occurrence.pid,
    span: occurrence.span,
    label: occurrence.normalized ?? occurrence.label,
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
  }
}

function countDuplicates(ids: string[]): Set<string> {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id)
    seen.add(id)
  }
  return duplicates
}

function addSceneMembership(
  scenes: V3SceneCandidate[],
  eventById: Map<string, V3EventCandidate>,
  diagnostics: V3MemoryDiagnostic[],
): Map<string, string[]> {
  const membership = new Map<string, string[]>()

  for (const scene of scenes) {
    const validEventIds = scene.event_ids.filter((eventId) => eventById.has(eventId))
    if (validEventIds.length === 0) {
      diagnostics.push(diagnostic(
        "scene_without_event",
        "error",
        `Scene ${scene.scene_id} does not reference any valid event.`,
        scene.scene_id,
      ))
    }

    for (const eventId of scene.event_ids) {
      if (!eventById.has(eventId)) {
        diagnostics.push(diagnostic(
          "scene_unknown_event",
          "error",
          `Scene ${scene.scene_id} references unknown event ${eventId}.`,
          scene.scene_id,
        ))
        continue
      }
      membership.set(eventId, [...(membership.get(eventId) ?? []), scene.scene_id])
    }
  }

  return membership
}

export function buildV3MemoryContract({
  docId,
  chapterId,
  parents = {},
  eventGrouping,
  sceneGrouping,
}: BuildV3MemoryContractParams): V3MemoryContractArtifact {
  const diagnostics: V3MemoryDiagnostic[] = []
  const events = eventGrouping.event_candidates
  const scenes = sceneGrouping.scene_candidates
  const eventById = new Map(events.map((event) => [event.event_id, event]))
  const occurrenceById = new Map(
    eventGrouping.evidence_occurrences.map((occurrence) => [occurrence.source_candidate_id, occurrence]),
  )
  const duplicateEventIds = countDuplicates(events.map((event) => event.event_id))
  const duplicateSceneIds = countDuplicates(scenes.map((scene) => scene.scene_id))

  duplicateEventIds.forEach((eventId) => {
    diagnostics.push(diagnostic("duplicate_event_id", "error", `Duplicate event id ${eventId}.`, eventId))
  })
  duplicateSceneIds.forEach((sceneId) => {
    diagnostics.push(diagnostic("duplicate_scene_id", "error", `Duplicate scene id ${sceneId}.`, sceneId))
  })

  const sceneMembership = addSceneMembership(scenes, eventById, diagnostics)
  let supportAxisRefs = 0
  let dropAxisRefs = 0
  let missingOccurrenceRefs = 0

  const contractEvents = events.map((event) => {
    const sceneIds = sceneMembership.get(event.event_id) ?? []
    if (sceneIds.length === 0) {
      diagnostics.push(diagnostic(
        "event_without_scene",
        "warning",
        `Event ${event.event_id} is not assigned to any scene.`,
        event.event_id,
      ))
    } else if (sceneIds.length > 1) {
      diagnostics.push(diagnostic(
        "event_in_multiple_scenes",
        "error",
        `Event ${event.event_id} is assigned to multiple scenes: ${sceneIds.join(", ")}.`,
        event.event_id,
      ))
    }

    const axisRefs = emptyAxisRefs()
    const contextEvidenceRefs: string[] = []
    const droppedEvidenceRefs: string[] = []
    const acceptedEvidenceRefs: string[] = []

    for (const { axis, field } of AXIS_SOURCES) {
      for (const id of event[field]) {
        const occurrence = occurrenceById.get(id)
        if (!occurrence) {
          missingOccurrenceRefs += 1
          diagnostics.push(diagnostic(
            "missing_occurrence_ref",
            "error",
            `Event ${event.event_id} references missing evidence occurrence ${id}.`,
            event.event_id,
          ))
          continue
        }

        if (occurrence.gate === "support") {
          supportAxisRefs += 1
          contextEvidenceRefs.push(id)
          diagnostics.push(diagnostic(
            "support_axis_ref",
            "warning",
            `Event ${event.event_id} had support evidence ${id} on ${axis}; kept as context only.`,
            event.event_id,
          ))
          continue
        }

        if (occurrence.gate === "drop") {
          dropAxisRefs += 1
          droppedEvidenceRefs.push(id)
          diagnostics.push(diagnostic(
            "drop_axis_ref",
            "error",
            `Event ${event.event_id} had dropped evidence ${id} on ${axis}; removed from core axes.`,
            event.event_id,
          ))
          continue
        }

        axisRefs[axis].push(id)
        acceptedEvidenceRefs.push(id)
      }
    }

    for (const id of event.evidence_ids) {
      const occurrence = occurrenceById.get(id)
      if (!occurrence) continue
      if (occurrence.gate === "support") contextEvidenceRefs.push(id)
      else if (occurrence.gate === "drop") droppedEvidenceRefs.push(id)
      else acceptedEvidenceRefs.push(id)
    }

    return {
      event_id: event.event_id,
      ...(sceneIds[0] ? { scene_id: sceneIds[0] } : {}),
      event_order: event.sequence_index,
      grouping_source: event.grouping_source,
      text_span: {
        start_pid: event.start_pid,
        end_pid: event.end_pid,
      },
      summary: event.summary,
      trigger_refs: unique(event.anchor_action_ids.filter((id) => axisRefs.action.includes(id))),
      axis_refs: {
        action: unique(axisRefs.action),
        cast: unique(axisRefs.cast),
        place: unique(axisRefs.place),
        time: unique(axisRefs.time),
        object: unique(axisRefs.object),
        goal: unique(axisRefs.goal),
        causality: unique(axisRefs.causality),
      },
      evidence_refs: unique(acceptedEvidenceRefs),
      context_evidence_refs: unique(contextEvidenceRefs),
      dropped_evidence_refs: unique(droppedEvidenceRefs),
      scope: "actual_story_world" as const,
      confidence: sceneIds.length === 1 ? "high" as const : "medium" as const,
    }
  })

  const contractScenes = scenes.map((scene) => ({
    scene_id: scene.scene_id,
    scene_order: scene.sequence_index,
    grouping_source: scene.grouping_source,
    event_ids: scene.event_ids.filter((eventId) => eventById.has(eventId)),
    text_span: {
      start_pid: scene.start_pid,
      end_pid: scene.end_pid,
    },
    boundary_axes: scene.boundary_basis,
    summary: scene.summary,
    axis_labels: {
      time: scene.time_axis.label,
      place: scene.place_axis.label,
      action_focus: scene.action_focus_axis.label,
      cast: scene.cast_axis.label,
    },
    confidence: scene.event_ids.some((eventId) => eventById.has(eventId)) ? "high" as const : "low" as const,
  }))

  const assignedEvents = contractEvents.filter((event) => Boolean(event.scene_id)).length
  const scenesWithoutEvents = contractScenes.filter((scene) => scene.event_ids.length === 0).length

  return {
    run_id: `v3_memory_contract__${docId}__${chapterId}`,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: V3_MEMORY_CONTRACT_STAGE_ID,
    method: "rule",
    parents,
    artifact_version: V3_MEMORY_CONTRACT_VERSION,
    extraction_profile: V3_MEMORY_CONTRACT_PROFILE,
    source_stage_ids: ["EVENT.1", "SCENE.0"],
    contract_stats: {
      events_total: events.length,
      scenes_total: scenes.length,
      events_assigned: assignedEvents,
      events_unassigned: events.length - assignedEvents,
      scenes_without_events: scenesWithoutEvents,
      diagnostics_total: diagnostics.length,
      support_axis_refs: supportAxisRefs,
      drop_axis_refs: dropAxisRefs,
      missing_occurrence_refs: missingOccurrenceRefs,
    },
    evidence_refs: eventGrouping.evidence_occurrences.map(evidenceRefFromOccurrence),
    events: contractEvents,
    scenes: contractScenes,
    diagnostics,
  }
}
