import test from "node:test"
import assert from "node:assert/strict"
import {
  retrieveV3BookQAEvidence,
  type V3BookQARetrievalChapterInput,
} from "../src/lib/pipeline/v3-book-qa-retrieval.ts"
import { buildV3BookQACorpusManifest } from "../src/lib/pipeline/v3-book-qa-corpus.ts"
import type {
  V3BookEntityGroup,
  V3BookQAChapterRef,
  V3BookQACorpusManifest,
} from "../src/lib/pipeline/v3-book-qa-types.ts"
import type { V3MemoryContractArtifact } from "../src/lib/pipeline/v3-memory-contract-types.ts"
import type {
  V3EventFramesArtifact,
  V3SceneSituationCardsArtifact,
} from "../src/lib/pipeline/v3-memory-frames-types.ts"
import {
  V3_RETRIEVAL_INDEX_VERSION,
  type V3RetrievalGraphEdge,
  type V3RetrievalIndexArtifact,
  type V3StructuredRetrievalRecord,
} from "../src/lib/pipeline/v3-narrative-memory-types.ts"

interface RecordSpec {
  id: string
  pid: number
  text: string
  entityRefs?: string[]
  sceneId?: string
  eventId?: string
}

function chapterRef(chapterId: string, chapterIndex: number): V3BookQAChapterRef {
  return {
    chapter_id: chapterId,
    chapter_title: `Chapter ${chapterIndex}`,
    chapter_index: chapterIndex,
    run_id: `run-${chapterId}`,
    progress_end_pid: 8,
    artifact_ids: {},
  }
}

function corpus(): V3BookQACorpusManifest {
  return buildV3BookQACorpusManifest({
    docId: "doc",
    chapters: [chapterRef("ch01", 1), chapterRef("ch02", 2), chapterRef("ch03", 3)],
  })
}

function emptySceneCards(chapterId: string): V3SceneSituationCardsArtifact {
  return {
    run_id: `mem1-${chapterId}`,
    doc_id: "doc",
    chapter_id: chapterId,
    stage_id: "MEM.1",
    method: "rule",
    parents: {},
    artifact_version: "v3-scene-situation-cards-0.1",
    extraction_profile: "v3_scene_situation_cards",
    source_stage_ids: ["MEM.0"],
    card_stats: {
      input_scenes: 0,
      input_events: 0,
      scene_cards: 0,
      scenes_with_goal_or_tension: 0,
    },
    scene_cards: [],
  }
}

function emptyEventFrames(chapterId: string): V3EventFramesArtifact {
  return {
    run_id: `event2-${chapterId}`,
    doc_id: "doc",
    chapter_id: chapterId,
    stage_id: "EVENT.2",
    method: "rule",
    parents: {},
    artifact_version: "v3-event-argument-frames-0.1",
    extraction_profile: "v3_event_argument_frames",
    source_stage_ids: ["MEM.0", "MEM.1"],
    frame_stats: {
      input_events: 0,
      event_frames: 0,
      frames_with_trigger: 0,
      arguments_total: 0,
    },
    event_frames: [],
  }
}

function emptyMemoryContract(chapterId: string): V3MemoryContractArtifact {
  return {
    run_id: `mem0-${chapterId}`,
    doc_id: "doc",
    chapter_id: chapterId,
    stage_id: "MEM.0",
    method: "rule",
    parents: {},
    artifact_version: "v3-memory-contract-0.1",
    extraction_profile: "v3_narrative_memory_contract",
    source_stage_ids: ["EVENT.1", "SCENE.0"],
    contract_stats: {
      events_total: 0,
      scenes_total: 0,
      events_assigned: 0,
      events_unassigned: 0,
      scenes_without_events: 0,
      diagnostics_total: 0,
      support_axis_refs: 0,
      drop_axis_refs: 0,
      missing_occurrence_refs: 0,
    },
    evidence_refs: [],
    events: [],
    scenes: [],
    diagnostics: [],
  }
}

function retrievalChapter(
  chapterId: string,
  chapterIndex: number,
  records: RecordSpec[],
  graphEdges: V3RetrievalGraphEdge[] = [],
): V3BookQARetrievalChapterInput {
  const structuredRecords: V3StructuredRetrievalRecord[] = records.map((record) => ({
    record_id: record.id,
    record_type: "paragraph",
    label: `Paragraph P${record.pid}`,
    source_paragraph_id: record.id.replace(/^PARAGRAPH_/, ""),
    entity_refs: record.entityRefs ?? [],
    scene_id: record.sceneId,
    event_id: record.eventId,
    evidence_refs: [`evidence-${record.id}`],
    progress_start: record.pid,
    progress_end: record.pid,
  }))
  const retrievalIndex: V3RetrievalIndexArtifact = {
    run_id: `idx1-${chapterId}`,
    doc_id: "doc",
    chapter_id: chapterId,
    stage_id: "IDX.1",
    method: "rule",
    parents: {},
    artifact_version: V3_RETRIEVAL_INDEX_VERSION,
    extraction_profile: "v3_retrieval_index",
    source_stage_ids: ["PRE.1", "PRE.2", "EVID.4", "MEM.1", "EVENT.2", "GOAL.1", "CAUS.1", "MEM.2"],
    index_stats: {
      structured_records: structuredRecords.length,
      graph_edges: graphEdges.length,
      text_documents: 0,
    },
    structured_records: structuredRecords,
    graph_edges: graphEdges,
    text_documents: [],
  }

  return {
    chapter_id: chapterId,
    chapter_title: `Chapter ${chapterIndex}`,
    chapter_index: chapterIndex,
    retrieval_index: retrievalIndex,
    text_documents: records.map((record) => ({
      text_doc_id: `TEXT_${record.id}`,
      doc_type: "paragraph",
      text: record.text,
      scene_id: record.sceneId,
      event_id: record.eventId,
      evidence_refs: [`evidence-${record.id}`],
    })),
    scene_cards: emptySceneCards(chapterId),
    event_frames: emptyEventFrames(chapterId),
    memory_contract: emptyMemoryContract(chapterId),
  }
}

test("retrieves a prior chapter food paragraph while hard-blocking the current suffix and future chapters", () => {
  const result = retrieveV3BookQAEvidence({
    corpus: corpus(),
    chapters: [
      retrievalChapter("ch01", 1, [
        { id: "PARAGRAPH_para_0007", pid: 7, text: "Alice ate cake and drank tea." },
      ]),
      retrievalChapter("ch02", 2, [
        { id: "PARAGRAPH_para_0004", pid: 4, text: "Alice rested beside the river." },
        { id: "PARAGRAPH_para_0005", pid: 5, text: "Alice secretly ate a pear." },
      ]),
      retrievalChapter("ch03", 3, [
        { id: "PARAGRAPH_para_0001", pid: 1, text: "Alice ate the future feast." },
      ]),
    ],
    question: "What did Alice eat earlier?",
    readerPosition: { chapter_id: "ch02", pid: 4 },
    semanticScores: {
      "ch01:PARAGRAPH_para_0007": 0.7,
      "ch02:PARAGRAPH_para_0005": 0.99,
      "ch03:PARAGRAPH_para_0001": 1,
    },
  })

  assert.equal(result.hits[0]?.record_id, "ch01:PARAGRAPH_para_0007")
  assert.equal(result.hits[0]?.chapter_id, "ch01")
  assert.equal(result.hits[0]?.chapter_title, "Chapter 1")
  assert.deepEqual(result.hits[0]?.text_span, { start_pid: 7, end_pid: 7 })
  assert.equal(result.hits[0]?.pid, 7)
  assert.equal(result.hits.some((hit) => hit.record_id === "ch02:PARAGRAPH_para_0005"), false)
  assert.equal(result.hits.some((hit) => hit.chapter_id === "ch03"), false)
  assert.equal(JSON.stringify(result).includes("future feast"), false)
  assert.equal(result.stats.blocked_ahead_records, 1)
})

test("ranks all readable chapters together instead of preserving per-chapter merge order", () => {
  const result = retrieveV3BookQAEvidence({
    corpus: corpus(),
    chapters: [
      retrievalChapter("ch02", 2, [
        { id: "PARAGRAPH_shared", pid: 2, text: "The golden rabbit vanished." },
      ]),
      retrievalChapter("ch01", 1, [
        { id: "PARAGRAPH_shared", pid: 2, text: "A rabbit vanished." },
      ]),
    ],
    question: "golden rabbit",
    readerPosition: { chapter_id: "ch02", pid: 4 },
  })

  assert.deepEqual(
    result.hits.map((hit) => hit.record_id),
    ["ch02:PARAGRAPH_shared", "ch01:PARAGRAPH_shared"],
  )
  assert.equal(result.stats.lexical_hits, 2)
})

test("namespaces colliding record and graph identifiers and bounds graph expansion", () => {
  const edges = ["B", "C", "D", "E"].map((neighbor) => ({
    edge_id: `EDGE_A_${neighbor}`,
    from: "A",
    to: neighbor,
    relation_type: "related",
    evidence_refs: [`edge-${neighbor}`],
  }))
  const records = [
    { id: "A", pid: 1, text: "A silver seed.", sceneId: "SC1", eventId: "EV1" },
    ...["B", "C", "D", "E"].map((id, index) => ({ id, pid: index + 2, text: `Neighbor ${id}.` })),
  ]
  const result = retrieveV3BookQAEvidence({
    corpus: corpus(),
    chapters: [
      retrievalChapter("ch01", 1, records, edges),
      retrievalChapter("ch02", 2, records, edges),
    ],
    question: "silver seed",
    readerPosition: { chapter_id: "ch02", pid: 4 },
    limit: 5,
  })

  assert.ok(result.hits.some((hit) => hit.record_id === "ch01:A"))
  assert.ok(result.hits.some((hit) => hit.record_id === "ch02:A"))
  assert.ok(result.hits.some((hit) => hit.match_kind === "graph_neighbor"))
  assert.equal(result.hits.find((hit) => hit.record_id === "ch01:A")?.scene_id, "ch01:SC1")
  assert.equal(result.hits.find((hit) => hit.record_id === "ch01:A")?.event_id, "ch01:EV1")
  assert.ok(result.hits.find((hit) => hit.record_id === "ch01:A")?.evidence_refs.every((ref) => ref.startsWith("ch01:")))
  assert.ok(result.hits.length <= 5)
  assert.ok(result.stats.graph_neighbor_hits <= 5)
  assert.ok(result.graph_edges.length <= 5)
  assert.ok(result.graph_edges.every((edge) =>
    /^(ch01|ch02):EDGE_A_/.test(edge.edge_id)
      && /^(ch01|ch02):/.test(edge.from)
      && /^(ch01|ch02):/.test(edge.to)
      && edge.evidence_refs.every((ref) => /^(ch01|ch02):/.test(ref))))
  assert.equal(result.graph_edges.some((edge) => edge.from.startsWith("ch01:") && edge.to.startsWith("ch02:")), false)
  assert.equal(result.hits.some((hit) => hit.record_id === "ch02:E"), false)
})

test("matches only visible entity aliases and expands only readable member records", () => {
  const entityGroup: V3BookEntityGroup = {
    global_entity_id: "BOOK_ENTITY_alice",
    entity_type: "cast",
    canonical_label: "Future Empress",
    members: [
      {
        chapter_id: "ch01",
        chapter_index: 1,
        run_id: "run-ch01",
        local_cluster_id: "cast-1",
        canonical_label: "Mysterious Woman",
        aliases: [{ value: "Mysterious Woman", evidence_pids: [2], available_from_pid: 2 }],
        evidence_pids: [2],
        link_available_from_pid: 2,
      },
      {
        chapter_id: "ch02",
        chapter_index: 2,
        run_id: "run-ch02",
        local_cluster_id: "cast-2",
        canonical_label: "Queen Alice",
        aliases: [
          { value: "Mysterious Woman", evidence_pids: [2], available_from_pid: 2 },
          { value: "Queen Alice", evidence_pids: [8], available_from_pid: 8 },
        ],
        evidence_pids: [2, 8],
        link_available_from_pid: 2,
      },
      {
        chapter_id: "ch03",
        chapter_index: 3,
        run_id: "run-ch03",
        local_cluster_id: "cast-3",
        canonical_label: "Future Empress",
        aliases: [
          { value: "Mysterious Woman", evidence_pids: [1], available_from_pid: 1 },
          { value: "Future Empress", evidence_pids: [3], available_from_pid: 3 },
        ],
        evidence_pids: [1, 3],
        link_available_from_pid: 1,
      },
    ],
  }
  const chapters = [
    retrievalChapter("ch01", 1, [
      { id: "PARAGRAPH_para_0003", pid: 3, text: "She crossed the garden.", entityRefs: ["cast-1"] },
    ]),
    retrievalChapter("ch02", 2, [
      { id: "PARAGRAPH_para_0003", pid: 3, text: "She entered the hall.", entityRefs: ["cast-2"] },
      { id: "PARAGRAPH_para_0008", pid: 8, text: "She took the crown.", entityRefs: ["cast-2"] },
    ]),
    retrievalChapter("ch03", 3, [
      { id: "PARAGRAPH_para_0001", pid: 1, text: "She ruled the empire.", entityRefs: ["cast-3"] },
    ]),
  ]

  const visible = retrieveV3BookQAEvidence({
    corpus: corpus(),
    chapters,
    entityGroups: [entityGroup],
    question: "Where did the Mysterious Woman go?",
    readerPosition: { chapter_id: "ch02", pid: 4 },
  })
  assert.deepEqual(
    visible.hits.map((hit) => [hit.record_id, hit.match_kind]),
    [
      ["ch01:PARAGRAPH_para_0003", "entity_group"],
      ["ch02:PARAGRAPH_para_0003", "entity_group"],
    ],
  )
  assert.equal(visible.stats.entity_group_hits, 2)
  assert.equal(JSON.stringify(visible).includes("Queen Alice"), false)
  assert.equal(JSON.stringify(visible).includes("Future Empress"), false)
  assert.equal(JSON.stringify(visible).includes("ch03"), false)

  for (const hiddenName of ["Queen Alice", "Future Empress"]) {
    const hidden = retrieveV3BookQAEvidence({
      corpus: corpus(),
      chapters,
      entityGroups: [entityGroup],
      question: `Where did ${hiddenName} go?`,
      readerPosition: { chapter_id: "ch02", pid: 4 },
    })
    assert.equal(hidden.hits.some((hit) => hit.match_kind === "entity_group"), false)
    assert.equal(JSON.stringify(hidden.hits).includes("ch03"), false)
  }
})
