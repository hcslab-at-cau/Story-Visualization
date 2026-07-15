import type { ArtifactBase } from "@/types/schema"
import type { V3EvidenceCandidateType } from "@/lib/pipeline/v3-evidence-types"

export const V3_EVIDENCE_GATE_STAGE_ID = "EVID.3" as const
export const V3_EVIDENCE_GATE_PROFILE = "v3_evidence_candidate_gate" as const

export type V3EvidenceGateStageId = typeof V3_EVIDENCE_GATE_STAGE_ID
export type V3EvidenceGate = "core" | "support" | "drop"

export type V3EvidenceGateBasis =
  | "event_participant"
  | "current_setting"
  | "temporal_anchor"
  | "event_object"
  | "event_action"
  | "goal_cue"
  | "causal_cue"
  | "background_context"
  | "referential_context"
  | "incidental_detail"
  | "invalid_noise"

export interface V3GatedEvidenceCandidate {
  refined_candidate_id: string
  source_candidate_ids: string[]
  candidate_type: V3EvidenceCandidateType
  gate: V3EvidenceGate
  basis: V3EvidenceGateBasis
  rationale?: string
}

export interface V3EvidenceGateArtifact extends ArtifactBase {
  stage_id: V3EvidenceGateStageId
  method: "llm+rule"
  model?: string
  extraction_profile: typeof V3_EVIDENCE_GATE_PROFILE
  source_stage_ids: ["EVID.2"]
  prompt_template: "v3_evid3_candidate_gate"
  gate_stats: {
    input_refined_candidates: number
    core_candidates: number
    support_candidates: number
    dropped_candidates: number
    by_gate: Record<V3EvidenceGate, number>
    by_type: Partial<Record<V3EvidenceCandidateType, number>>
  }
  gated_candidates: V3GatedEvidenceCandidate[]
  gate_map: Record<string, V3EvidenceGate>
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function isV3EvidenceGateArtifact(value: unknown): value is V3EvidenceGateArtifact {
  if (!isObjectRecord(value)) return false
  if (value.stage_id !== V3_EVIDENCE_GATE_STAGE_ID) return false
  if (value.extraction_profile !== V3_EVIDENCE_GATE_PROFILE) return false
  if (!Array.isArray(value.gated_candidates)) return false
  if (!isObjectRecord(value.gate_stats)) return false
  if (!isObjectRecord(value.gate_map)) return false
  return true
}
