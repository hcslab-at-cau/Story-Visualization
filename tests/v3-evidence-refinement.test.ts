import test from "node:test"
import assert from "node:assert/strict"
import { sourcesCompatibleWithRefinedType } from "../src/lib/pipeline/v3-evidence-refinement-core.ts"
import type { V3EvidenceCandidate } from "../src/lib/pipeline/v3-evidence-types.ts"

function source(candidate_id: string, candidate_type: V3EvidenceCandidate["candidate_type"]): V3EvidenceCandidate {
  return {
    candidate_id,
    candidate_type,
    pid: 3,
    span: "it",
    start_char: 0,
    end_char: 2,
    source_pass: "EVID.1A",
  }
}

test("EVID.2 refinement keeps merged source ids compatible with the refined candidate type", () => {
  const castIt = source("cast-it", "cast")
  const objectIt = source("object-it", "object")

  assert.deepEqual(
    sourcesCompatibleWithRefinedType([castIt, objectIt], "object").map((candidate) => candidate.candidate_id),
    ["object-it"],
  )
  assert.deepEqual(
    sourcesCompatibleWithRefinedType([castIt, objectIt], "cast").map((candidate) => candidate.candidate_id),
    ["cast-it"],
  )
})
