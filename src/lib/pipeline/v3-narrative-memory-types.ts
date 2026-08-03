import type { ArtifactBase } from "@/types/schema"
import type { V3MemoryConfidence, V3MemoryTextSpan } from "@/lib/pipeline/v3-memory-contract-types"

export const V3_GOAL_GROUNDING_STAGE_ID = "GOAL.1" as const
export const V3_GOAL_GROUNDING_PROFILE = "v3_goal_grounding" as const
export const V3_GOAL_GROUNDING_VERSION = "v3-goal-grounding-0.1" as const

export const V3_CAUSAL_EDGE_STAGE_ID = "CAUS.1" as const
export const V3_CAUSAL_EDGE_PROFILE = "v3_causal_edge_candidates" as const
export const V3_CAUSAL_EDGE_VERSION = "v3-causal-edge-candidates-0.1" as const

export const V3_PROGRESSIVE_MEMORY_STAGE_ID = "MEM.2" as const
export const V3_PROGRESSIVE_MEMORY_PROFILE = "v3_progressive_narrative_memory" as const
export const V3_PROGRESSIVE_MEMORY_VERSION = "v3-progressive-narrative-memory-0.1" as const

export const V3_RETRIEVAL_INDEX_STAGE_ID = "IDX.1" as const
export const V3_RETRIEVAL_INDEX_PROFILE = "v3_retrieval_index" as const
export const V3_RETRIEVAL_INDEX_LEGACY_VERSION = "v3-retrieval-index-0.1" as const
export const V3_RETRIEVAL_INDEX_VERSION = "v3-retrieval-index-0.2" as const

export type V3GoalGroundingStageId = typeof V3_GOAL_GROUNDING_STAGE_ID
export type V3CausalEdgeStageId = typeof V3_CAUSAL_EDGE_STAGE_ID
export type V3ProgressiveMemoryStageId = typeof V3_PROGRESSIVE_MEMORY_STAGE_ID
export type V3RetrievalIndexStageId = typeof V3_RETRIEVAL_INDEX_STAGE_ID

export interface V3GroundedGoalHolder {
  ref_id: string
  label: string
  evidence_ref: string
}

export interface V3GroundedGoal {
  goal_id: string
  holder?: V3GroundedGoalHolder
  content: string
  introduced_in_event: string
  scene_id?: string
  status_for_now: "unknown"
  evidence_refs: string[]
  explicitness: "explicit"
  confidence: V3MemoryConfidence
}

export interface V3GoalGroundingArtifact extends ArtifactBase {
  stage_id: V3GoalGroundingStageId
  method: "rule"
  artifact_version: typeof V3_GOAL_GROUNDING_VERSION
  extraction_profile: typeof V3_GOAL_GROUNDING_PROFILE
  source_stage_ids: ["MEM.0", "MEM.1", "EVENT.2"]
  goal_stats: {
    input_goal_cues: number
    grounded_goals: number
    goals_with_holder: number
  }
  grounded_goals: V3GroundedGoal[]
}

export type V3CausalRelationType = "causes"

export interface V3CausalEdge {
  edge_id: string
  from_event: string
  to_event: string
  relation_type: V3CausalRelationType
  evidence_refs: string[]
  explicitness: "explicit"
  confidence: V3MemoryConfidence
  direction_confidence: V3MemoryConfidence
}

export interface V3UnresolvedCausalCue {
  cue_ref: string
  event_id: string
  cause_text?: string
  effect_text?: string
  reason: "missing_cause_or_effect_text" | "unresolved_event_endpoint" | "self_edge"
}

export interface V3CausalEdgesArtifact extends ArtifactBase {
  stage_id: V3CausalEdgeStageId
  method: "rule"
  artifact_version: typeof V3_CAUSAL_EDGE_VERSION
  extraction_profile: typeof V3_CAUSAL_EDGE_PROFILE
  source_stage_ids: ["MEM.0", "EVENT.2", "GOAL.1"]
  causal_stats: {
    input_causal_cues: number
    causal_edges: number
    unresolved_cues: number
  }
  causal_edges: V3CausalEdge[]
  unresolved_cues: V3UnresolvedCausalCue[]
}

export interface V3MemoryAppearance {
  scene_id?: string
  event_id: string
  evidence_refs: string[]
}

export interface V3CharacterMemory {
  character_ref: string
  label: string
  appearances: V3MemoryAppearance[]
  active_goal_refs: string[]
  recent_event_refs: string[]
}

export interface V3PlaceMemory {
  place_ref: string
  label: string
  scene_ids: string[]
  event_ids: string[]
}

export interface V3ObjectMemory {
  object_ref: string
  label: string
  first_seen_event: string
  linked_event_refs: string[]
  linked_goal_refs: string[]
}

export interface V3EventTimelineEntry {
  event_id: string
  scene_id?: string
  story_order: number
  discourse_order: number
  text_span?: V3MemoryTextSpan
}

export interface V3ProgressiveNarrativeMemoryArtifact extends ArtifactBase {
  stage_id: V3ProgressiveMemoryStageId
  method: "rule"
  artifact_version: typeof V3_PROGRESSIVE_MEMORY_VERSION
  extraction_profile: typeof V3_PROGRESSIVE_MEMORY_PROFILE
  source_stage_ids: ["MEM.1", "EVENT.2", "GOAL.1", "CAUS.1"]
  memory_stats: {
    characters: number
    places: number
    objects: number
    goals: number
    causal_edges: number
    timeline_events: number
  }
  character_memories: V3CharacterMemory[]
  place_memories: V3PlaceMemory[]
  object_memories: V3ObjectMemory[]
  goal_memory: V3GroundedGoal[]
  event_timeline: V3EventTimelineEntry[]
  causal_graph: {
    edges: V3CausalEdge[]
  }
}

export type V3RetrievalRecordType = "paragraph" | "scene" | "event" | "character" | "place" | "object" | "goal" | "causal_edge"

export interface V3StructuredRetrievalRecord {
  record_id: string
  record_type: V3RetrievalRecordType
  label: string
  source_paragraph_id?: string
  entity_refs?: string[]
  scene_id?: string
  event_id?: string
  evidence_refs: string[]
  progress_start?: number
  progress_end?: number
}

export interface V3RetrievalGraphEdge {
  edge_id: string
  from: string
  to: string
  relation_type: string
  evidence_refs: string[]
}

export interface V3RetrievalTextDocument {
  text_doc_id: string
  doc_type: V3RetrievalRecordType
  text: string
  scene_id?: string
  event_id?: string
  evidence_refs: string[]
}

export interface V3RetrievalIndexArtifact extends ArtifactBase {
  stage_id: V3RetrievalIndexStageId
  method: "rule"
  artifact_version: typeof V3_RETRIEVAL_INDEX_LEGACY_VERSION | typeof V3_RETRIEVAL_INDEX_VERSION
  extraction_profile: typeof V3_RETRIEVAL_INDEX_PROFILE
  source_stage_ids:
    | ["MEM.1", "EVENT.2", "GOAL.1", "CAUS.1", "MEM.2"]
    | ["PRE.1", "PRE.2", "EVID.4", "MEM.1", "EVENT.2", "GOAL.1", "CAUS.1", "MEM.2"]
  index_stats: {
    structured_records: number
    graph_edges: number
    text_documents: number
  }
  structured_records: V3StructuredRetrievalRecord[]
  graph_edges: V3RetrievalGraphEdge[]
  text_documents: V3RetrievalTextDocument[]
}
