import test from "node:test"
import assert from "node:assert/strict"
import { buildV3EvidenceGateFromDecisions } from "../src/lib/pipeline/v3-evidence-gate-core.ts"
import { isV3EvidenceGateArtifact } from "../src/lib/pipeline/v3-evidence-gate-types.ts"
import type { V3RefinedEvidenceCandidate } from "../src/lib/pipeline/v3-evidence-refinement-types.ts"

function candidate(
  refined_candidate_id: string,
  candidate_type: V3RefinedEvidenceCandidate["candidate_type"],
  status: V3RefinedEvidenceCandidate["status"] = "kept_context",
): V3RefinedEvidenceCandidate {
  return {
    refined_candidate_id,
    source_candidate_ids: [refined_candidate_id.replace("ref", "raw")],
    candidate_type,
    status,
    actions: [],
    pid: 1,
    span: refined_candidate_id,
    start_char: 0,
    end_char: refined_candidate_id.length,
    original_candidates: [],
  }
}

test("EVID.3 candidate gate preserves core/support/drop decisions without scores", () => {
  const refinedCandidates = [
    candidate("ref1", "cast", "kept_core"),
    candidate("ref2", "place"),
    candidate("ref3", "object"),
    candidate("ref4", "action"),
  ]

  const artifact = buildV3EvidenceGateFromDecisions({
    docId: "doc",
    chapterId: "ch01",
    evidenceRefinement: {
      run_id: "evid2",
      doc_id: "doc",
      chapter_id: "ch01",
      stage_id: "EVID.2",
      method: "llm+rule",
      parents: {},
      extraction_profile: "v3_evidence_candidate_refinement",
      source_stage_ids: ["EVID.1A", "EVID.1B", "EVID.1C", "EVID.1D"],
      prompt_template: "v3_evid2_candidate_refine",
      refinement_stats: {
        input_candidates: refinedCandidates.length,
        refined_candidates: refinedCandidates.length,
        kept_core: 1,
        kept_context: 3,
        corrected: 0,
        merged_sources: 0,
        rejected_candidates: 0,
        rejected_by_reason: {
          span_not_in_text: 0,
          wrong_pid: 0,
          hallucinated_or_not_in_paragraph: 0,
          not_a_candidate_record: 0,
          not_objective_rejection: 0,
        },
        by_type: { cast: 1, place: 1, object: 1, action: 1 },
      },
      refined_candidates: refinedCandidates,
      rejected_candidates: [],
    },
    decisions: [
      { refined_candidate_id: "ref1", gate: "core", basis: "event_participant", rationale: "Alice acts." },
      { refined_candidate_id: "ref2", gate: "support", basis: "referential_context" },
      { refined_candidate_id: "ref3", gate: "drop", basis: "invalid_noise" },
    ],
  })

  assert.equal(artifact.stage_id, "EVID.3")
  assert.equal(artifact.prompt_template, "v3_evid3_candidate_gate")
  assert.deepEqual(artifact.source_stage_ids, ["EVID.2"])
  assert.equal(artifact.gate_map.ref1, "core")
  assert.equal(artifact.gate_map.ref2, "support")
  assert.equal(artifact.gate_map.ref3, "drop")
  assert.equal(artifact.gate_map.ref4, "core")
  assert.equal(artifact.gate_stats.core_candidates, 2)
  assert.equal(artifact.gate_stats.support_candidates, 1)
  assert.equal(artifact.gate_stats.dropped_candidates, 1)
  assert.equal(
    "confidence" in artifact.gated_candidates[0],
    false,
    "gate stage should not invent confidence or arbitrary scores",
  )
})

test("EVID.3 artifact guard rejects stale pre-renumbered entity cluster results", () => {
  const staleClusterArtifact = {
    run_id: "old-evid3",
    doc_id: "doc",
    chapter_id: "ch01",
    stage_id: "EVID.3",
    method: "rule",
    extraction_profile: "v3_evidence_entity_clustering",
    source_stage_ids: ["EVID.2"],
    cluster_stats: {},
    entity_clusters: [],
    candidate_cluster_map: {},
  }

  assert.equal(isV3EvidenceGateArtifact(staleClusterArtifact), false)
})

test("EVID.3 candidate gate drops non-participant cast placeholders and mental-space places", () => {
  const refinedCandidates = [
    candidate("ref-you", "cast"),
    candidate("ref-no-one", "cast"),
    candidate("ref-mind", "place"),
    candidate("ref-alice", "cast", "kept_core"),
  ]
  refinedCandidates[0].span = "you"
  refinedCandidates[0].normalized = "reader"
  refinedCandidates[1].span = "no one"
  refinedCandidates[2].span = "her own mind"
  refinedCandidates[2].normalized = "Alice's mind"
  refinedCandidates[2].label = "mental space"
  refinedCandidates[3].span = "Alice"
  refinedCandidates[3].normalized = "Alice"

  const artifact = buildV3EvidenceGateFromDecisions({
    docId: "doc",
    chapterId: "ch01",
    evidenceRefinement: {
      run_id: "evid2",
      doc_id: "doc",
      chapter_id: "ch01",
      stage_id: "EVID.2",
      method: "llm+rule",
      parents: {},
      extraction_profile: "v3_evidence_candidate_refinement",
      source_stage_ids: ["EVID.1A", "EVID.1B", "EVID.1C", "EVID.1D"],
      prompt_template: "v3_evid2_candidate_refine",
      refinement_stats: {
        input_candidates: refinedCandidates.length,
        refined_candidates: refinedCandidates.length,
        kept_core: 1,
        kept_context: 3,
        corrected: 0,
        merged_sources: 0,
        rejected_candidates: 0,
        rejected_by_reason: {
          span_not_in_text: 0,
          wrong_pid: 0,
          hallucinated_or_not_in_paragraph: 0,
          not_a_candidate_record: 0,
          not_objective_rejection: 0,
        },
        by_type: { cast: 3, place: 1 },
      },
      refined_candidates: refinedCandidates,
      rejected_candidates: [],
    },
    decisions: [
      { refined_candidate_id: "ref-you", gate: "support", basis: "referential_context" },
      { refined_candidate_id: "ref-no-one", gate: "support", basis: "referential_context" },
      { refined_candidate_id: "ref-mind", gate: "support", basis: "referential_context" },
      { refined_candidate_id: "ref-alice", gate: "core", basis: "event_participant" },
    ],
  })

  assert.equal(artifact.gate_map["ref-you"], "drop")
  assert.equal(artifact.gate_map["ref-no-one"], "drop")
  assert.equal(artifact.gate_map["ref-mind"], "drop")
  assert.equal(artifact.gate_map["ref-alice"], "core")
})
