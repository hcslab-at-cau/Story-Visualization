import type {
  SupportSuppressionReason,
  SupportUnit,
} from "@/types/schema"

export interface SupportVerificationResult {
  unit: SupportUnit
  suppressed: boolean
  reason?: SupportSuppressionReason
  note: string
  finalScore: number
}

function boundedScore(value: number | undefined, fallback = 0): number {
  const next = value ?? fallback
  if (!Number.isFinite(next)) return fallback
  return Math.max(0, Math.min(1, next))
}

function evidenceGrounding(unit: SupportUnit): number {
  if (typeof unit.grounding_score === "number") return boundedScore(unit.grounding_score)
  if (unit.evidence.length === 0) return 0.32
  const withText = unit.evidence.filter((ref) => Boolean(ref.text?.trim())).length
  return boundedScore(0.58 + Math.min(0.22, unit.evidence.length * 0.04) + Math.min(0.2, withText * 0.05))
}

function finalScore(unit: SupportUnit): number {
  const usefulness = boundedScore(unit.usefulness_score, unit.priority)
  const grounding = evidenceGrounding(unit)
  const confidence = boundedScore(unit.confidence, unit.priority)
  const intrusion = boundedScore(unit.intrusion_cost)
  const redundancy = boundedScore(unit.redundancy_cost)
  const spoilerPenalty = unit.spoiler_risk === "high"
    ? 1
    : unit.spoiler_risk === "medium"
      ? 0.55
      : unit.spoiler_risk === "low"
        ? 0.15
        : 0

  return usefulness * grounding * confidence - intrusion * 0.35 - redundancy * 0.25 - spoilerPenalty
}

function suppressionReason(unit: SupportUnit, duplicate: boolean): SupportSuppressionReason | undefined {
  if (duplicate) return "redundant"
  if (unit.spoiler_risk === "high") return "spoiler_risk"
  if (boundedScore(unit.confidence, 1) < 0.45 || evidenceGrounding(unit) < 0.45) return "low_confidence"
  if (boundedScore(unit.usefulness_score, unit.priority) < 0.35) return "low_value"
  if (boundedScore(unit.intrusion_cost) > 0.8) return "too_intrusive"
  return undefined
}

function verificationNotes(unit: SupportUnit, score: number): string[] {
  const notes = [
    ...(unit.score_notes ?? []),
    `verified_final_score=${score.toFixed(2)}`,
    `verified_grounding=${evidenceGrounding(unit).toFixed(2)}`,
  ]
  if (unit.claims?.some((claim) => claim.support_level === "strong_inference") && unit.evidence.length === 0) {
    notes.push("strong inference without evidence should stay on-demand")
  }
  return Array.from(new Set(notes))
}

export function verifySupportUnits(units: SupportUnit[]): SupportVerificationResult[] {
  const seen = new Set<string>()

  return units.map((unit) => {
    const redundancyKey = unit.redundancy_key ?? `${unit.scene_id}:${unit.kind}:${unit.title}`
    const duplicate = seen.has(redundancyKey)
    seen.add(redundancyKey)
    const score = finalScore(unit)
    const reason = suppressionReason(unit, duplicate)
    const verifiedUnit: SupportUnit = {
      ...unit,
      grounding_score: evidenceGrounding(unit),
      score_notes: verificationNotes(unit, score),
      suppression_reason: reason,
    }

    return {
      unit: verifiedUnit,
      suppressed: Boolean(reason),
      reason,
      note: reason ? `suppressed_by_verifier:${reason}; final_score=${score.toFixed(2)}` : `verified; final_score=${score.toFixed(2)}`,
      finalScore: score,
    }
  })
}

