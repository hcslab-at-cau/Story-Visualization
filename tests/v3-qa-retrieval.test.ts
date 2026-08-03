import test from "node:test"
import assert from "node:assert/strict"
import { retrieveV3QAEvidence } from "../src/lib/pipeline/v3-qa-retrieval.ts"
import { hydrateV3RetrievalDocuments } from "../src/lib/pipeline/v3-retrieval-documents.ts"
import type { V3MemoryContractArtifact } from "../src/lib/pipeline/v3-memory-contract-types.ts"
import type { V3EventFramesArtifact, V3SceneSituationCardsArtifact } from "../src/lib/pipeline/v3-memory-frames-types.ts"
import {
  V3_RETRIEVAL_INDEX_VERSION,
  type V3RetrievalIndexArtifact,
} from "../src/lib/pipeline/v3-narrative-memory-types.ts"
import type { PreparedChapter } from "../src/types/schema.ts"

function sceneCards(): V3SceneSituationCardsArtifact {
  return {
    run_id: "mem1",
    doc_id: "doc",
    chapter_id: "ch01",
    stage_id: "MEM.1",
    method: "rule",
    parents: {},
    artifact_version: "v3-scene-situation-cards-0.1",
    extraction_profile: "v3_scene_situation_cards",
    source_stage_ids: ["MEM.0"],
    card_stats: {
      input_scenes: 2,
      input_events: 3,
      scene_cards: 2,
      scenes_with_goal_or_tension: 0,
    },
    scene_cards: [
      {
        scene_id: "SC1",
        scene_order: 1,
        text_span: { start_pid: 1, end_pid: 2 },
        event_ids: ["EV1", "EV2"],
        situation: {
          time: [],
          place: [],
          cast: [],
          action_focus: "Alice finds a key and opens a door",
          salient_objects: [],
        },
        summary_for_retrieval: "Alice finds a key and opens a door.",
        evidence_refs: ["act-found", "act-opened"],
        explicitness: "explicit",
        confidence: "high",
      },
      {
        scene_id: "SC2",
        scene_order: 2,
        text_span: { start_pid: 3, end_pid: 4 },
        event_ids: ["EV3"],
        situation: {
          time: [],
          place: [],
          cast: [],
          action_focus: "Alice meets the queen",
          salient_objects: [],
        },
        summary_for_retrieval: "Alice meets the queen in a later scene.",
        evidence_refs: ["act-queen"],
        explicitness: "explicit",
        confidence: "high",
      },
    ],
  }
}

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
      events_total: 3,
      scenes_total: 2,
      events_assigned: 3,
      events_unassigned: 0,
      scenes_without_events: 0,
      diagnostics_total: 0,
      support_axis_refs: 0,
      drop_axis_refs: 0,
      missing_occurrence_refs: 0,
    },
    evidence_refs: [],
    events: [
      {
        event_id: "EV1",
        scene_id: "SC1",
        event_order: 1,
        grouping_source: "llm",
        text_span: { start_pid: 1, end_pid: 1 },
        summary: "Alice found the brass key.",
        trigger_refs: ["act-found"],
        axis_refs: { action: ["act-found"], cast: [], place: [], time: [], object: [], goal: [], causality: [] },
        evidence_refs: ["act-found"],
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
        summary: "Alice opened the door.",
        trigger_refs: ["act-opened"],
        axis_refs: { action: ["act-opened"], cast: [], place: [], time: [], object: [], goal: [], causality: [] },
        evidence_refs: ["act-opened"],
        context_evidence_refs: [],
        dropped_evidence_refs: [],
        scope: "actual_story_world",
        confidence: "high",
      },
      {
        event_id: "EV3",
        scene_id: "SC2",
        event_order: 3,
        grouping_source: "llm",
        text_span: { start_pid: 3, end_pid: 3 },
        summary: "Alice met the queen.",
        trigger_refs: ["act-queen"],
        axis_refs: { action: ["act-queen"], cast: [], place: [], time: [], object: [], goal: [], causality: [] },
        evidence_refs: ["act-queen"],
        context_evidence_refs: [],
        dropped_evidence_refs: [],
        scope: "actual_story_world",
        confidence: "high",
      },
    ],
    scenes: [],
    diagnostics: [],
  }
}

function eventFrames(): V3EventFramesArtifact {
  return {
    run_id: "event2",
    doc_id: "doc",
    chapter_id: "ch01",
    stage_id: "EVENT.2",
    method: "rule",
    parents: {},
    artifact_version: "v3-event-argument-frames-0.1",
    extraction_profile: "v3_event_argument_frames",
    source_stage_ids: ["MEM.0", "MEM.1"],
    frame_stats: {
      input_events: 3,
      event_frames: 3,
      frames_with_trigger: 3,
      arguments_total: 0,
    },
    event_frames: [
      {
        event_id: "EV1",
        scene_id: "SC1",
        event_order: 1,
        event_type: "action",
        predicate: "found brass key",
        trigger_refs: ["act-found"],
        arguments: [],
        time_refs: [],
        goal_cue_refs: [],
        causal_cue_refs: [],
        evidence_refs: ["act-found"],
        scope: "actual_story_world",
        confidence: "high",
      },
      {
        event_id: "EV2",
        scene_id: "SC1",
        event_order: 2,
        event_type: "action",
        predicate: "opened door",
        trigger_refs: ["act-opened"],
        arguments: [],
        time_refs: [],
        goal_cue_refs: [],
        causal_cue_refs: [],
        evidence_refs: ["act-opened"],
        scope: "actual_story_world",
        confidence: "high",
      },
      {
        event_id: "EV3",
        scene_id: "SC2",
        event_order: 3,
        event_type: "action",
        predicate: "met queen",
        trigger_refs: ["act-queen"],
        arguments: [],
        time_refs: [],
        goal_cue_refs: [],
        causal_cue_refs: [],
        evidence_refs: ["act-queen"],
        scope: "actual_story_world",
        confidence: "high",
      },
    ],
  }
}

function retrievalIndex(): V3RetrievalIndexArtifact {
  return {
    run_id: "idx1",
    doc_id: "doc",
    chapter_id: "ch01",
    stage_id: "IDX.1",
    method: "rule",
    parents: {},
    artifact_version: "v3-retrieval-index-0.1",
    extraction_profile: "v3_retrieval_index",
    source_stage_ids: ["MEM.1", "EVENT.2", "GOAL.1", "CAUS.1", "MEM.2"],
    index_stats: {
      structured_records: 5,
      graph_edges: 2,
      text_documents: 5,
    },
    structured_records: [
      { record_id: "SC1", record_type: "scene", label: "key and door scene", scene_id: "SC1", evidence_refs: ["act-found", "act-opened"], progress_start: 1, progress_end: 2 },
      { record_id: "EV1", record_type: "event", label: "found brass key", scene_id: "SC1", event_id: "EV1", evidence_refs: ["act-found"] },
      { record_id: "EV2", record_type: "event", label: "opened door", scene_id: "SC1", event_id: "EV2", evidence_refs: ["act-opened"] },
      { record_id: "SC2", record_type: "scene", label: "queen scene", scene_id: "SC2", evidence_refs: ["act-queen"], progress_start: 3, progress_end: 4 },
      { record_id: "EV3", record_type: "event", label: "met queen", scene_id: "SC2", event_id: "EV3", evidence_refs: ["act-queen"] },
    ],
    graph_edges: [
      { edge_id: "EDGE_EV1_EV2", from: "EV1", to: "EV2", relation_type: "enables", evidence_refs: ["act-found", "act-opened"] },
      { edge_id: "EDGE_EV3_SC2", from: "EV3", to: "SC2", relation_type: "occurs_in", evidence_refs: ["act-queen"] },
    ],
    text_documents: [
      { text_doc_id: "TEXT_SC1", doc_type: "scene", text: "Alice finds a key and opens a door.", scene_id: "SC1", evidence_refs: ["act-found", "act-opened"] },
      { text_doc_id: "TEXT_EV1", doc_type: "event", text: "Alice found a brass key.", scene_id: "SC1", event_id: "EV1", evidence_refs: ["act-found"] },
      { text_doc_id: "TEXT_EV2", doc_type: "event", text: "Alice opened the door.", scene_id: "SC1", event_id: "EV2", evidence_refs: ["act-opened"] },
      { text_doc_id: "TEXT_SC2", doc_type: "scene", text: "Alice meets the queen later.", scene_id: "SC2", evidence_refs: ["act-queen"] },
      { text_doc_id: "TEXT_EV3", doc_type: "event", text: "Alice met the queen.", scene_id: "SC2", event_id: "EV3", evidence_refs: ["act-queen"] },
    ],
  }
}

test("QA retrieval returns progress-bounded lexical hits and graph neighbors", () => {
  const result = retrieveV3QAEvidence({
    question: "What did the key help with?",
    progressEndPid: 2,
    retrievalIndex: retrievalIndex(),
    sceneCards: sceneCards(),
    eventFrames: eventFrames(),
    memoryContract: memoryContract(),
  })

  assert.equal(result.query.question, "What did the key help with?")
  assert.equal(result.query.progress_end_pid, 2)
  assert.equal(result.retrieval_mode, "lexical_fallback")
  assert.equal(result.stats.direct_hits, 2)
  assert.ok(result.hits.some((hit) => hit.record_id === "EV1" && hit.match_kind === "lexical"))
  assert.ok(result.hits.some((hit) => hit.record_id === "EV2" && hit.match_kind === "graph_neighbor"))
  assert.ok(result.graph_edges.some((edge) => edge.edge_id === "EDGE_EV1_EV2"))
  assert.equal(result.hits.some((hit) => hit.record_id === "EV3"), false)
  assert.ok(result.stats.blocked_ahead_records > 0)
})

test("QA retrieval fuses semantic and lexical ranks after applying the reader progress cutoff", () => {
  const result = retrieveV3QAEvidence({
    question: "How did she get through?",
    progressEndPid: 2,
    retrievalIndex: retrievalIndex(),
    sceneCards: sceneCards(),
    eventFrames: eventFrames(),
    memoryContract: memoryContract(),
    semanticScores: {
      EV2: 0.94,
      EV3: 0.99,
    },
  })

  assert.equal(result.retrieval_mode, "hybrid")
  assert.ok(result.hits.some((hit) => hit.record_id === "EV2" && hit.match_kind === "semantic"))
  assert.equal(result.hits.some((hit) => hit.record_id === "EV3"), false)
  assert.equal(result.stats.semantic_hits, 1)
  assert.ok(result.stats.blocked_ahead_records > 0)
})

test("QA retrieval fails closed for records without a resolvable progress span", () => {
  const index = retrievalIndex()
  index.structured_records.push(
    {
      record_id: "CHAR_UNKNOWN",
      record_type: "character",
      label: "the hidden queen",
      evidence_refs: [],
    },
    {
      record_id: "PLACE_FUTURE",
      record_type: "place",
      label: "the later palace",
      evidence_refs: [],
      progress_start: 4,
      progress_end: 4,
    },
  )

  const result = retrieveV3QAEvidence({
    question: "Where is the hidden queen?",
    progressEndPid: 2,
    retrievalIndex: index,
    sceneCards: sceneCards(),
    eventFrames: eventFrames(),
    memoryContract: memoryContract(),
    semanticScores: {
      CHAR_UNKNOWN: 0.99,
      PLACE_FUTURE: 0.98,
    },
  })

  assert.equal(result.hits.some((hit) => hit.record_id === "CHAR_UNKNOWN"), false)
  assert.equal(result.hits.some((hit) => hit.record_id === "PLACE_FUTURE"), false)
  assert.equal(result.stats.semantic_hits, 0)
  assert.ok(result.stats.blocked_ahead_records >= 2)
})

test("QA retrieval searches hydrated paragraph text and blocks that paragraph before its PID", () => {
  const index: V3RetrievalIndexArtifact = {
    ...retrievalIndex(),
    artifact_version: V3_RETRIEVAL_INDEX_VERSION,
    source_stage_ids: ["PRE.1", "PRE.2", "EVID.4", "MEM.1", "EVENT.2", "GOAL.1", "CAUS.1", "MEM.2"],
    structured_records: [
      ...retrievalIndex().structured_records,
      {
        record_id: "PARAGRAPH_para_0002",
        record_type: "paragraph",
        label: "Paragraph P2",
        source_paragraph_id: "para_0002",
        evidence_refs: [],
        progress_start: 2,
        progress_end: 2,
      },
    ],
    index_stats: { structured_records: 6, graph_edges: 2, text_documents: 5 },
  }
  const preparedChapter: PreparedChapter = {
    run_id: "pre1",
    doc_id: "doc",
    chapter_id: "ch01",
    stage_id: "PRE.1",
    method: "epub+rule",
    parents: {},
    chapter_title: "Chapter One",
    paragraph_count: 2,
    char_count: 52,
    raw_chapter: {
      doc_id: "doc",
      chapter_id: "ch01",
      title: "Chapter One",
      text: "Opening.\nAlice ate marmalade bread at supper, her only food.",
      paragraphs: [
        { pid: 1, start: 0, end: 8, text: "Opening.", paragraph_id: "para_0001" },
        { pid: 2, start: 9, end: 59, text: "Alice ate marmalade bread at supper, her only food.", paragraph_id: "para_0002" },
      ],
    },
  }
  const hydratedDocuments = hydrateV3RetrievalDocuments({ retrievalIndex: index, preparedChapter })
  assert.ok(index.text_documents.every((document) => !/marmalade|supper|food/i.test(document.text)))

  const available = retrieveV3QAEvidence({
    question: "What food did Alice eat at supper?",
    progressEndPid: 2,
    retrievalIndex: index,
    textDocuments: hydratedDocuments,
    sceneCards: sceneCards(),
    eventFrames: eventFrames(),
    memoryContract: memoryContract(),
  })
  const blocked = retrieveV3QAEvidence({
    question: "What food did Alice eat at supper?",
    progressEndPid: 1,
    retrievalIndex: index,
    textDocuments: hydratedDocuments,
    sceneCards: sceneCards(),
    eventFrames: eventFrames(),
    memoryContract: memoryContract(),
  })

  assert.ok(available.hits.some((hit) => hit.record_id === "PARAGRAPH_para_0002" && hit.record_type === "paragraph"))
  assert.equal(blocked.hits.some((hit) => hit.record_id === "PARAGRAPH_para_0002"), false)
  assert.ok(blocked.stats.blocked_ahead_records > available.stats.blocked_ahead_records)
})
