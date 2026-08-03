import test from "node:test"
import assert from "node:assert/strict"
import {
  buildV3ParagraphRetrievalRecords,
  hydrateV3RetrievalDocuments,
} from "../src/lib/pipeline/v3-retrieval-documents.ts"
import {
  V3_RETRIEVAL_INDEX_LEGACY_VERSION,
  V3_RETRIEVAL_INDEX_PROFILE,
  V3_RETRIEVAL_INDEX_VERSION,
  type V3RetrievalIndexArtifact,
  type V3StructuredRetrievalRecord,
} from "../src/lib/pipeline/v3-narrative-memory-types.ts"
import type { V3EvidenceClusteringArtifact } from "../src/lib/pipeline/v3-evidence-clustering-types.ts"
import type { ContentUnits, Paragraph, PreparedChapter } from "../src/types/schema.ts"

function preparedChapter(paragraphs: Paragraph[], chapterId = "ch01"): PreparedChapter {
  return {
    run_id: `pre1-${chapterId}`,
    doc_id: "doc",
    chapter_id: chapterId,
    stage_id: "PRE.1",
    method: "epub+rule",
    parents: {},
    chapter_title: "Chapter One",
    paragraph_count: paragraphs.length,
    char_count: paragraphs.reduce((total, paragraph) => total + paragraph.text.length, 0),
    raw_chapter: {
      doc_id: "doc",
      chapter_id: chapterId,
      title: "Chapter One",
      text: paragraphs.map((paragraph) => paragraph.text).join("\n"),
      paragraphs,
    },
  }
}

function contentUnits(): ContentUnits {
  return {
    run_id: "pre2",
    doc_id: "doc",
    chapter_id: "ch01",
    stage_id: "PRE.2",
    parents: { "PRE.1": "pre1-ch01" },
    units: [
      { pid: 6, content_type: "chapter_heading", is_story_text: false },
      { pid: 7, content_type: "narrative", is_story_text: true },
      { pid: 8, content_type: "narrative", is_story_text: true },
    ],
  }
}

function evidenceClusters(): V3EvidenceClusteringArtifact {
  return {
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
        cluster_id: "PLACE_HALL",
        entity_type: "place",
        canonical_label: "hall",
        aliases: ["hall"],
        refined_candidate_ids: ["place-hall"],
        source_candidate_ids: ["raw-place-hall"],
        evidence_pids: [9],
        mention_count: 1,
      },
      {
        cluster_id: "CAST_ALICE",
        entity_type: "cast",
        canonical_label: "Alice",
        aliases: ["Alice"],
        refined_candidate_ids: ["cast-alice"],
        source_candidate_ids: ["raw-cast-alice"],
        evidence_pids: [7],
        mention_count: 1,
      },
      {
        cluster_id: "OBJECT_WATCH",
        entity_type: "object",
        canonical_label: "watch",
        aliases: ["watch"],
        refined_candidate_ids: ["object-watch"],
        source_candidate_ids: ["raw-object-watch"],
        evidence_pids: [8],
        mention_count: 1,
      },
    ],
    candidate_cluster_map: {
      "place-hall": "PLACE_HALL",
      "cast-alice": "CAST_ALICE",
      "object-watch": "OBJECT_WATCH",
    },
  }
}

function paragraphFixture(): PreparedChapter {
  return preparedChapter([
    { pid: 6, start: 0, end: 11, text: "Chapter One", paragraph_id: "heading_0006" },
    { pid: 7, start: 12, end: 38, text: "Alice served tea and cake.", paragraph_id: "para_0007" },
    { pid: 8, start: 39, end: 64, text: "The rabbit checked a watch." },
  ])
}

function retrievalIndex(params: {
  artifactVersion?: V3RetrievalIndexArtifact["artifact_version"]
  chapterId?: string
  records?: V3StructuredRetrievalRecord[]
  textDocuments?: V3RetrievalIndexArtifact["text_documents"]
} = {}): V3RetrievalIndexArtifact {
  const artifactVersion = params.artifactVersion ?? V3_RETRIEVAL_INDEX_VERSION
  const records = params.records ?? []
  const textDocuments = params.textDocuments ?? []
  return {
    run_id: "idx1",
    doc_id: "doc",
    chapter_id: params.chapterId ?? "ch01",
    stage_id: "IDX.1",
    method: "rule",
    parents: {},
    artifact_version: artifactVersion,
    extraction_profile: V3_RETRIEVAL_INDEX_PROFILE,
    source_stage_ids: artifactVersion === V3_RETRIEVAL_INDEX_LEGACY_VERSION
      ? ["MEM.1", "EVENT.2", "GOAL.1", "CAUS.1", "MEM.2"]
      : ["PRE.1", "PRE.2", "EVID.4", "MEM.1", "EVENT.2", "GOAL.1", "CAUS.1", "MEM.2"],
    index_stats: {
      structured_records: records.length,
      graph_edges: 0,
      text_documents: textDocuments.length,
    },
    structured_records: records,
    graph_edges: [],
    text_documents: textDocuments,
  }
}

function paragraphRecords(): V3StructuredRetrievalRecord[] {
  return buildV3ParagraphRetrievalRecords({
    chapterId: "ch01",
    preparedChapter: paragraphFixture(),
    contentUnits: contentUnits(),
    evidenceClusters: evidenceClusters(),
  })
}

test("paragraph descriptors use canonical and deterministic fallback IDs without copying source text", () => {
  const records = paragraphRecords()

  assert.equal(records.length, 2)
  assert.deepEqual(records[0], {
    record_id: "PARAGRAPH_para_0007",
    record_type: "paragraph",
    label: "Paragraph P7",
    source_paragraph_id: "para_0007",
    entity_refs: ["CAST_ALICE"],
    evidence_refs: [],
    progress_start: 7,
    progress_end: 7,
  })
  assert.deepEqual(records[1], {
    record_id: "PARAGRAPH_ch01_8",
    record_type: "paragraph",
    label: "Paragraph P8",
    source_paragraph_id: "ch01_8",
    entity_refs: ["OBJECT_WATCH"],
    evidence_refs: [],
    progress_start: 8,
    progress_end: 8,
  })
  assert.equal(JSON.stringify(records).includes("tea and cake"), false)
  assert.equal(JSON.stringify(records).includes("rabbit checked"), false)
})

test("paragraph descriptors include only PRE.2 story paragraphs and only EVID.4 clusters linked by PID", () => {
  const records = paragraphRecords()

  assert.deepEqual(records.map((record) => record.progress_start), [7, 8])
  assert.equal(records.some((record) => record.record_id === "PARAGRAPH_heading_0006"), false)
  assert.deepEqual(records[0]?.entity_refs, ["CAST_ALICE"])
  assert.deepEqual(records[1]?.entity_refs, ["OBJECT_WATCH"])
  assert.ok(records.every((record) => record.progress_start === record.progress_end))
  assert.ok(records.every((record) => record.evidence_refs.length === 0))
})

test("hydration restores exact PRE.1 text and sorts existing plus paragraph documents deterministically", () => {
  const records = paragraphRecords().reverse()
  const index = retrievalIndex({
    records,
    textDocuments: [
      {
        text_doc_id: "TEXT_SCENE_Z",
        doc_type: "scene",
        text: "Scene summary",
        scene_id: "SCENE_Z",
        evidence_refs: ["scene-evidence"],
      },
      {
        text_doc_id: "TEXT_EVENT_A",
        doc_type: "event",
        text: "Event summary",
        event_id: "EVENT_A",
        evidence_refs: ["event-evidence"],
      },
    ],
  })

  const documents = hydrateV3RetrievalDocuments({
    retrievalIndex: index,
    preparedChapter: paragraphFixture(),
  })

  assert.deepEqual(documents.map((document) => document.text_doc_id), [
    "TEXT_EVENT_A",
    "TEXT_PARAGRAPH_ch01_8",
    "TEXT_PARAGRAPH_para_0007",
    "TEXT_SCENE_Z",
  ])
  assert.deepEqual(
    documents.find((document) => document.text_doc_id === "TEXT_PARAGRAPH_para_0007"),
    {
      text_doc_id: "TEXT_PARAGRAPH_para_0007",
      doc_type: "paragraph",
      text: "Alice served tea and cake.",
      evidence_refs: [],
    },
  )
  assert.equal(
    documents.find((document) => document.text_doc_id === "TEXT_PARAGRAPH_ch01_8")?.text,
    "The rabbit checked a watch.",
  )
})

test("current paragraph hydration requires PRE.1", () => {
  const index = retrievalIndex({ records: paragraphRecords() })

  assert.throws(
    () => hydrateV3RetrievalDocuments({ retrievalIndex: index }),
    /IDX\.1.*0\.2.*PRE\.1/i,
  )
})

test("current paragraph hydration rejects a PRE.1 artifact for another chapter", () => {
  const index = retrievalIndex({ records: paragraphRecords() })
  const wrongChapter = preparedChapter(paragraphFixture().raw_chapter.paragraphs, "ch02")

  assert.throws(
    () => hydrateV3RetrievalDocuments({ retrievalIndex: index, preparedChapter: wrongChapter }),
    /PRE\.1.*chapter.*ch01.*ch02/i,
  )
})

test("current paragraph hydration rejects a missing canonical source paragraph", () => {
  const [record] = paragraphRecords()
  const index = retrievalIndex({ records: [record!] })
  const missingParagraph = preparedChapter([
    { pid: 8, start: 0, end: 9, text: "Different", paragraph_id: "para_0008" },
  ])

  assert.throws(
    () => hydrateV3RetrievalDocuments({ retrievalIndex: index, preparedChapter: missingParagraph }),
    /PARAGRAPH_para_0007.*para_0007.*not found/i,
  )
})

test("current paragraph hydration rejects duplicate PRE.1 canonical paragraph IDs", () => {
  const [record] = paragraphRecords()
  const index = retrievalIndex({ records: [record!] })
  const duplicateIds = preparedChapter([
    { pid: 7, start: 0, end: 5, text: "First", paragraph_id: "para_0007" },
    { pid: 8, start: 6, end: 12, text: "Second", paragraph_id: "para_0007" },
  ])

  assert.throws(
    () => hydrateV3RetrievalDocuments({ retrievalIndex: index, preparedChapter: duplicateIds }),
    /PRE\.1.*duplicate.*para_0007/i,
  )
})

test("current paragraph hydration rejects mismatched descriptor IDs", () => {
  const [record] = paragraphRecords()
  const mismatchedRecord = {
    ...record!,
    record_id: "PARAGRAPH_wrong_id",
  }
  const index = retrievalIndex({ records: [mismatchedRecord] })

  assert.throws(
    () => hydrateV3RetrievalDocuments({ retrievalIndex: index, preparedChapter: paragraphFixture() }),
    /PARAGRAPH_wrong_id.*source_paragraph_id.*para_0007/i,
  )
})

test("current paragraph hydration rejects a descriptor PID inconsistent with PRE.1", () => {
  const [record] = paragraphRecords()
  const inconsistentPid = {
    ...record!,
    progress_start: 8,
    progress_end: 8,
  }
  const index = retrievalIndex({ records: [inconsistentPid] })

  assert.throws(
    () => hydrateV3RetrievalDocuments({ retrievalIndex: index, preparedChapter: paragraphFixture() }),
    /PARAGRAPH_para_0007.*PID.*8.*7/i,
  )
})

test("legacy 0.1 indexes without paragraph descriptors remain usable without PRE.1", () => {
  const legacyDocument = {
    text_doc_id: "TEXT_EVENT_LEGACY",
    doc_type: "event" as const,
    text: "Legacy event summary",
    event_id: "EVENT_LEGACY",
    evidence_refs: ["legacy-evidence"],
  }
  const index = retrievalIndex({
    artifactVersion: V3_RETRIEVAL_INDEX_LEGACY_VERSION,
    records: [{
      record_id: "EVENT_LEGACY",
      record_type: "event",
      label: "Legacy event",
      event_id: "EVENT_LEGACY",
      evidence_refs: ["legacy-evidence"],
    }],
    textDocuments: [legacyDocument],
  })

  assert.deepEqual(hydrateV3RetrievalDocuments({ retrievalIndex: index }), [legacyDocument])
})
