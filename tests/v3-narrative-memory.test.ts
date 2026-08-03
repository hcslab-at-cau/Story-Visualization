import test from "node:test"
import assert from "node:assert/strict"
import { buildV3EventFrames, buildV3SceneSituationCards } from "../src/lib/pipeline/v3-memory-frames.ts"
import {
  buildV3CausalEdges,
  buildV3GroundedGoals,
  buildV3ProgressiveNarrativeMemory,
  buildV3RetrievalIndex,
} from "../src/lib/pipeline/v3-narrative-memory.ts"
import type { V3EvidenceClusteringArtifact } from "../src/lib/pipeline/v3-evidence-clustering-types.ts"
import type { V3MemoryContractArtifact } from "../src/lib/pipeline/v3-memory-contract-types.ts"
import type { ContentUnits, PreparedChapter } from "../src/types/schema.ts"

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

function paragraphInputs(): {
  preparedChapter: PreparedChapter
  contentUnits: ContentUnits
  evidenceClusters: V3EvidenceClusteringArtifact
} {
  const paragraphs = [
    { pid: 0, start: 0, end: 11, text: "Chapter One", paragraph_id: "heading_0000" },
    { pid: 1, start: 12, end: 44, text: "Alice found the key in the hall.", paragraph_id: "para_0001" },
    { pid: 2, start: 45, end: 75, text: "Alice opened the door to leave.", paragraph_id: "para_0002" },
    { pid: 3, start: 76, end: 103, text: "Alice ate bread and cheese." },
  ]

  return {
    preparedChapter: {
      run_id: "pre1",
      doc_id: "doc",
      chapter_id: "ch01",
      stage_id: "PRE.1",
      method: "epub+rule",
      parents: {},
      chapter_title: "Chapter One",
      paragraph_count: paragraphs.length,
      char_count: paragraphs.reduce((total, paragraph) => total + paragraph.text.length, 0),
      raw_chapter: {
        doc_id: "doc",
        chapter_id: "ch01",
        title: "Chapter One",
        text: paragraphs.map((paragraph) => paragraph.text).join("\n"),
        paragraphs,
      },
    },
    contentUnits: {
      run_id: "pre2",
      doc_id: "doc",
      chapter_id: "ch01",
      stage_id: "PRE.2",
      parents: { "PRE.1": "pre1" },
      units: [
        { pid: 0, content_type: "chapter_heading", is_story_text: false },
        { pid: 1, content_type: "narrative", is_story_text: true },
        { pid: 2, content_type: "narrative", is_story_text: true },
        { pid: 3, content_type: "narrative", is_story_text: true },
      ],
    },
    evidenceClusters: {
      run_id: "evid4",
      doc_id: "doc",
      chapter_id: "ch01",
      stage_id: "EVID.4",
      method: "rule",
      parents: { "EVID.3": "evid3" },
      extraction_profile: "v3_evidence_entity_clustering",
      source_stage_ids: ["EVID.3"],
      cluster_stats: {
        input_refined_candidates: 3,
        entity_like_candidates: 3,
        entity_clusters: 3,
        singleton_clusters: 3,
        unclustered_candidates: 0,
        by_type: { cast: 1, place: 1, object: 1 },
      },
      entity_clusters: [
        {
          cluster_id: "OBJECT_BREAD",
          entity_type: "object",
          canonical_label: "bread",
          aliases: ["bread"],
          refined_candidate_ids: ["object-bread"],
          source_candidate_ids: ["raw-object-bread"],
          evidence_pids: [3],
          mention_count: 1,
        },
        {
          cluster_id: "CAST_ALICE",
          entity_type: "cast",
          canonical_label: "Alice",
          aliases: ["Alice"],
          refined_candidate_ids: ["cast-alice"],
          source_candidate_ids: ["raw-cast-alice"],
          evidence_pids: [1, 3],
          mention_count: 2,
        },
        {
          cluster_id: "PLACE_HALL",
          entity_type: "place",
          canonical_label: "hall",
          aliases: ["hall"],
          refined_candidate_ids: ["place-hall"],
          source_candidate_ids: ["raw-place-hall"],
          evidence_pids: [1, 2],
          mention_count: 2,
        },
      ],
      candidate_cluster_map: {
        "object-bread": "OBJECT_BREAD",
        "cast-alice": "CAST_ALICE",
        "place-hall": "PLACE_HALL",
      },
    },
  }
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

test("MEM.2 and IDX.1 expose progressive memory plus source-backed story paragraph descriptors", () => {
  const { mem0, mem1, event2 } = upstream()
  const { preparedChapter, contentUnits, evidenceClusters } = paragraphInputs()
  const goals = buildV3GroundedGoals({ docId: "doc", chapterId: "ch01", memoryContract: mem0, sceneCards: mem1, eventFrames: event2 })
  const causal = buildV3CausalEdges({ docId: "doc", chapterId: "ch01", memoryContract: mem0, eventFrames: event2, groundedGoals: goals })
  const memory = buildV3ProgressiveNarrativeMemory({ docId: "doc", chapterId: "ch01", sceneCards: mem1, eventFrames: event2, groundedGoals: goals, causalEdges: causal })
  const index = buildV3RetrievalIndex({
    docId: "doc",
    chapterId: "ch01",
    preparedChapter,
    contentUnits,
    evidenceClusters,
    sceneCards: mem1,
    eventFrames: event2,
    groundedGoals: goals,
    causalEdges: causal,
    progressiveMemory: memory,
  })

  assert.equal(memory.stage_id, "MEM.2")
  assert.equal(memory.memory_stats.characters, 1)
  assert.equal(memory.character_memories[0]?.active_goal_refs[0], "GOAL_EV2_goal-exit")
  assert.equal(memory.causal_graph.edges[0]?.edge_id, "CAUS_EV1_EV2_cause-key-door")

  assert.equal(index.stage_id, "IDX.1")
  assert.equal(index.artifact_version, "v3-retrieval-index-0.2")
  assert.deepEqual(index.source_stage_ids, [
    "PRE.1",
    "PRE.2",
    "EVID.4",
    "MEM.1",
    "EVENT.2",
    "GOAL.1",
    "CAUS.1",
    "MEM.2",
  ])
  assert.deepEqual(
    index.structured_records.find((record) => record.record_id === "PARAGRAPH_ch01_3"),
    {
      record_id: "PARAGRAPH_ch01_3",
      record_type: "paragraph",
      label: "Paragraph P3",
      source_paragraph_id: "ch01_3",
      entity_refs: ["CAST_ALICE", "OBJECT_BREAD"],
      evidence_refs: [],
      progress_start: 3,
      progress_end: 3,
    },
  )
  assert.equal(
    index.structured_records.find((record) => record.record_id === "PARAGRAPH_para_0001")?.source_paragraph_id,
    "para_0001",
  )
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
  assert.equal(index.text_documents.some((doc) => doc.doc_type === "paragraph"), false)
  assert.doesNotMatch(index.text_documents.map((document) => document.text).join(" "), /bread|cheese|food|ate/i)
  assert.equal(JSON.stringify(index).includes("Alice ate bread and cheese."), false)
})
