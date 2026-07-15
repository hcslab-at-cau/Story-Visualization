import type { ArtifactBase } from "@/types/schema"

export const V3_EVIDENCE_PROFILE = "v3_evidence_candidates" as const

export type V3EvidencePassId = "EVID.1A" | "EVID.1B" | "EVID.1C" | "EVID.1D"

export type V3EvidenceCandidateType =
  | "cast"
  | "place"
  | "time"
  | "object"
  | "action"
  | "goal"
  | "causality"

export interface V3EvidencePassConfig {
  stageId: V3EvidencePassId
  title: string
  candidateKey: string
  promptTemplate: string
  allowedCandidateTypes: V3EvidenceCandidateType[]
}

export const V3_EVIDENCE_PASSES: V3EvidencePassConfig[] = [
  {
    stageId: "EVID.1A",
    title: "Entity candidates",
    candidateKey: "entity_candidates",
    promptTemplate: "v3_evid1a_entity_candidates",
    allowedCandidateTypes: ["cast", "place", "time", "object"],
  },
  {
    stageId: "EVID.1B",
    title: "Action candidates",
    candidateKey: "action_candidates",
    promptTemplate: "v3_evid1b_action_candidates",
    allowedCandidateTypes: ["action"],
  },
  {
    stageId: "EVID.1C",
    title: "Goal cues",
    candidateKey: "goal_cues",
    promptTemplate: "v3_evid1c_goal_cues",
    allowedCandidateTypes: ["goal"],
  },
  {
    stageId: "EVID.1D",
    title: "Causal cues",
    candidateKey: "causal_cues",
    promptTemplate: "v3_evid1d_causal_cues",
    allowedCandidateTypes: ["causality"],
  },
]

const PASS_CONFIG_BY_ID = new Map(
  V3_EVIDENCE_PASSES.map((config) => [config.stageId, config]),
)

export function isV3EvidencePassId(value: unknown): value is V3EvidencePassId {
  return typeof value === "string" && PASS_CONFIG_BY_ID.has(value as V3EvidencePassId)
}

export function evidencePassConfig(passId: V3EvidencePassId): V3EvidencePassConfig {
  const config = PASS_CONFIG_BY_ID.get(passId)
  if (!config) throw new Error(`Unknown v3 evidence pass: ${passId}`)
  return config
}

export function candidateKeyForEvidencePass(passId: V3EvidencePassId): string {
  return evidencePassConfig(passId).candidateKey
}

export function promptTemplateForEvidencePass(passId: V3EvidencePassId): string {
  return evidencePassConfig(passId).promptTemplate
}

export function allowedCandidateTypesForEvidencePass(
  passId: V3EvidencePassId,
): Set<V3EvidenceCandidateType> {
  return new Set(evidencePassConfig(passId).allowedCandidateTypes)
}

export function isV3EvidenceCandidateType(value: unknown): value is V3EvidenceCandidateType {
  return (
    value === "cast" ||
    value === "place" ||
    value === "time" ||
    value === "object" ||
    value === "action" ||
    value === "goal" ||
    value === "causality"
  )
}

export function normalizeEvidenceLabel(raw: unknown): string {
  return String(raw ?? "").trim().replace(/\s+/g, " ")
}

export interface V3EvidenceCandidate {
  candidate_id: string
  pid: number
  span: string
  start_char: number
  end_char: number
  candidate_type: V3EvidenceCandidateType
  label?: string
  normalized?: string
  source_pass: V3EvidencePassId
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
}

export interface V3DroppedEvidenceCandidate {
  reason: string
  pid?: number
  span?: string
  candidate_type?: V3EvidenceCandidateType
  start_char?: number
  end_char?: number
  label?: string
  normalized?: string
}

export interface V3EvidenceArtifact extends ArtifactBase {
  stage_id: V3EvidencePassId
  method: "llm"
  model?: string
  extraction_profile: typeof V3_EVIDENCE_PROFILE
  pass_id: V3EvidencePassId
  candidate_key: string
  candidate_types: V3EvidenceCandidateType[]
  prompt_template: string
  extraction_stats: {
    narrative_paragraphs: number
    attempted_raw_candidates: number
    accepted_candidates: number
    dropped_candidates: number
    dropped_by_reason: Record<string, number>
    by_type: Partial<Record<V3EvidenceCandidateType, number>>
    by_label: Record<string, number>
  }
  dropped_candidates: V3DroppedEvidenceCandidate[]
  candidates: V3EvidenceCandidate[]
}
