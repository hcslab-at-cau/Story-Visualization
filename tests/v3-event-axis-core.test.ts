import test from "node:test"
import assert from "node:assert/strict"
import { eventAxisIdsOfType } from "../src/lib/pipeline/v3-event-axis-core.ts"
import type { V3EventEvidenceOccurrence } from "../src/lib/pipeline/v3-event-types.ts"

function occurrence(
  id: string,
  candidate_type: V3EventEvidenceOccurrence["candidate_type"],
  gate: V3EventEvidenceOccurrence["gate"],
): V3EventEvidenceOccurrence {
  return {
    source_candidate_id: id,
    refined_candidate_id: `ref-${id}`,
    candidate_type,
    status: "kept_context",
    gate,
    pid: 1,
    span: id,
    start_char: 0,
    end_char: id.length,
  }
}

test("eventAxisIdsOfType keeps only core axis occurrences of the requested type", () => {
  const occurrences = [
    occurrence("alice", "cast", "core"),
    occurrence("reader", "cast", "support"),
    occurrence("mind", "place", "support"),
    occurrence("watch", "object", "core"),
  ]
  const occurrenceById = new Map(occurrences.map((item) => [item.source_candidate_id, item]))

  assert.deepEqual(
    eventAxisIdsOfType(["alice", "reader", "watch"], occurrenceById, "cast"),
    ["alice"],
  )
  assert.deepEqual(
    eventAxisIdsOfType(["mind"], occurrenceById, "place"),
    [],
  )
})
