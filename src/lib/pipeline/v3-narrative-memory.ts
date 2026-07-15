import type { V3MemoryContractArtifact, V3MemoryEvidenceRef } from "./v3-memory-contract-types"
import type { V3EventFrame, V3EventFramesArtifact, V3SceneSituationCardsArtifact } from "./v3-memory-frames-types"
import type {
  V3CausalEdge,
  V3CausalEdgesArtifact,
  V3CharacterMemory,
  V3GoalGroundingArtifact,
  V3GroundedGoal,
  V3ObjectMemory,
  V3PlaceMemory,
  V3ProgressiveNarrativeMemoryArtifact,
  V3RetrievalGraphEdge,
  V3RetrievalIndexArtifact,
  V3RetrievalTextDocument,
  V3StructuredRetrievalRecord,
} from "./v3-narrative-memory-types"

const V3_GOAL_GROUNDING_STAGE_ID = "GOAL.1"
const V3_GOAL_GROUNDING_PROFILE = "v3_goal_grounding"
const V3_GOAL_GROUNDING_VERSION = "v3-goal-grounding-0.1"
const V3_CAUSAL_EDGE_STAGE_ID = "CAUS.1"
const V3_CAUSAL_EDGE_PROFILE = "v3_causal_edge_candidates"
const V3_CAUSAL_EDGE_VERSION = "v3-causal-edge-candidates-0.1"
const V3_PROGRESSIVE_MEMORY_STAGE_ID = "MEM.2"
const V3_PROGRESSIVE_MEMORY_PROFILE = "v3_progressive_narrative_memory"
const V3_PROGRESSIVE_MEMORY_VERSION = "v3-progressive-narrative-memory-0.1"
const V3_RETRIEVAL_INDEX_STAGE_ID = "IDX.1"
const V3_RETRIEVAL_INDEX_PROFILE = "v3_retrieval_index"
const V3_RETRIEVAL_INDEX_VERSION = "v3-retrieval-index-0.1"

interface BaseBuildParams {
  docId: string
  chapterId: string
  parents?: Record<string, string>
}

interface BuildV3GroundedGoalsParams extends BaseBuildParams {
  memoryContract: V3MemoryContractArtifact
  sceneCards: V3SceneSituationCardsArtifact
  eventFrames: V3EventFramesArtifact
}

interface BuildV3CausalEdgesParams extends BaseBuildParams {
  memoryContract: V3MemoryContractArtifact
  eventFrames: V3EventFramesArtifact
  groundedGoals: V3GoalGroundingArtifact
}

interface BuildV3ProgressiveNarrativeMemoryParams extends BaseBuildParams {
  sceneCards: V3SceneSituationCardsArtifact
  eventFrames: V3EventFramesArtifact
  groundedGoals: V3GoalGroundingArtifact
  causalEdges: V3CausalEdgesArtifact
}

interface BuildV3RetrievalIndexParams extends BaseBuildParams {
  sceneCards: V3SceneSituationCardsArtifact
  eventFrames: V3EventFramesArtifact
  groundedGoals: V3GoalGroundingArtifact
  causalEdges: V3CausalEdgesArtifact
  progressiveMemory: V3ProgressiveNarrativeMemoryArtifact
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)))
}

function normalized(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim()
}

function evidenceLabel(ref: V3MemoryEvidenceRef | undefined, fallback: string): string {
  return ref?.goal_text ?? ref?.entity_cluster_label ?? ref?.label ?? ref?.span ?? fallback
}

function evidenceById(memoryContract: V3MemoryContractArtifact): Map<string, V3MemoryEvidenceRef> {
  return new Map(memoryContract.evidence_refs.map((evidence) => [evidence.source_candidate_id, evidence]))
}

function actorFor(frame: V3EventFrame) {
  return frame.arguments.find((argument) => argument.role === "actor")
}

export function buildV3GroundedGoals({
  docId,
  chapterId,
  parents = {},
  memoryContract,
  eventFrames,
}: BuildV3GroundedGoalsParams): V3GoalGroundingArtifact {
  const evidence = evidenceById(memoryContract)
  const groundedGoals: V3GroundedGoal[] = eventFrames.event_frames.flatMap((frame) => {
    const holder = actorFor(frame)
    return frame.goal_cue_refs.flatMap((goalRef) => {
      const cue = evidence.get(goalRef)
      if (!cue) return []
      return [{
        goal_id: `GOAL_${frame.event_id}_${goalRef}`,
        ...(holder ? {
          holder: {
            ref_id: holder.ref_id,
            label: holder.label,
            evidence_ref: holder.evidence_ref,
          },
        } : {}),
        content: evidenceLabel(cue, goalRef),
        introduced_in_event: frame.event_id,
        ...(frame.scene_id ? { scene_id: frame.scene_id } : {}),
        status_for_now: "unknown" as const,
        evidence_refs: [goalRef],
        explicitness: "explicit" as const,
        confidence: holder ? "high" as const : "medium" as const,
      }]
    })
  })

  return {
    run_id: `v3_goal_grounding__${docId}__${chapterId}`,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: V3_GOAL_GROUNDING_STAGE_ID,
    method: "rule",
    parents,
    artifact_version: V3_GOAL_GROUNDING_VERSION,
    extraction_profile: V3_GOAL_GROUNDING_PROFILE,
    source_stage_ids: ["MEM.0", "MEM.1", "EVENT.2"],
    goal_stats: {
      input_goal_cues: eventFrames.event_frames.reduce((total, frame) => total + frame.goal_cue_refs.length, 0),
      grounded_goals: groundedGoals.length,
      goals_with_holder: groundedGoals.filter((goal) => Boolean(goal.holder)).length,
    },
    grounded_goals: groundedGoals,
  }
}

function eventSearchText(frame: V3EventFrame, memoryContract: V3MemoryContractArtifact): string {
  const contractEvent = memoryContract.events.find((event) => event.event_id === frame.event_id)
  return normalized([
    frame.predicate,
    contractEvent?.summary,
    ...frame.evidence_refs.map((ref) => evidenceLabel(evidenceById(memoryContract).get(ref), ref)),
  ].join(" "))
}

function findEventByText(
  frames: V3EventFrame[],
  memoryContract: V3MemoryContractArtifact,
  text: string | undefined,
): V3EventFrame | undefined {
  const query = normalized(text)
  if (!query) return undefined
  return frames.find((frame) => {
    const haystack = eventSearchText(frame, memoryContract)
    return haystack.includes(query) || query.includes(normalized(frame.predicate))
  })
}

export function buildV3CausalEdges({
  docId,
  chapterId,
  parents = {},
  memoryContract,
  eventFrames,
}: BuildV3CausalEdgesParams): V3CausalEdgesArtifact {
  const evidence = evidenceById(memoryContract)
  const causalEdges: V3CausalEdge[] = []
  const unresolvedCues: V3CausalEdgesArtifact["unresolved_cues"] = []

  for (const frame of eventFrames.event_frames) {
    for (const cueRef of frame.causal_cue_refs) {
      const cue = evidence.get(cueRef)
      if (!cue?.cause_text || !cue.effect_text) {
        unresolvedCues.push({
          cue_ref: cueRef,
          event_id: frame.event_id,
          cause_text: cue?.cause_text,
          effect_text: cue?.effect_text,
          reason: "missing_cause_or_effect_text",
        })
        continue
      }

      const fromEvent = findEventByText(eventFrames.event_frames, memoryContract, cue.cause_text)
      const toEvent = findEventByText(eventFrames.event_frames, memoryContract, cue.effect_text)
      if (!fromEvent || !toEvent) {
        unresolvedCues.push({
          cue_ref: cueRef,
          event_id: frame.event_id,
          cause_text: cue.cause_text,
          effect_text: cue.effect_text,
          reason: "unresolved_event_endpoint",
        })
        continue
      }
      if (fromEvent.event_id === toEvent.event_id) {
        unresolvedCues.push({
          cue_ref: cueRef,
          event_id: frame.event_id,
          cause_text: cue.cause_text,
          effect_text: cue.effect_text,
          reason: "self_edge",
        })
        continue
      }

      causalEdges.push({
        edge_id: `CAUS_${fromEvent.event_id}_${toEvent.event_id}_${cueRef}`,
        from_event: fromEvent.event_id,
        to_event: toEvent.event_id,
        relation_type: "causes",
        evidence_refs: [cueRef],
        explicitness: "explicit",
        confidence: "high",
        direction_confidence: "high",
      })
    }
  }

  return {
    run_id: `v3_causal_edges__${docId}__${chapterId}`,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: V3_CAUSAL_EDGE_STAGE_ID,
    method: "rule",
    parents,
    artifact_version: V3_CAUSAL_EDGE_VERSION,
    extraction_profile: V3_CAUSAL_EDGE_PROFILE,
    source_stage_ids: ["MEM.0", "EVENT.2", "GOAL.1"],
    causal_stats: {
      input_causal_cues: eventFrames.event_frames.reduce((total, frame) => total + frame.causal_cue_refs.length, 0),
      causal_edges: causalEdges.length,
      unresolved_cues: unresolvedCues.length,
    },
    causal_edges: causalEdges,
    unresolved_cues: unresolvedCues,
  }
}

function addAppearance(
  map: Map<string, V3CharacterMemory>,
  argument: V3EventFrame["arguments"][number],
  frame: V3EventFrame,
): void {
  const current = map.get(argument.ref_id) ?? {
    character_ref: argument.ref_id,
    label: argument.label,
    appearances: [],
    active_goal_refs: [],
    recent_event_refs: [],
  }
  current.appearances.push({
    scene_id: frame.scene_id,
    event_id: frame.event_id,
    evidence_refs: [argument.evidence_ref],
  })
  current.recent_event_refs = unique([...current.recent_event_refs, frame.event_id])
  map.set(argument.ref_id, current)
}

export function buildV3ProgressiveNarrativeMemory({
  docId,
  chapterId,
  parents = {},
  eventFrames,
  groundedGoals,
  causalEdges,
}: BuildV3ProgressiveNarrativeMemoryParams): V3ProgressiveNarrativeMemoryArtifact {
  const characters = new Map<string, V3CharacterMemory>()
  const places = new Map<string, V3PlaceMemory>()
  const objects = new Map<string, V3ObjectMemory>()

  for (const frame of eventFrames.event_frames) {
    for (const argument of frame.arguments) {
      if (argument.role === "actor" || argument.role === "mentioned_only") {
        addAppearance(characters, argument, frame)
      }
      if (argument.role === "location") {
        const current = places.get(argument.ref_id) ?? {
          place_ref: argument.ref_id,
          label: argument.label,
          scene_ids: [],
          event_ids: [],
        }
        current.scene_ids = unique([...current.scene_ids, ...(frame.scene_id ? [frame.scene_id] : [])])
        current.event_ids = unique([...current.event_ids, frame.event_id])
        places.set(argument.ref_id, current)
      }
      if (argument.role === "target_object" || argument.role === "theme_object" || argument.role === "instrument") {
        const current = objects.get(argument.ref_id) ?? {
          object_ref: argument.ref_id,
          label: argument.label,
          first_seen_event: frame.event_id,
          linked_event_refs: [],
          linked_goal_refs: [],
        }
        current.linked_event_refs = unique([...current.linked_event_refs, frame.event_id])
        objects.set(argument.ref_id, current)
      }
    }
  }

  for (const goal of groundedGoals.grounded_goals) {
    if (goal.holder) {
      const character = characters.get(goal.holder.ref_id)
      if (character) character.active_goal_refs = unique([...character.active_goal_refs, goal.goal_id])
    }
    const frame = eventFrames.event_frames.find((event) => event.event_id === goal.introduced_in_event)
    for (const argument of frame?.arguments ?? []) {
      if (argument.role === "target_object" || argument.role === "theme_object") {
        const objectMemory = objects.get(argument.ref_id)
        if (objectMemory) objectMemory.linked_goal_refs = unique([...objectMemory.linked_goal_refs, goal.goal_id])
      }
    }
  }

  const eventTimeline = eventFrames.event_frames.map((frame) => ({
    event_id: frame.event_id,
    ...(frame.scene_id ? { scene_id: frame.scene_id } : {}),
    story_order: frame.event_order,
    discourse_order: frame.event_order,
  }))

  return {
    run_id: `v3_progressive_memory__${docId}__${chapterId}`,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: V3_PROGRESSIVE_MEMORY_STAGE_ID,
    method: "rule",
    parents,
    artifact_version: V3_PROGRESSIVE_MEMORY_VERSION,
    extraction_profile: V3_PROGRESSIVE_MEMORY_PROFILE,
    source_stage_ids: ["MEM.1", "EVENT.2", "GOAL.1", "CAUS.1"],
    memory_stats: {
      characters: characters.size,
      places: places.size,
      objects: objects.size,
      goals: groundedGoals.grounded_goals.length,
      causal_edges: causalEdges.causal_edges.length,
      timeline_events: eventTimeline.length,
    },
    character_memories: [...characters.values()],
    place_memories: [...places.values()],
    object_memories: [...objects.values()],
    goal_memory: groundedGoals.grounded_goals,
    event_timeline: eventTimeline,
    causal_graph: {
      edges: causalEdges.causal_edges,
    },
  }
}

export function buildV3RetrievalIndex({
  docId,
  chapterId,
  parents = {},
  sceneCards,
  eventFrames,
  groundedGoals,
  causalEdges,
  progressiveMemory,
}: BuildV3RetrievalIndexParams): V3RetrievalIndexArtifact {
  const structuredRecords: V3StructuredRetrievalRecord[] = []
  const graphEdges: V3RetrievalGraphEdge[] = []
  const textDocuments: V3RetrievalTextDocument[] = []

  for (const scene of sceneCards.scene_cards) {
    structuredRecords.push({
      record_id: scene.scene_id,
      record_type: "scene",
      label: scene.situation.action_focus,
      scene_id: scene.scene_id,
      evidence_refs: scene.evidence_refs,
      progress_start: scene.text_span.start_pid,
      progress_end: scene.text_span.end_pid,
    })
    textDocuments.push({
      text_doc_id: `TEXT_${scene.scene_id}`,
      doc_type: "scene",
      text: scene.summary_for_retrieval,
      scene_id: scene.scene_id,
      evidence_refs: scene.evidence_refs,
    })
  }

  for (const frame of eventFrames.event_frames) {
    structuredRecords.push({
      record_id: frame.event_id,
      record_type: "event",
      label: frame.predicate,
      scene_id: frame.scene_id,
      event_id: frame.event_id,
      evidence_refs: frame.evidence_refs,
    })
    textDocuments.push({
      text_doc_id: `TEXT_${frame.event_id}`,
      doc_type: "event",
      text: frame.predicate,
      scene_id: frame.scene_id,
      event_id: frame.event_id,
      evidence_refs: frame.evidence_refs,
    })
    if (frame.scene_id) {
      graphEdges.push({
        edge_id: `EDGE_${frame.event_id}_SCENE_${frame.scene_id}`,
        from: frame.event_id,
        to: frame.scene_id,
        relation_type: "occurs_in",
        evidence_refs: frame.evidence_refs,
      })
    }
  }

  for (const goal of groundedGoals.grounded_goals) {
    structuredRecords.push({
      record_id: goal.goal_id,
      record_type: "goal",
      label: goal.content,
      scene_id: goal.scene_id,
      event_id: goal.introduced_in_event,
      evidence_refs: goal.evidence_refs,
    })
    textDocuments.push({
      text_doc_id: `TEXT_${goal.goal_id}`,
      doc_type: "goal",
      text: goal.content,
      scene_id: goal.scene_id,
      event_id: goal.introduced_in_event,
      evidence_refs: goal.evidence_refs,
    })
    graphEdges.push({
      edge_id: `EDGE_${goal.introduced_in_event}_GOAL_${goal.goal_id}`,
      from: goal.introduced_in_event,
      to: goal.goal_id,
      relation_type: "has_goal",
      evidence_refs: goal.evidence_refs,
    })
    if (goal.holder) {
      graphEdges.push({
        edge_id: `EDGE_${goal.holder.ref_id}_GOAL_${goal.goal_id}`,
        from: goal.holder.ref_id,
        to: goal.goal_id,
        relation_type: "holds_goal",
        evidence_refs: goal.evidence_refs,
      })
    }
  }

  for (const edge of causalEdges.causal_edges) {
    structuredRecords.push({
      record_id: edge.edge_id,
      record_type: "causal_edge",
      label: `${edge.from_event} causes ${edge.to_event}`,
      event_id: edge.to_event,
      evidence_refs: edge.evidence_refs,
    })
    graphEdges.push({
      edge_id: edge.edge_id,
      from: edge.from_event,
      to: edge.to_event,
      relation_type: edge.relation_type,
      evidence_refs: edge.evidence_refs,
    })
    textDocuments.push({
      text_doc_id: `TEXT_${edge.edge_id}`,
      doc_type: "causal_edge",
      text: `${edge.from_event} causes ${edge.to_event}`,
      event_id: edge.to_event,
      evidence_refs: edge.evidence_refs,
    })
  }

  for (const character of progressiveMemory.character_memories) {
    const firstAppearance = character.appearances[0]
    structuredRecords.push({
      record_id: character.character_ref,
      record_type: "character",
      label: character.label,
      scene_id: firstAppearance?.scene_id,
      event_id: firstAppearance?.event_id,
      evidence_refs: unique(character.appearances.flatMap((appearance) => appearance.evidence_refs)),
    })
  }
  for (const place of progressiveMemory.place_memories) {
    structuredRecords.push({
      record_id: place.place_ref,
      record_type: "place",
      label: place.label,
      scene_id: place.scene_ids[0],
      evidence_refs: [],
    })
  }
  for (const object of progressiveMemory.object_memories) {
    structuredRecords.push({
      record_id: object.object_ref,
      record_type: "object",
      label: object.label,
      event_id: object.first_seen_event,
      evidence_refs: [],
    })
  }

  return {
    run_id: `v3_retrieval_index__${docId}__${chapterId}`,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: V3_RETRIEVAL_INDEX_STAGE_ID,
    method: "rule",
    parents,
    artifact_version: V3_RETRIEVAL_INDEX_VERSION,
    extraction_profile: V3_RETRIEVAL_INDEX_PROFILE,
    source_stage_ids: ["MEM.1", "EVENT.2", "GOAL.1", "CAUS.1", "MEM.2"],
    index_stats: {
      structured_records: structuredRecords.length,
      graph_edges: graphEdges.length,
      text_documents: textDocuments.length,
    },
    structured_records: structuredRecords,
    graph_edges: graphEdges,
    text_documents: textDocuments,
  }
}
