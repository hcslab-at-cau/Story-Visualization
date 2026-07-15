import test from "node:test"
import assert from "node:assert/strict"
import { buildV3EvidenceClusters } from "../src/lib/pipeline/v3-evidence-clustering.ts"
import type { V3RefinedEvidenceCandidate } from "../src/lib/pipeline/v3-evidence-refinement-types.ts"

function candidate(
  refined_candidate_id: string,
  candidate_type: V3RefinedEvidenceCandidate["candidate_type"],
  span: string,
  normalized = span,
): V3RefinedEvidenceCandidate {
  return {
    refined_candidate_id,
    source_candidate_ids: [refined_candidate_id.replace("ref", "raw")],
    candidate_type,
    status: "kept_context",
    actions: [],
    pid: Number(refined_candidate_id.match(/\d+/)?.[0] ?? 1),
    span,
    start_char: 0,
    end_char: span.length,
    normalized,
    original_candidates: [],
  }
}

test("EVID.4 clusters non-dropped entity-like mentions and leaves non-entity evidence unclustered", () => {
  const candidates = [
    candidate("ref1", "cast", "Alice", "Alice"),
    candidate("ref2", "cast", "she", "Alice"),
    candidate("ref3", "place", "the river bank", "river bank"),
    candidate("ref4", "place", "river bank", "river bank"),
    candidate("ref5", "action", "was beginning to get very tired"),
  ]

  const artifact = buildV3EvidenceClusters({
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
        input_candidates: candidates.length,
        refined_candidates: candidates.length,
        kept_core: 0,
        kept_context: candidates.length,
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
        by_type: { cast: 2, place: 2, action: 1 },
      },
      refined_candidates: candidates,
      rejected_candidates: [],
    },
    evidenceGate: {
      run_id: "evid3",
      doc_id: "doc",
      chapter_id: "ch01",
      stage_id: "EVID.3",
      method: "llm+rule",
      parents: {},
      extraction_profile: "v3_evidence_candidate_gate",
      source_stage_ids: ["EVID.2"],
      prompt_template: "v3_evid3_candidate_gate",
      gate_stats: {
        input_refined_candidates: candidates.length,
        core_candidates: 3,
        support_candidates: 1,
        dropped_candidates: 1,
        by_gate: { core: 3, support: 1, drop: 1 },
        by_type: { cast: 2, place: 1, action: 1, object: 1 },
      },
      gated_candidates: [
        { refined_candidate_id: "ref1", source_candidate_ids: ["raw1"], candidate_type: "cast", gate: "core", basis: "event_participant" },
        { refined_candidate_id: "ref2", source_candidate_ids: ["raw2"], candidate_type: "cast", gate: "support", basis: "background_context" },
        { refined_candidate_id: "ref3", source_candidate_ids: ["raw3"], candidate_type: "place", gate: "core", basis: "current_setting" },
        { refined_candidate_id: "ref4", source_candidate_ids: ["raw4"], candidate_type: "place", gate: "drop", basis: "invalid_noise" },
        { refined_candidate_id: "ref5", source_candidate_ids: ["raw5"], candidate_type: "action", gate: "core", basis: "event_action" },
      ],
      gate_map: {
        ref1: "core",
        ref2: "support",
        ref3: "core",
        ref4: "drop",
        ref5: "core",
      },
    },
  })

  assert.equal(artifact.stage_id, "EVID.4")
  assert.deepEqual(artifact.source_stage_ids, ["EVID.3"])
  assert.equal(artifact.cluster_stats.entity_like_candidates, 3)
  assert.equal(artifact.cluster_stats.unclustered_candidates, 1)

  const alice = artifact.entity_clusters.find((cluster) => cluster.canonical_label === "Alice")
  assert.deepEqual(alice?.refined_candidate_ids.sort(), ["ref1", "ref2"])

  const riverBank = artifact.entity_clusters.find((cluster) => cluster.canonical_label === "river bank")
  assert.deepEqual(riverBank?.refined_candidate_ids.sort(), ["ref3"])

  assert.equal(artifact.candidate_cluster_map.ref5, undefined)
  assert.equal(artifact.candidate_cluster_map.ref4, undefined)
})

test("EVID.4 normalizes safe place/object surface variants without merging context-dependent times", () => {
  const candidates = [
    candidate("ref1", "place", "a long, low hall"),
    candidate("ref2", "place", "the hall", "hall"),
    candidate("ref3", "place", "the loveliest garden"),
    candidate("ref4", "place", "lovely garden", "lovely garden"),
    candidate("ref5", "object", "a tiny golden key", "golden key"),
    candidate("ref6", "object", "little golden key", "little golden key"),
    candidate("ref7", "object", "a little bottle"),
    candidate("ref8", "object", "this bottle", "bottle"),
    candidate("ref9", "time", "this time", "this time"),
    candidate("ref10", "time", "this time", "this time"),
  ]

  const artifact = buildV3EvidenceClusters({
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
        input_candidates: candidates.length,
        refined_candidates: candidates.length,
        kept_core: candidates.length,
        kept_context: 0,
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
        by_type: { place: 4, object: 4, time: 2 },
      },
      refined_candidates: candidates,
      rejected_candidates: [],
    },
    evidenceGate: {
      run_id: "evid3",
      doc_id: "doc",
      chapter_id: "ch01",
      stage_id: "EVID.3",
      method: "llm+rule",
      parents: {},
      extraction_profile: "v3_evidence_candidate_gate",
      source_stage_ids: ["EVID.2"],
      prompt_template: "v3_evid3_candidate_gate",
      gate_stats: {
        input_refined_candidates: candidates.length,
        core_candidates: candidates.length,
        support_candidates: 0,
        dropped_candidates: 0,
        by_gate: { core: candidates.length, support: 0, drop: 0 },
        by_type: { place: 4, object: 4, time: 2 },
      },
      gated_candidates: candidates.map((item) => ({
        refined_candidate_id: item.refined_candidate_id,
        source_candidate_ids: item.source_candidate_ids,
        candidate_type: item.candidate_type,
        gate: "core",
        basis: item.candidate_type === "place"
          ? "current_setting"
          : item.candidate_type === "time"
            ? "temporal_anchor"
            : "event_object",
      })),
      gate_map: Object.fromEntries(candidates.map((item) => [item.refined_candidate_id, "core"])),
    },
  })

  const hall = artifact.entity_clusters.find((cluster) => cluster.entity_type === "place" && cluster.refined_candidate_ids.includes("ref1"))
  assert.deepEqual(hall?.refined_candidate_ids.sort(), ["ref1", "ref2"])

  const garden = artifact.entity_clusters.find((cluster) => cluster.entity_type === "place" && cluster.refined_candidate_ids.includes("ref3"))
  assert.deepEqual(garden?.refined_candidate_ids.sort(), ["ref3", "ref4"])

  const key = artifact.entity_clusters.find((cluster) => cluster.entity_type === "object" && cluster.refined_candidate_ids.includes("ref5"))
  assert.deepEqual(key?.refined_candidate_ids.sort(), ["ref5", "ref6"])

  const bottle = artifact.entity_clusters.find((cluster) => cluster.entity_type === "object" && cluster.refined_candidate_ids.includes("ref7"))
  assert.deepEqual(bottle?.refined_candidate_ids.sort(), ["ref7", "ref8"])

  const thisTimeClusters = artifact.entity_clusters.filter((cluster) =>
    cluster.entity_type === "time" && cluster.canonical_label === "this time"
  )
  assert.equal(thisTimeClusters.length, 2)
})
