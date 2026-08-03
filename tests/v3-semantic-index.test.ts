import assert from "node:assert/strict"
import test from "node:test"
import {
  buildV3SemanticIndexArtifact,
  cosineSimilarity,
  createV3SemanticVectorPayload,
  fingerprintRetrievalDocuments,
  retrievalRecordIdForTextDocument,
  semanticScoresByRecordId,
  validateV3SemanticVectorPayload,
} from "../src/lib/pipeline/v3-semantic-index.ts"
import {
  V3_RETRIEVAL_INDEX_VERSION,
  type V3RetrievalIndexArtifact,
  type V3RetrievalTextDocument,
} from "../src/lib/pipeline/v3-narrative-memory-types.ts"
import { hydrateV3RetrievalDocuments } from "../src/lib/pipeline/v3-retrieval-documents.ts"
import {
  V3_SEMANTIC_INDEX_LEGACY_VERSION,
  V3_SEMANTIC_VECTOR_LEGACY_VERSION,
  type V3SemanticIndexArtifact,
  type V3SemanticVectorPayload,
} from "../src/lib/pipeline/v3-semantic-index-types.ts"
import type { PreparedChapter } from "../src/types/schema.ts"

const documents: V3RetrievalTextDocument[] = [
  {
    text_doc_id: "TEXT_EV1",
    doc_type: "event",
    text: "Alice found a brass key.",
    event_id: "EV1",
    scene_id: "SC1",
    evidence_refs: ["act-found"],
  },
  {
    text_doc_id: "TEXT_EV2",
    doc_type: "event",
    text: "Alice opened the small door.",
    event_id: "EV2",
    scene_id: "SC1",
    evidence_refs: ["act-opened"],
  },
]

test("IDX.2 fingerprints retrieval documents deterministically and detects text changes", () => {
  const original = fingerprintRetrievalDocuments(documents)
  const same = fingerprintRetrievalDocuments(documents.map((document) => ({ ...document })))
  const changed = fingerprintRetrievalDocuments([
    documents[0],
    { ...documents[1], text: "Alice could not open the small door." },
  ])

  assert.equal(original, same)
  assert.notEqual(original, changed)
})

test("IDX.2 fingerprints and embeds one deterministic combined summary and paragraph document list", () => {
  const retrievalIndex: V3RetrievalIndexArtifact = {
    run_id: "idx1",
    doc_id: "doc",
    chapter_id: "ch01",
    stage_id: "IDX.1",
    method: "rule",
    parents: {},
    artifact_version: V3_RETRIEVAL_INDEX_VERSION,
    extraction_profile: "v3_retrieval_index",
    source_stage_ids: ["PRE.1", "PRE.2", "EVID.4", "MEM.1", "EVENT.2", "GOAL.1", "CAUS.1", "MEM.2"],
    index_stats: { structured_records: 2, graph_edges: 0, text_documents: 1 },
    structured_records: [
      { record_id: "EV1", record_type: "event", label: "A summary", event_id: "EV1", evidence_refs: [], progress_start: 1, progress_end: 1 },
      { record_id: "PARAGRAPH_para_0002", record_type: "paragraph", label: "Paragraph P2", source_paragraph_id: "para_0002", evidence_refs: [], progress_start: 2, progress_end: 2 },
    ],
    graph_edges: [],
    text_documents: [{ text_doc_id: "TEXT_EV1", doc_type: "event", text: "A summary without supper details.", event_id: "EV1", evidence_refs: [] }],
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
    char_count: 50,
    raw_chapter: {
      doc_id: "doc",
      chapter_id: "ch01",
      title: "Chapter One",
      text: "Opening.\nAlice ate marmalade bread at supper.",
      paragraphs: [
        { pid: 1, start: 0, end: 8, text: "Opening.", paragraph_id: "para_0001" },
        { pid: 2, start: 9, end: 47, text: "Alice ate marmalade bread at supper.", paragraph_id: "para_0002" },
      ],
    },
  }

  const hydrated = hydrateV3RetrievalDocuments({ retrievalIndex, preparedChapter })
  const hydratedAgain = hydrateV3RetrievalDocuments({ retrievalIndex, preparedChapter })
  const payload = createV3SemanticVectorPayload({
    model: "openai/text-embedding-3-small",
    documents: hydrated,
    embeddings: [[1, 0], [0, 1]],
  })

  assert.deepEqual(hydrated.map((document) => document.text_doc_id), ["TEXT_EV1", "TEXT_PARAGRAPH_para_0002"])
  assert.equal(payload.artifact_version, "v3-semantic-vectors-0.2")
  assert.equal(payload.source_text_fingerprint, fingerprintRetrievalDocuments(hydratedAgain))
  assert.deepEqual(payload.vectors[1], { text_doc_id: "TEXT_PARAGRAPH_para_0002", embedding: [0, 1] })
})

test("IDX.2 validates vectors and maps text documents back to retrieval record ids", () => {
  const payload = {
    artifact_version: V3_SEMANTIC_VECTOR_LEGACY_VERSION,
    model: "openai/text-embedding-3-small",
    dimensions: 3,
    source_text_fingerprint: fingerprintRetrievalDocuments(documents),
    vectors: [
      { text_doc_id: "TEXT_EV1", embedding: [1, 0, 0] },
      { text_doc_id: "TEXT_EV2", embedding: [0, 1, 0] },
    ],
  }

  validateV3SemanticVectorPayload(payload, {
    model: payload.model,
    dimensions: 3,
    vectorCount: 2,
    sourceTextFingerprint: payload.source_text_fingerprint,
  })
  assert.deepEqual(semanticScoresByRecordId([0, 1, 0], payload), { EV1: 0, EV2: 1 })
  assert.throws(
    () => validateV3SemanticVectorPayload(payload, {
      model: payload.model,
      dimensions: 2,
      vectorCount: 2,
      sourceTextFingerprint: payload.source_text_fingerprint,
    }),
    /dimensions/i,
  )
})

test("IDX.2 record mapping strips TEXT_ for paragraph, goal, and causal documents", () => {
  assert.equal(retrievalRecordIdForTextDocument({ text_doc_id: "TEXT_PARAGRAPH_para_0002" }), "PARAGRAPH_para_0002")
  assert.equal(
    retrievalRecordIdForTextDocument({ text_doc_id: "TEXT_GOAL_G1", event_id: "EV1", scene_id: "SC1" }),
    "GOAL_G1",
  )
  assert.equal(
    retrievalRecordIdForTextDocument({ text_doc_id: "TEXT_CAUSAL_EDGE_C1", event_id: "EV2", scene_id: "SC1" }),
    "CAUSAL_EDGE_C1",
  )
})

test("IDX.2 accepts legacy 0.1 vector and index metadata and rejects unknown vector versions", () => {
  const legacyPayload: V3SemanticVectorPayload = {
    artifact_version: V3_SEMANTIC_VECTOR_LEGACY_VERSION,
    model: "legacy-model",
    dimensions: 2,
    source_text_fingerprint: "legacy-fingerprint",
    vectors: [{ text_doc_id: "TEXT_EV1", embedding: [1, 0] }],
  }
  const legacyIndex = {
    ...buildV3SemanticIndexArtifact({
      docId: "doc",
      chapterId: "ch01",
      model: "legacy-model",
      dimensions: 2,
      vectorCount: 1,
      sourceTextFingerprint: "legacy-fingerprint",
      promptTokens: 0,
      blob: {
        bucket: "bucket",
        storagePath: "legacy/vectors.json.gz",
        gsUri: "gs://bucket/legacy/vectors.json.gz",
        fileName: "vectors.json.gz",
        contentType: "application/gzip",
        sizeBytes: 100,
        contentHash: "legacy-hash",
      },
    }),
    artifact_version: V3_SEMANTIC_INDEX_LEGACY_VERSION,
    source_stage_ids: ["IDX.1"],
  } satisfies V3SemanticIndexArtifact
  const expected = {
    model: legacyIndex.embedding_model,
    dimensions: legacyIndex.vector_stats.dimensions,
    vectorCount: legacyIndex.vector_stats.vectors,
    sourceTextFingerprint: legacyIndex.source_text_fingerprint,
  }

  assert.equal(legacyIndex.artifact_version, "v3-semantic-vector-index-0.1")
  assert.deepEqual(legacyIndex.source_stage_ids, ["IDX.1"])
  assert.doesNotThrow(() => validateV3SemanticVectorPayload(legacyPayload, expected))
  assert.throws(
    () => validateV3SemanticVectorPayload(
      { ...legacyPayload, artifact_version: "v3-semantic-vectors-9.9" } as unknown as V3SemanticVectorPayload,
      expected,
    ),
    /unsupported semantic vector version/i,
  )
})

test("IDX.2 builds compact Firestore metadata without embedding arrays", () => {
  const artifact = buildV3SemanticIndexArtifact({
    docId: "doc",
    chapterId: "ch01",
    parents: { "IDX.1": "idx1-artifact" },
    model: "openai/text-embedding-3-small",
    dimensions: 3,
    vectorCount: 2,
    sourceTextFingerprint: fingerprintRetrievalDocuments(documents),
    promptTokens: 12,
    blob: {
      bucket: "bucket",
      storagePath: "documents_v3/doc/chapters/ch01/runs/run/indexes/idx2/vectors.json.gz",
      gsUri: "gs://bucket/documents_v3/doc/chapters/ch01/runs/run/indexes/idx2/vectors.json.gz",
      fileName: "vectors.json.gz",
      contentType: "application/gzip",
      sizeBytes: 120,
      contentHash: "abc123",
    },
  })

  assert.equal(artifact.stage_id, "IDX.2")
  assert.equal(artifact.artifact_version, "v3-semantic-vector-index-0.2")
  assert.deepEqual(artifact.source_stage_ids, ["IDX.1", "PRE.1"])
  assert.equal(artifact.vector_stats.vectors, 2)
  assert.equal(artifact.vector_blob.content_hash, "abc123")
  assert.equal(JSON.stringify(artifact).includes("[1,0,0]"), false)
})

test("cosine similarity rejects dimension mismatches and handles zero vectors", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1)
  assert.equal(cosineSimilarity([0, 0], [1, 0]), 0)
  assert.throws(() => cosineSimilarity([1], [1, 0]), /dimension/i)
})
