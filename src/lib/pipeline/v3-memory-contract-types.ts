import type { ArtifactBase } from "@/types/schema"
import type { V3EvidenceCandidateType } from "@/lib/pipeline/v3-evidence-types"
import type { V3EvidenceGate, V3EvidenceGateBasis } from "@/lib/pipeline/v3-evidence-gate-types"
import type { V3EventGroupingSource } from "@/lib/pipeline/v3-event-types"
import type { V3SceneAxisKey, V3SceneGroupingSource } from "@/lib/pipeline/v3-scene-types"

export const V3_MEMORY_CONTRACT_STAGE_ID = "MEM.0" as const
export const V3_MEMORY_CONTRACT_PROFILE = "v3_narrative_memory_contract" as const
export const V3_MEMORY_CONTRACT_VERSION = "v3-memory-contract-0.1" as const

export type V3MemoryContractStageId = typeof V3_MEMORY_CONTRACT_STAGE_ID
export type V3MemoryDiagnosticSeverity = "info" | "warning" | "error"
export type V3MemoryConfidence = "high" | "medium" | "low"
export type V3MemoryScope = "actual_story_world" | "quoted_speech" | "imagined" | "memory" | "uncertain"

export type V3MemoryDiagnosticCode =
  | "duplicate_event_id"
  | "duplicate_scene_id"
  | "scene_without_event"
  | "scene_unknown_event"
  | "event_without_scene"
  | "event_in_multiple_scenes"
  | "support_axis_ref"
  | "drop_axis_ref"
  | "missing_occurrence_ref"

export interface V3MemoryTextSpan {
  start_pid: number
  end_pid: number
}

export interface V3MemoryAxisRefs {
  action: string[]
  cast: string[]
  place: string[]
  time: string[]
  object: string[]
  goal: string[]
  causality: string[]
}

export interface V3MemoryEvidenceRef {
  source_candidate_id: string
  refined_candidate_id: string
  candidate_type: V3EvidenceCandidateType
  gate?: V3EvidenceGate
  gate_basis?: V3EvidenceGateBasis
  pid: number
  span: string
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
}

export interface V3MemoryEventContract {
  event_id: string
  scene_id?: string
  event_order: number
  grouping_source: V3EventGroupingSource
  text_span: V3MemoryTextSpan
  summary: string
  trigger_refs: string[]
  axis_refs: V3MemoryAxisRefs
  evidence_refs: string[]
  context_evidence_refs: string[]
  dropped_evidence_refs: string[]
  scope: V3MemoryScope
  confidence: V3MemoryConfidence
}

export interface V3MemorySceneContract {
  scene_id: string
  scene_order: number
  grouping_source: V3SceneGroupingSource
  event_ids: string[]
  text_span: V3MemoryTextSpan
  boundary_axes: V3SceneAxisKey[]
  summary: string
  axis_labels: {
    time: string
    place: string
    action_focus: string
    cast: string
  }
  confidence: V3MemoryConfidence
}

export interface V3MemoryDiagnostic {
  severity: V3MemoryDiagnosticSeverity
  code: V3MemoryDiagnosticCode
  ref_id?: string
  message: string
}

export interface V3MemoryContractArtifact extends ArtifactBase {
  stage_id: V3MemoryContractStageId
  method: "rule"
  artifact_version: typeof V3_MEMORY_CONTRACT_VERSION
  extraction_profile: typeof V3_MEMORY_CONTRACT_PROFILE
  source_stage_ids: ["EVENT.1", "SCENE.0"]
  contract_stats: {
    events_total: number
    scenes_total: number
    events_assigned: number
    events_unassigned: number
    scenes_without_events: number
    diagnostics_total: number
    support_axis_refs: number
    drop_axis_refs: number
    missing_occurrence_refs: number
  }
  evidence_refs: V3MemoryEvidenceRef[]
  events: V3MemoryEventContract[]
  scenes: V3MemorySceneContract[]
  diagnostics: V3MemoryDiagnostic[]
}
