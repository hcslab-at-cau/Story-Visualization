import type { ArtifactBase } from "@/types/schema"

export const V3_SCENE_GROUPING_STAGE_ID = "SCENE.0" as const
export const V3_SCENE_GROUPING_PROFILE = "v3_scene_grouping" as const

export type V3SceneGroupingStageId = typeof V3_SCENE_GROUPING_STAGE_ID
export type V3SceneAxisKey = "time" | "place" | "action_focus" | "cast"
export type V3SceneGroupingSource = "llm" | "fallback_event"

export interface V3SceneAxisEvidence {
  label: string
  evidence_event_ids: string[]
  note?: string
}

export interface V3SceneCandidate {
  scene_id: string
  sequence_index: number
  grouping_source: V3SceneGroupingSource
  start_event_id: string
  end_event_id: string
  event_ids: string[]
  start_pid: number
  end_pid: number
  summary: string
  time_axis: V3SceneAxisEvidence
  place_axis: V3SceneAxisEvidence
  action_focus_axis: V3SceneAxisEvidence
  cast_axis: V3SceneAxisEvidence
  boundary_basis: V3SceneAxisKey[]
  rationale?: string
}

export interface V3SceneGroupingArtifact extends ArtifactBase {
  stage_id: V3SceneGroupingStageId
  method: "llm+rule"
  model?: string
  extraction_profile: typeof V3_SCENE_GROUPING_PROFILE
  source_stage_ids: ["EVENT.1"]
  prompt_template: "v3_scene0_group_scenes"
  scene_stats: {
    input_events: number
    scene_candidates: number
    fallback_scenes: number
    events_covered: number
    paragraphs_covered: number
    boundary_basis_counts: Record<V3SceneAxisKey, number>
  }
  scene_candidates: V3SceneCandidate[]
}
