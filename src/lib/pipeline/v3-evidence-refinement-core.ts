import type {
  V3EvidenceCandidate,
  V3EvidenceCandidateType,
} from "./v3-evidence-types"

export function sourcesCompatibleWithRefinedType(
  sources: V3EvidenceCandidate[],
  candidateType: V3EvidenceCandidateType,
): V3EvidenceCandidate[] {
  const matching = sources.filter((source) => source.candidate_type === candidateType)
  return matching.length > 0 ? matching : sources.slice(0, 1)
}
