import test from "node:test"
import assert from "node:assert/strict"
import { buildV3MemoryContract } from "../src/lib/pipeline/v3-memory-contract.ts"
import type { V3EventGroupingArtifact } from "../src/lib/pipeline/v3-event-types.ts"
import type { V3SceneGroupingArtifact } from "../src/lib/pipeline/v3-scene-types.ts"

function eventArtifact(): V3EventGroupingArtifact {
  return {
    run_id: "event1",
    doc_id: "doc",
    chapter_id: "ch01",
    stage_id: "EVENT.1",
    method: "llm+rule",
    parents: {},
    extraction_profile: "v3_event_grouping",
    source_stage_ids: ["EVID.3", "EVID.4"],
    prompt_template: "v3_event1_group_events",
    event_stats: {
      input_occurrences: 4,
      action_anchors: 2,
      event_candidates: 2,
      fallback_events: 0,
      paragraphs_covered: 2,
      by_start_pid: { "1": 1, "2": 1 },
    },
    evidence_occurrences: [
      {
        source_candidate_id: "cast-alice",
        refined_candidate_id: "ref-cast-alice",
        candidate_type: "cast",
        status: "kept_core",
        gate: "core",
        gate_basis: "event_participant",
        pid: 1,
        span: "Alice",
        start_char: 0,
        end_char: 5,
        entity_cluster_id: "C_CAST_ALICE",
        entity_cluster_label: "Alice",
        entity_cluster_type: "cast",
      },
      {
        source_candidate_id: "place-hall",
        refined_candidate_id: "ref-place-hall",
        candidate_type: "place",
        status: "kept_core",
        gate: "core",
        gate_basis: "current_setting",
        pid: 1,
        span: "hall",
        start_char: 10,
        end_char: 14,
        entity_cluster_id: "C_PLACE_HALL",
        entity_cluster_label: "hall",
        entity_cluster_type: "place",
      },
      {
        source_candidate_id: "cast-somebody",
        refined_candidate_id: "ref-cast-somebody",
        candidate_type: "cast",
        status: "kept_context",
        gate: "support",
        gate_basis: "background_context",
        pid: 1,
        span: "somebody",
        start_char: 20,
        end_char: 28,
      },
      {
        source_candidate_id: "object-watch",
        refined_candidate_id: "ref-object-watch",
        candidate_type: "object",
        status: "kept_core",
        gate: "drop",
        gate_basis: "invalid_noise",
        pid: 2,
        span: "watch",
        start_char: 0,
        end_char: 5,
      },
    ],
    event_candidates: [
      {
        event_id: "EV1",
        sequence_index: 1,
        grouping_source: "llm",
        start_pid: 1,
        end_pid: 1,
        summary: "Alice enters the hall.",
        anchor_action_ids: [],
        evidence_ids: ["cast-alice", "place-hall"],
        cast_ids: ["cast-alice", "cast-somebody"],
        place_ids: ["place-hall"],
        time_ids: [],
        object_ids: [],
        goal_ids: [],
        causality_ids: [],
      },
      {
        event_id: "EV2",
        sequence_index: 2,
        grouping_source: "llm",
        start_pid: 2,
        end_pid: 2,
        summary: "The watch is ignored.",
        anchor_action_ids: [],
        evidence_ids: ["object-watch"],
        cast_ids: [],
        place_ids: [],
        time_ids: [],
        object_ids: ["object-watch"],
        goal_ids: [],
        causality_ids: [],
      },
    ],
  }
}

function sceneArtifact(): V3SceneGroupingArtifact {
  return {
    run_id: "scene0",
    doc_id: "doc",
    chapter_id: "ch01",
    stage_id: "SCENE.0",
    method: "llm+rule",
    parents: {},
    extraction_profile: "v3_scene_grouping",
    source_stage_ids: ["EVENT.1"],
    prompt_template: "v3_scene0_group_scenes",
    scene_stats: {
      input_events: 2,
      scene_candidates: 1,
      fallback_scenes: 0,
      events_covered: 1,
      paragraphs_covered: 1,
      boundary_basis_counts: { time: 0, place: 1, action_focus: 1, cast: 0 },
    },
    scene_candidates: [
      {
        scene_id: "SC1",
        sequence_index: 1,
        grouping_source: "llm",
        start_event_id: "EV1",
        end_event_id: "EV1",
        event_ids: ["EV1"],
        start_pid: 1,
        end_pid: 1,
        summary: "Alice is in the hall.",
        time_axis: { label: "current time", evidence_event_ids: ["EV1"] },
        place_axis: { label: "hall", evidence_event_ids: ["EV1"] },
        action_focus_axis: { label: "entering the hall", evidence_event_ids: ["EV1"] },
        cast_axis: { label: "Alice", evidence_event_ids: ["EV1"] },
        boundary_basis: ["place", "action_focus"],
      },
    ],
  }
}

test("MEM.0 builds scene membership and keeps support/drop out of core axes", () => {
  const artifact = buildV3MemoryContract({
    docId: "doc",
    chapterId: "ch01",
    parents: {},
    eventGrouping: eventArtifact(),
    sceneGrouping: sceneArtifact(),
  })

  assert.equal(artifact.stage_id, "MEM.0")
  assert.equal(artifact.contract_stats.events_total, 2)
  assert.equal(artifact.contract_stats.events_assigned, 1)
  assert.equal(artifact.contract_stats.events_unassigned, 1)

  const event = artifact.events.find((item) => item.event_id === "EV1")
  assert.equal(event?.scene_id, "SC1")
  assert.deepEqual(event?.axis_refs.cast, ["cast-alice"])
  assert.deepEqual(event?.context_evidence_refs, ["cast-somebody"])

  const dropped = artifact.events.find((item) => item.event_id === "EV2")
  assert.deepEqual(dropped?.axis_refs.object, [])

  assert.ok(artifact.diagnostics.some((item) => item.code === "event_without_scene" && item.ref_id === "EV2"))
  assert.ok(artifact.diagnostics.some((item) => item.code === "drop_axis_ref" && item.ref_id === "EV2"))
  assert.ok(artifact.diagnostics.some((item) => item.code === "support_axis_ref" && item.ref_id === "EV1"))
})
