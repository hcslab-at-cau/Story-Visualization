import type { ArtifactBase } from "@/types/schema"
import type { V3MemoryConfidence, V3MemoryScope, V3MemoryTextSpan } from "@/lib/pipeline/v3-memory-contract-types"

export const V3_SCENE_SITUATION_STAGE_ID = "MEM.1" as const
export const V3_SCENE_SITUATION_PROFILE = "v3_scene_situation_cards" as const
export const V3_SCENE_SITUATION_VERSION = "v3-scene-situation-cards-0.1" as const

export const V3_EVENT_FRAME_STAGE_ID = "EVENT.2" as const
export const V3_EVENT_FRAME_PROFILE = "v3_event_argument_frames" as const
export const V3_EVENT_FRAME_VERSION = "v3-event-argument-frames-0.1" as const

export type V3SceneSituationStageId = typeof V3_SCENE_SITUATION_STAGE_ID
export type V3EventFrameStageId = typeof V3_EVENT_FRAME_STAGE_ID

export type V3SceneExplicitness = "explicit" | "mixed"

export interface V3SceneSituationRef {
  ref_id: string
  label: string
  evidence_refs: string[]
}

export interface V3SceneCastRef extends V3SceneSituationRef {
  scene_role: "present"
}

export interface V3SceneSituationCard {
  scene_id: string
  scene_order: number
  text_span: V3MemoryTextSpan
  event_ids: string[]
  situation: {
    time: V3SceneSituationRef[]
    place: V3SceneSituationRef[]
    cast: V3SceneCastRef[]
    action_focus: string
    active_goal_or_tension?: string
    salient_objects: V3SceneSituationRef[]
  }
  summary_for_retrieval: string
  evidence_refs: string[]
  explicitness: V3SceneExplicitness
  confidence: V3MemoryConfidence
}

export interface V3SceneSituationCardsArtifact extends ArtifactBase {
  stage_id: V3SceneSituationStageId
  method: "rule"
  artifact_version: typeof V3_SCENE_SITUATION_VERSION
  extraction_profile: typeof V3_SCENE_SITUATION_PROFILE
  source_stage_ids: ["MEM.0"]
  card_stats: {
    input_scenes: number
    input_events: number
    scene_cards: number
    scenes_with_goal_or_tension: number
  }
  scene_cards: V3SceneSituationCard[]
}

export type V3EventFrameType = "action" | "occurrence" | "state_description"

export type V3EventArgumentRole =
  | "actor"
  | "speaker"
  | "addressee"
  | "experiencer_or_perceiver"
  | "patient_or_affected"
  | "target_object"
  | "theme_object"
  | "instrument"
  | "location"
  | "time_anchor"
  | "mentioned_only"

export interface V3EventArgument {
  role: V3EventArgumentRole
  ref_id: string
  evidence_ref: string
  label: string
  role_basis: "action_hint" | "event_axis"
}

export interface V3EventFrame {
  event_id: string
  scene_id?: string
  event_order: number
  event_type: V3EventFrameType
  predicate: string
  trigger_refs: string[]
  arguments: V3EventArgument[]
  time_refs: string[]
  goal_cue_refs: string[]
  causal_cue_refs: string[]
  evidence_refs: string[]
  scope: V3MemoryScope
  confidence: V3MemoryConfidence
}

export interface V3EventFramesArtifact extends ArtifactBase {
  stage_id: V3EventFrameStageId
  method: "rule"
  artifact_version: typeof V3_EVENT_FRAME_VERSION
  extraction_profile: typeof V3_EVENT_FRAME_PROFILE
  source_stage_ids: ["MEM.0", "MEM.1"]
  frame_stats: {
    input_events: number
    event_frames: number
    frames_with_trigger: number
    arguments_total: number
  }
  event_frames: V3EventFrame[]
}
