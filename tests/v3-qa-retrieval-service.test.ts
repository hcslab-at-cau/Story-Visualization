import assert from "node:assert/strict"
import test from "node:test"

import {
  loadValidatedV3SemanticVectorPayload,
  V3QAPrerequisiteError,
  resolveV3QARetrievalDocuments,
} from "../src/lib/server/v3-qa-retrieval-service.ts"
import {
  V3_RETRIEVAL_INDEX_LEGACY_VERSION,
  V3_RETRIEVAL_INDEX_VERSION,
  type V3RetrievalIndexArtifact,
} from "../src/lib/pipeline/v3-narrative-memory-types.ts"
import type {
  V3SemanticIndexArtifact,
  V3SemanticVectorPayload,
} from "../src/lib/pipeline/v3-semantic-index-types.ts"
import { V3SemanticVectorIntegrityError } from "../src/lib/storage.ts"
import type { PreparedChapter } from "../src/types/schema.ts"

function currentIndex(): V3RetrievalIndexArtifact {
  return {
    run_id: "idx1",
    doc_id: "doc",
    chapter_id: "ch01",
    stage_id: "IDX.1",
    method: "rule",
    parents: {},
    artifact_version: V3_RETRIEVAL_INDEX_VERSION,
    extraction_profile: "v3_retrieval_index",
    source_stage_ids: ["PRE.1", "PRE.2", "EVID.4", "MEM.1", "EVENT.2", "GOAL.1", "CAUS.1", "MEM.2"],
    index_stats: { structured_records: 1, graph_edges: 0, text_documents: 0 },
    structured_records: [{
      record_id: "PARAGRAPH_para_0002",
      record_type: "paragraph",
      label: "Paragraph P2",
      source_paragraph_id: "para_0002",
      evidence_refs: [],
      progress_start: 2,
      progress_end: 2,
    }],
    graph_edges: [],
    text_documents: [],
  }
}

function preparedChapter(): PreparedChapter {
  return {
    run_id: "pre1",
    doc_id: "doc",
    chapter_id: "ch01",
    stage_id: "PRE.1",
    method: "epub+rule",
    parents: {},
    chapter_title: "Chapter One",
    paragraph_count: 1,
    char_count: 38,
    raw_chapter: {
      doc_id: "doc",
      chapter_id: "ch01",
      title: "Chapter One",
      text: "Alice ate marmalade bread at supper.",
      paragraphs: [{
        pid: 2,
        start: 0,
        end: 38,
        text: "Alice ate marmalade bread at supper.",
        paragraph_id: "para_0002",
      }],
    },
  }
}

function semanticIndex(): V3SemanticIndexArtifact {
  return {
    run_id: "idx2",
    doc_id: "doc",
    chapter_id: "ch01",
    stage_id: "IDX.2",
    method: "embedding",
    parents: { "IDX.1": "idx1", "PRE.1": "pre1" },
    artifact_version: "v3-semantic-vector-index-0.2",
    extraction_profile: "v3_semantic_vector_index",
    source_stage_ids: ["IDX.1", "PRE.1"],
    embedding_provider: "openrouter",
    embedding_model: "openai/text-embedding-3-small",
    source_text_fingerprint: "fingerprint",
    vector_stats: { vectors: 1, dimensions: 2, prompt_tokens: 4 },
    vector_blob: {
      bucket: "bucket",
      storage_path: "documents_v3/doc/chapters/ch01/runs/run/indexes/idx2/hash.vectors.json.gz",
      gs_uri: "gs://bucket/documents_v3/doc/chapters/ch01/runs/run/indexes/idx2/hash.vectors.json.gz",
      file_name: "hash.vectors.json.gz",
      content_type: "application/gzip",
      size_bytes: 100,
      content_hash: "hash",
    },
  }
}

test("semantic blob download or integrity failures become rerunnable IDX.2 conflicts", async () => {
  await assert.rejects(
    () => loadValidatedV3SemanticVectorPayload({
      semanticIndex: semanticIndex(),
      downloadVectors: async () => {
        throw new V3SemanticVectorIntegrityError("IDX.2 vector blob content hash mismatch")
      },
    }),
    (error) => error instanceof V3QAPrerequisiteError
      && error.status === 409
      && /IDX\.2.*(?:rerun|rebuild)/i.test(error.message),
  )
})

test("semantic storage credential or runtime failures remain operational errors", async () => {
  const credentialError = new Error("Firebase credentials are unavailable")

  await assert.rejects(
    () => loadValidatedV3SemanticVectorPayload({
      semanticIndex: semanticIndex(),
      downloadVectors: async () => {
        throw credentialError
      },
    }),
    (error) => error === credentialError && !(error instanceof V3QAPrerequisiteError),
  )
})

test("semantic payload metadata or version failures become rerunnable IDX.2 conflicts", async () => {
  const invalidPayload = {
    artifact_version: "v3-semantic-vectors-9.9",
    model: "wrong-model",
    dimensions: 2,
    source_text_fingerprint: "fingerprint",
    vectors: [{ text_doc_id: "TEXT_EV1", embedding: [1, 0] }],
  } as unknown as V3SemanticVectorPayload

  await assert.rejects(
    () => loadValidatedV3SemanticVectorPayload({
      semanticIndex: semanticIndex(),
      downloadVectors: async () => invalidPayload,
    }),
    (error) => error instanceof V3QAPrerequisiteError
      && error.status === 409
      && /IDX\.2.*(?:rerun|rebuild)/i.test(error.message),
  )
})

test("0.2 retrieval service documents hydrate PRE.1 paragraph text", () => {
  const documents = resolveV3QARetrievalDocuments({
    retrievalIndex: currentIndex(),
    preparedChapter: preparedChapter(),
  })

  assert.deepEqual(documents.map((document) => document.text_doc_id), ["TEXT_PARAGRAPH_para_0002"])
  assert.equal(documents[0]?.text, "Alice ate marmalade bread at supper.")
})

test("0.2 retrieval service documents fail clearly when PRE.1 is missing", () => {
  assert.throws(
    () => resolveV3QARetrievalDocuments({ retrievalIndex: currentIndex() }),
    (error) => error instanceof V3QAPrerequisiteError && /PRE\.1/i.test(error.message),
  )
})

test("0.2 retrieval service documents wrap PRE.1 mismatches as prerequisite errors", () => {
  const wrongChapter = preparedChapter()
  wrongChapter.chapter_id = "ch02"
  wrongChapter.raw_chapter.chapter_id = "ch02"

  assert.throws(
    () => resolveV3QARetrievalDocuments({ retrievalIndex: currentIndex(), preparedChapter: wrongChapter }),
    (error) => error instanceof V3QAPrerequisiteError && /PRE\.1.*chapter mismatch/i.test(error.message),
  )
})

test("legacy 0.1 retrieval service documents remain usable without PRE.1", () => {
  const legacyDocument = {
    text_doc_id: "TEXT_EV_LEGACY",
    doc_type: "event" as const,
    text: "Legacy event summary",
    event_id: "EV_LEGACY",
    evidence_refs: ["legacy"],
  }
  const legacy: V3RetrievalIndexArtifact = {
    ...currentIndex(),
    artifact_version: V3_RETRIEVAL_INDEX_LEGACY_VERSION,
    source_stage_ids: ["MEM.1", "EVENT.2", "GOAL.1", "CAUS.1", "MEM.2"],
    index_stats: { structured_records: 1, graph_edges: 0, text_documents: 1 },
    structured_records: [{ record_id: "EV_LEGACY", record_type: "event", label: "Legacy event", event_id: "EV_LEGACY", evidence_refs: ["legacy"], progress_start: 1, progress_end: 1 }],
    text_documents: [legacyDocument],
  }

  assert.deepEqual(resolveV3QARetrievalDocuments({ retrievalIndex: legacy }), [legacyDocument])
})
