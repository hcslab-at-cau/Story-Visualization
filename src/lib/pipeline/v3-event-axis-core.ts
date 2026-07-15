import type { V3EvidenceCandidateType } from "./v3-evidence-types"
import type { V3EventEvidenceOccurrence } from "./v3-event-types"

export function isCoreEventAxisOccurrence(occurrence: V3EventEvidenceOccurrence): boolean {
  return occurrence.gate !== "support" && occurrence.gate !== "drop"
}

export function eventAxisIdsOfType(
  ids: string[],
  occurrenceById: Map<string, V3EventEvidenceOccurrence>,
  candidateType: V3EvidenceCandidateType,
): string[] {
  return ids.filter((id) => {
    const occurrence = occurrenceById.get(id)
    return occurrence?.candidate_type === candidateType && isCoreEventAxisOccurrence(occurrence)
  })
}
