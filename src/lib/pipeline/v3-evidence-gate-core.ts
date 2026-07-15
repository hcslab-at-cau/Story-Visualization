import type { V3EvidenceCandidateType } from "./v3-evidence-types"
import type {
  V3EvidenceRefinementArtifact,
  V3RefinedEvidenceCandidate,
} from "./v3-evidence-refinement-types"
import type {
  V3EvidenceGate,
  V3EvidenceGateArtifact,
  V3EvidenceGateBasis,
  V3GatedEvidenceCandidate,
} from "./v3-evidence-gate-types"

export interface RawGateDecision {
  refined_candidate_id?: unknown
  occurrence_id?: unknown
  candidate_id?: unknown
  gate?: unknown
  basis?: unknown
  rationale?: unknown
}

interface BuildParams {
  docId: string
  chapterId: string
  evidenceRefinement: V3EvidenceRefinementArtifact
  decisions: RawGateDecision[]
  parents?: Record<string, string>
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function normalizeGate(value: unknown): V3EvidenceGate {
  const token = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_")
  if (token === "core" || token === "event_core") return "core"
  if (token === "drop" || token === "dropped" || token === "remove") return "drop"
  return "support"
}

function cleanText(value: string | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^[\s"'`([{<]+/, "")
    .replace(/[\s"'`\])}>.,!?;:]+$/, "")
    .replace(/\s+/g, " ")
}

function isNonParticipantCast(candidate: V3RefinedEvidenceCandidate): boolean {
  const values = [
    candidate.normalized,
    candidate.span,
    candidate.label,
  ].map(cleanText)
  const nonParticipants = new Set([
    "you",
    "your",
    "reader",
    "generic pronoun",
    "narrator address to reader",
    "reader address",
    "no one",
    "nobody",
    "somebody",
    "someone",
    "anyone",
    "people at home",
    "absence of audience",
    "empty audience",
    "hypothetical person",
  ])

  return values.some((value) => nonParticipants.has(value))
}

function isMentalPlace(candidate: V3RefinedEvidenceCandidate): boolean {
  const value = [
    candidate.normalized,
    candidate.span,
    candidate.label,
  ].map(cleanText).join(" ")

  return /\b(mind|thought|thoughts|memory|memories|imagination|mental space)\b/.test(value)
}

function forcedGate(candidate: V3RefinedEvidenceCandidate): V3EvidenceGate | undefined {
  if (candidate.candidate_type === "cast" && isNonParticipantCast(candidate)) return "drop"
  if (candidate.candidate_type === "place" && isMentalPlace(candidate)) return "drop"
  return undefined
}

function normalizeBasis(value: unknown, gate: V3EvidenceGate, candidateType: V3EvidenceCandidateType): V3EvidenceGateBasis {
  const token = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_")
  const allowed = new Set<V3EvidenceGateBasis>([
    "event_participant",
    "current_setting",
    "temporal_anchor",
    "event_object",
    "event_action",
    "goal_cue",
    "causal_cue",
    "background_context",
    "referential_context",
    "incidental_detail",
    "invalid_noise",
  ])
  if (allowed.has(token as V3EvidenceGateBasis)) return token as V3EvidenceGateBasis
  if (gate === "drop") return "invalid_noise"
  if (candidateType === "cast") return "event_participant"
  if (candidateType === "place") return "current_setting"
  if (candidateType === "time") return "temporal_anchor"
  if (candidateType === "object") return "event_object"
  if (candidateType === "action") return "event_action"
  if (candidateType === "goal") return "goal_cue"
  if (candidateType === "causality") return "causal_cue"
  return "background_context"
}

function fallbackGate(candidate: V3RefinedEvidenceCandidate): V3EvidenceGate {
  if (candidate.status === "kept_core" || candidate.candidate_type === "action") return "core"
  return "support"
}

function decisionId(decision: RawGateDecision): string | undefined {
  return textValue(decision.refined_candidate_id)
    ?? textValue(decision.occurrence_id)
    ?? textValue(decision.candidate_id)
}

function countStats(
  inputCount: number,
  candidates: V3GatedEvidenceCandidate[],
): V3EvidenceGateArtifact["gate_stats"] {
  const byGate: Record<V3EvidenceGate, number> = { core: 0, support: 0, drop: 0 }
  const byType: Partial<Record<V3EvidenceCandidateType, number>> = {}

  for (const candidate of candidates) {
    byGate[candidate.gate] += 1
    byType[candidate.candidate_type] = (byType[candidate.candidate_type] ?? 0) + 1
  }

  return {
    input_refined_candidates: inputCount,
    core_candidates: byGate.core,
    support_candidates: byGate.support,
    dropped_candidates: byGate.drop,
    by_gate: byGate,
    by_type: byType,
  }
}

export function buildV3EvidenceGateFromDecisions({
  docId,
  chapterId,
  evidenceRefinement,
  decisions,
  parents = {},
}: BuildParams): V3EvidenceGateArtifact {
  const decisionById = new Map<string, RawGateDecision>()
  for (const decision of decisions) {
    const id = decisionId(decision)
    if (id) decisionById.set(id, decision)
  }

  const gatedCandidates = evidenceRefinement.refined_candidates.map((candidate) => {
    const decision = decisionById.get(candidate.refined_candidate_id)
    const gate = forcedGate(candidate) ?? (decision ? normalizeGate(decision.gate) : fallbackGate(candidate))
    const gated: V3GatedEvidenceCandidate = {
      refined_candidate_id: candidate.refined_candidate_id,
      source_candidate_ids: candidate.source_candidate_ids,
      candidate_type: candidate.candidate_type,
      gate,
      basis: normalizeBasis(decision?.basis, gate, candidate.candidate_type),
    }
    const rationale = textValue(decision?.rationale)
    if (rationale) gated.rationale = rationale
    return gated
  })

  return {
    run_id: `v3_evidence_gate__${docId}__${chapterId}`,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: "EVID.3",
    method: "llm+rule",
    parents,
    extraction_profile: "v3_evidence_candidate_gate",
    source_stage_ids: ["EVID.2"],
    prompt_template: "v3_evid3_candidate_gate",
    gate_stats: countStats(evidenceRefinement.refined_candidates.length, gatedCandidates),
    gated_candidates: gatedCandidates,
    gate_map: Object.fromEntries(
      gatedCandidates.map((candidate) => [candidate.refined_candidate_id, candidate.gate] as const),
    ),
  }
}
