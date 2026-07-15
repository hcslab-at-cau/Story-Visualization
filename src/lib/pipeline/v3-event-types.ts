import type { ArtifactBase } from "@/types/schema"
import type { V3EvidenceCandidateType } from "@/lib/pipeline/v3-evidence-types"
import type { V3ClusteredEntityType } from "@/lib/pipeline/v3-evidence-clustering-types"
import type { V3EvidenceGate, V3EvidenceGateBasis } from "@/lib/pipeline/v3-evidence-gate-types"
import type { V3RefinedEvidenceStatus } from "@/lib/pipeline/v3-evidence-refinement-types"

export const V3_EVENT_GROUPING_STAGE_ID = "EVENT.1" as const
export const V3_EVENT_GROUPING_PROFILE = "v3_event_grouping" as const

export type V3EventGroupingStageId = typeof V3_EVENT_GROUPING_STAGE_ID

export type V3EventGroupingSource = "llm" | "fallback_action"

export interface V3EventEvidenceOccurrence {
  source_candidate_id: string
  refined_candidate_id: string
  candidate_type: V3EvidenceCandidateType
  status: V3RefinedEvidenceStatus
  gate?: V3EvidenceGate
  gate_basis?: V3EvidenceGateBasis
  pid: number
  span: string
  start_char: number
  end_char: number
  normalized?: string
  label?: string
  subject_hint?: string
  object_hint?: string
  owner_span?: string
  target_span?: string
  cue_span?: string
  goal_text?: string
  cause_text?: string
  effect_text?: string
  entity_cluster_id?: string
  entity_cluster_label?: string
  entity_cluster_type?: V3ClusteredEntityType
  entity_cluster_aliases?: string[]
}

export interface V3EventCandidate {
  event_id: string
  sequence_index: number
  grouping_source: V3EventGroupingSource
  start_pid: number
  end_pid: number
  summary: string
  anchor_action_ids: string[]
  evidence_ids: string[]
  cast_ids: string[]
  place_ids: string[]
  time_ids: string[]
  object_ids: string[]
  goal_ids: string[]
  causality_ids: string[]
  rationale?: string
}

export interface V3EventGroupingArtifact extends ArtifactBase {
  stage_id: V3EventGroupingStageId
  method: "llm+rule"
  model?: string
  extraction_profile: typeof V3_EVENT_GROUPING_PROFILE
  source_stage_ids: ["EVID.3", "EVID.4"]
  prompt_template: "v3_event1_group_events"
  event_stats: {
    input_occurrences: number
    action_anchors: number
    event_candidates: number
    fallback_events: number
    paragraphs_covered: number
    by_start_pid: Record<string, number>
  }
  evidence_occurrences: V3EventEvidenceOccurrence[]
  event_candidates: V3EventCandidate[]
}
