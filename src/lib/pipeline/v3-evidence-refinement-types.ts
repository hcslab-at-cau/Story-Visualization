import type { ArtifactBase } from "@/types/schema"
import type {
  V3EvidenceCandidate,
  V3EvidenceCandidateType,
} from "@/lib/pipeline/v3-evidence-types"

export const V3_EVIDENCE_REFINEMENT_STAGE_ID = "EVID.2" as const
export const V3_EVIDENCE_REFINEMENT_PROFILE = "v3_evidence_candidate_refinement" as const

export type V3EvidenceRefinementStageId = typeof V3_EVIDENCE_REFINEMENT_STAGE_ID

export type V3RefinedEvidenceStatus =
  | "kept_core"
  | "kept_context"
  | "corrected"

export type V3RefinementAction =
  | "merged"
  | "span_corrected"
  | "type_corrected"
  | "normalized"

export type V3ObjectiveRejectionReason =
  | "span_not_in_text"
  | "wrong_pid"
  | "hallucinated_or_not_in_paragraph"
  | "not_a_candidate_record"

export type V3RejectedEvidenceReason =
  | V3ObjectiveRejectionReason
  | "not_objective_rejection"

export interface V3RefinedEvidenceCandidate {
  refined_candidate_id: string
  source_candidate_ids: string[]
  candidate_type: V3EvidenceCandidateType
  status: V3RefinedEvidenceStatus
  actions: V3RefinementAction[]
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
  rationale?: string
  confidence?: number
  original_candidates: V3EvidenceCandidate[]
}

export interface V3RejectedEvidenceCandidate {
  source_candidate_id: string
  reason: V3RejectedEvidenceReason
  original_reason?: string
  candidate?: V3EvidenceCandidate
}

export interface V3EvidenceRefinementArtifact extends ArtifactBase {
  stage_id: V3EvidenceRefinementStageId
  method: "llm+rule"
  model?: string
  extraction_profile: typeof V3_EVIDENCE_REFINEMENT_PROFILE
  source_stage_ids: ["EVID.1A", "EVID.1B", "EVID.1C", "EVID.1D"]
  prompt_template: "v3_evid2_candidate_refine"
  refinement_stats: {
    input_candidates: number
    refined_candidates: number
    kept_core: number
    kept_context: number
    corrected: number
    merged_sources: number
    rejected_candidates: number
    rejected_by_reason: Record<V3RejectedEvidenceReason, number>
    by_type: Partial<Record<V3EvidenceCandidateType, number>>
  }
  refined_candidates: V3RefinedEvidenceCandidate[]
  rejected_candidates: V3RejectedEvidenceCandidate[]
}

const STATUS_ALIASES: Record<string, V3RefinedEvidenceStatus> = {
  core: "kept_core",
  event_core: "kept_core",
  kept_core: "kept_core",
  keep_core: "kept_core",
  context: "kept_context",
  event_context: "kept_context",
  kept_context: "kept_context",
  keep_context: "kept_context",
  corrected: "corrected",
}

const OBJECTIVE_REJECTION_REASONS = new Set<V3ObjectiveRejectionReason>([
  "span_not_in_text",
  "wrong_pid",
  "hallucinated_or_not_in_paragraph",
  "not_a_candidate_record",
])

export function normalizeRefinementStatus(raw: unknown): V3RefinedEvidenceStatus {
  const token = String(raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_")
  return STATUS_ALIASES[token] ?? "kept_context"
}

export function isObjectiveRejectionReason(value: unknown): value is V3ObjectiveRejectionReason {
  return OBJECTIVE_REJECTION_REASONS.has(value as V3ObjectiveRejectionReason)
}

export function normalizeRejectionReason(raw: unknown): V3RejectedEvidenceReason {
  const token = String(raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_")
  return isObjectiveRejectionReason(token) ? token : "not_objective_rejection"
}
