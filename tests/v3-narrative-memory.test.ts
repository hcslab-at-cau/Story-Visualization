import test from "node:test"
import assert from "node:assert/strict"
import { buildV3EventFrames, buildV3SceneSituationCards } from "../src/lib/pipeline/v3-memory-frames.ts"
import {
  buildV3CausalEdges,
  buildV3GroundedGoals,
  buildV3ProgressiveNarrativeMemory,
  buildV3RetrievalIndex,
} from "../src/lib/pipeline/v3-narrative-memory.ts"
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
      events_total: 2,
      scenes_total: 1,
      events_assigned: 2,
      events_unassigned: 0,
      scenes_without_events: 0,
      diagnostics_total: 0,
      support_axis_refs: 0,
      drop_axis_refs: 0,
      missing_occurrence_refs: 0,
    },
    evidence_refs: [
      {
        source_candidate_id: "act-found",
        refined_candidate_id: "ref-act-found",
        candidate_type: "action",
        gate: "core",
        gate_basis: "event_action",
        pid: 1,
        span: "found",
        label: "found key",
        subject_hint: "Alice",
        object_hint: "key",
      },
      {
        source_candidate_id: "act-opened",
        refined_candidate_id: "ref-act-opened",
        candidate_type: "action",
        gate: "core",
        gate_basis: "event_action",
        pid: 2,
        span: "opened",
        label: "opened door",
        subject_hint: "Alice",
        object_hint: "door",
      },
      {
        source_candidate_id: "cast-alice",
        refined_candidate_id: "ref-cast-alice",
        candidate_type: "cast",
        gate: "core",
        gate_basis: "event_participant",
        pid: 1,
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
        pid: 1,
        span: "hall",
        label: "hall",
        entity_cluster_id: "C_PLACE_HALL",
        entity_cluster_label: "hall",
      },
      {
        source_candidate_id: "object-key",
        refined_candidate_id: "ref-object-key",
        candidate_type: "object",
        gate: "core",
        gate_basis: "event_object",
        pid: 1,
        span: "key",
        label: "key",
        entity_cluster_id: "C_OBJ_KEY",
        entity_cluster_label: "key",
      },
      {
        source_candidate_id: "object-door",
        refined_candidate_id: "ref-object-door",
        candidate_type: "object",
        gate: "core",
        gate_basis: "event_object",
        pid: 2,
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
        pid: 2,
        span: "to get out",
        label: "get out",
        goal_text: "get out",
      },
      {
        source_candidate_id: "cause-key-door",
        refined_candidate_id: "ref-cause-key-door",
        candidate_type: "causality",
        gate: "core",
        gate_basis: "causal_cue",
        pid: 2,
        span: "because she found the key",
        label: "found key enables opened door",
        cause_text: "found key",
        effect_text: "opened door",
      },
    ],
    events: [
      {
        event_id: "EV1",
        scene_id: "SC1",
        event_order: 1,
        grouping_source: "llm",
        text_span: { start_pid: 1, end_pid: 1 },
        summary: "Alice found the key in the hall.",
        trigger_refs: ["act-found"],
        axis_refs: {
          action: ["act-found"],
          cast: ["cast-alice"],
          place: ["place-hall"],
          time: [],
          object: ["object-key"],
          goal: [],
          causality: [],
        },
        evidence_refs: ["act-found", "cast-alice", "place-hall", "object-key"],
        context_evidence_refs: [],
        dropped_evidence_refs: [],
        scope: "actual_story_world",
        confidence: "high",
      },
      {
        event_id: "EV2",
        scene_id: "SC1",
        event_order: 2,
        grouping_source: "llm",
        text_span: { start_pid: 2, end_pid: 2 },
        summary: "Alice opened the door to get out.",
        trigger_refs: ["act-opened"],
        axis_refs: {
          action: ["act-opened"],
          cast: ["cast-alice"],
          place: ["place-hall"],
          time: [],
          object: ["object-door"],
          goal: ["goal-exit"],
          causality: ["cause-key-door"],
        },
        evidence_refs: ["act-opened", "cast-alice", "place-hall", "object-door", "goal-exit", "cause-key-door"],
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
        event_ids: ["EV1", "EV2"],
        text_span: { start_pid: 1, end_pid: 2 },
        boundary_axes: ["action_focus"],
        summary: "Alice uses the key to open a door.",
        axis_labels: {
          time: "current story time",
          place: "hall",
          action_focus: "using the key to leave",
          cast: "Alice",
        },
        confidence: "high",
      },
    ],
    diagnostics: [],
  }
}

function upstream() {
  const mem0 = memoryContract()
  const mem1 = buildV3SceneSituationCards({ docId: "doc", chapterId: "ch01", memoryContract: mem0 })
  const event2 = buildV3EventFrames({ docId: "doc", chapterId: "ch01", memoryContract: mem0, sceneCards: mem1 })
  return { mem0, mem1, event2 }
}

test("GOAL.1 grounds goal cues to the event actor and scene", () => {
  const { mem0, mem1, event2 } = upstream()
  const goals = buildV3GroundedGoals({ docId: "doc", chapterId: "ch01", memoryContract: mem0, sceneCards: mem1, eventFrames: event2 })

  assert.equal(goals.stage_id, "GOAL.1")
  assert.equal(goals.goal_stats.grounded_goals, 1)
  assert.equal(goals.grounded_goals[0]?.holder?.ref_id, "C_CAST_ALICE")
  assert.equal(goals.grounded_goals[0]?.introduced_in_event, "EV2")
  assert.equal(goals.grounded_goals[0]?.content, "get out")
})

test("CAUS.1 creates directed edges only when explicit cue text resolves to events", () => {
  const { mem0, mem1, event2 } = upstream()
  const goals = buildV3GroundedGoals({ docId: "doc", chapterId: "ch01", memoryContract: mem0, sceneCards: mem1, eventFrames: event2 })
  const causal = buildV3CausalEdges({ docId: "doc", chapterId: "ch01", memoryContract: mem0, eventFrames: event2, groundedGoals: goals })

  assert.equal(causal.stage_id, "CAUS.1")
  assert.equal(causal.causal_stats.causal_edges, 1)
  assert.equal(causal.causal_edges[0]?.from_event, "EV1")
  assert.equal(causal.causal_edges[0]?.to_event, "EV2")
  assert.equal(causal.causal_edges[0]?.evidence_refs[0], "cause-key-door")
  assert.equal(causal.unresolved_cues.length, 0)
})

test("MEM.2 and IDX.1 expose progressive memory and retrieval records", () => {
  const { mem0, mem1, event2 } = upstream()
  const goals = buildV3GroundedGoals({ docId: "doc", chapterId: "ch01", memoryContract: mem0, sceneCards: mem1, eventFrames: event2 })
  const causal = buildV3CausalEdges({ docId: "doc", chapterId: "ch01", memoryContract: mem0, eventFrames: event2, groundedGoals: goals })
  const memory = buildV3ProgressiveNarrativeMemory({ docId: "doc", chapterId: "ch01", sceneCards: mem1, eventFrames: event2, groundedGoals: goals, causalEdges: causal })
  const index = buildV3RetrievalIndex({ docId: "doc", chapterId: "ch01", sceneCards: mem1, eventFrames: event2, groundedGoals: goals, causalEdges: causal, progressiveMemory: memory })

  assert.equal(memory.stage_id, "MEM.2")
  assert.equal(memory.memory_stats.characters, 1)
  assert.equal(memory.character_memories[0]?.active_goal_refs[0], "GOAL_EV2_goal-exit")
  assert.equal(memory.causal_graph.edges[0]?.edge_id, "CAUS_EV1_EV2_cause-key-door")

  assert.equal(index.stage_id, "IDX.1")
  assert.ok(index.structured_records.some((record) => record.record_id === "EV2"))
  assert.deepEqual(
    index.structured_records.find((record) => record.record_id === "C_CAST_ALICE"),
    {
      record_id: "C_CAST_ALICE",
      record_type: "character",
      label: "Alice",
      scene_id: "SC1",
      event_id: "EV1",
      evidence_refs: ["cast-alice"],
    },
  )
  assert.ok(index.graph_edges.some((edge) => edge.edge_id === "CAUS_EV1_EV2_cause-key-door"))
  assert.ok(index.text_documents.some((doc) => doc.doc_type === "goal" && doc.text.includes("get out")))
})
