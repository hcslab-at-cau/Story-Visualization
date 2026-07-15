import assert from "node:assert/strict"
import test from "node:test"
import {
  buildV3SemanticIndexArtifact,
  cosineSimilarity,
  fingerprintRetrievalDocuments,
  semanticScoresByRecordId,
  validateV3SemanticVectorPayload,
} from "../src/lib/pipeline/v3-semantic-index.ts"
import type { V3RetrievalTextDocument } from "../src/lib/pipeline/v3-narrative-memory-types.ts"

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

test("IDX.2 validates vectors and maps text documents back to retrieval record ids", () => {
  const payload = {
    artifact_version: "v3-semantic-vectors-0.1" as const,
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
  assert.equal(artifact.vector_stats.vectors, 2)
  assert.equal(artifact.vector_blob.content_hash, "abc123")
  assert.equal(JSON.stringify(artifact).includes("[1,0,0]"), false)
})

test("cosine similarity rejects dimension mismatches and handles zero vectors", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1)
  assert.equal(cosineSimilarity([0, 0], [1, 0]), 0)
  assert.throws(() => cosineSimilarity([1], [1, 0]), /dimension/i)
})
