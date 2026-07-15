import test from "node:test"
import assert from "node:assert/strict"
import { buildV3EventFrames, buildV3SceneSituationCards } from "../src/lib/pipeline/v3-memory-frames.ts"
import type { V3MemoryContractArtifact } from "../src/lib/pipeline/v3-memory-contract-types.ts"

function memoryContract(): V3MemoryContractArtifact {
  return {
    run_id: "mem0",
    doc_id: "doc",
    chapter_id: "ch01",
    stage_id: "MEM.0",
    method: "rule",
    parents: {},
    artifact_version: "v3-memory-contract-0.1",
    extraction_profile: "v3_narrative_memory_contract",
    source_stage_ids: ["EVENT.1", "SCENE.0"],
    contract_stats: {
      events_total: 1,
      scenes_total: 1,
      events_assigned: 1,
      events_unassigned: 0,
      scenes_without_events: 0,
      diagnostics_total: 0,
      support_axis_refs: 0,
      drop_axis_refs: 0,
      missing_occurrence_refs: 0,
    },
    evidence_refs: [
      {
        source_candidate_id: "act-open",
        refined_candidate_id: "ref-act-open",
        candidate_type: "action",
        gate: "core",
        gate_basis: "event_action",
        pid: 3,
        span: "opened",
        label: "opened the door",
        subject_hint: "Alice",
        object_hint: "door",
      },
      {
        source_candidate_id: "cast-alice",
        refined_candidate_id: "ref-cast-alice",
        candidate_type: "cast",
        gate: "core",
        gate_basis: "event_participant",
        pid: 3,
        span: "Alice",
        label: "Alice",
        entity_cluster_id: "C_CAST_ALICE",
        entity_cluster_label: "Alice",
      },
      {
        source_candidate_id: "place-hall",
        refined_candidate_id: "ref-place-hall",
        candidate_type: "place",
        gate: "core",
        gate_basis: "current_setting",
        pid: 3,
        span: "hall",
        label: "long hall",
        entity_cluster_id: "C_PLACE_HALL",
        entity_cluster_label: "long hall",
      },
      {
        source_candidate_id: "object-door",
        refined_candidate_id: "ref-object-door",
        candidate_type: "object",
        gate: "core",
        gate_basis: "event_object",
        pid: 3,
        span: "door",
        label: "door",
        entity_cluster_id: "C_OBJ_DOOR",
        entity_cluster_label: "door",
      },
      {
        source_candidate_id: "goal-exit",
        refined_candidate_id: "ref-goal-exit",
        candidate_type: "goal",
        gate: "core",
        gate_basis: "goal_cue",
        pid: 3,
        span: "to get out",
        label: "get out",
      },
    ],
    events: [
      {
        event_id: "EV1",
        scene_id: "SC1",
        event_order: 1,
        grouping_source: "llm",
        text_span: { start_pid: 3, end_pid: 3 },
        summary: "Alice opened the door to get out.",
        trigger_refs: ["act-open"],
        axis_refs: {
          action: ["act-open"],
          cast: ["cast-alice"],
          place: ["place-hall"],
          time: [],
          object: ["object-door"],
          goal: ["goal-exit"],
          causality: [],
        },
        evidence_refs: ["act-open", "cast-alice", "place-hall", "object-door", "goal-exit"],
        context_evidence_refs: [],
        dropped_evidence_refs: [],
        scope: "actual_story_world",
        confidence: "high",
      },
    ],
    scenes: [
      {
        scene_id: "SC1",
        scene_order: 1,
        grouping_source: "llm",
        event_ids: ["EV1"],
        text_span: { start_pid: 3, end_pid: 3 },
        boundary_axes: ["place", "action_focus"],
        summary: "Alice is in the hall and tries to leave.",
        axis_labels: {
          time: "current story time",
          place: "long hall",
          action_focus: "trying to leave",
          cast: "Alice",
        },
        confidence: "high",
      },
    ],
    diagnostics: [],
  }
}

test("MEM.1 builds scene situation cards from the MEM.0 contract", () => {
  const artifact = buildV3SceneSituationCards({
    docId: "doc",
    chapterId: "ch01",
    parents: {},
    memoryContract: memoryContract(),
  })

  assert.equal(artifact.stage_id, "MEM.1")
  assert.equal(artifact.card_stats.scene_cards, 1)
  assert.equal(artifact.scene_cards[0]?.scene_id, "SC1")
  assert.equal(artifact.scene_cards[0]?.situation.place[0]?.ref_id, "C_PLACE_HALL")
  assert.equal(artifact.scene_cards[0]?.situation.cast[0]?.ref_id, "C_CAST_ALICE")
  assert.equal(artifact.scene_cards[0]?.situation.salient_objects[0]?.ref_id, "C_OBJ_DOOR")
  assert.equal(artifact.scene_cards[0]?.situation.active_goal_or_tension, "get out")
  assert.ok(artifact.scene_cards[0]?.summary_for_retrieval.includes("trying to leave"))
})

test("EVENT.2 builds conservative argument frames with exact action hints", () => {
  const mem0 = memoryContract()
  const mem1 = buildV3SceneSituationCards({
    docId: "doc",
    chapterId: "ch01",
    parents: {},
    memoryContract: mem0,
  })

  const artifact = buildV3EventFrames({
    docId: "doc",
    chapterId: "ch01",
    parents: {},
    memoryContract: mem0,
    sceneCards: mem1,
  })

  assert.equal(artifact.stage_id, "EVENT.2")
  assert.equal(artifact.frame_stats.event_frames, 1)
  assert.equal(artifact.event_frames[0]?.predicate, "opened the door")
  assert.deepEqual(
    artifact.event_frames[0]?.arguments.map((argument) => [argument.role, argument.ref_id]),
    [
      ["actor", "C_CAST_ALICE"],
      ["target_object", "C_OBJ_DOOR"],
      ["location", "C_PLACE_HALL"],
    ],
  )
  assert.deepEqual(artifact.event_frames[0]?.goal_cue_refs, ["goal-exit"])
})
