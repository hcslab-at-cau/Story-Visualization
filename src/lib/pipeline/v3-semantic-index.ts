import { createHash } from "node:crypto"
import type { V3RetrievalTextDocument } from "./v3-narrative-memory-types"
import {
  V3_SEMANTIC_INDEX_PROFILE,
  V3_SEMANTIC_INDEX_STAGE_ID,
  V3_SEMANTIC_INDEX_VERSION,
  V3_SEMANTIC_VECTOR_LEGACY_VERSION,
  V3_SEMANTIC_VECTOR_VERSION,
  type V3SemanticIndexArtifact,
  type V3SemanticVectorPayload,
  type V3SemanticVectorVersion,
} from "./v3-semantic-index-types"

interface StoredVectorBlobInput {
  bucket: string
  storagePath: string
  gsUri: string
  fileName: string
  contentType: "application/gzip"
  sizeBytes: number
  contentHash: string
}

interface BuildV3SemanticIndexArtifactParams {
  docId: string
  chapterId: string
  parents?: Record<string, string>
  model: string
  dimensions: number
  vectorCount: number
  sourceTextFingerprint: string
  promptTokens: number
  blob: StoredVectorBlobInput
}

interface VectorPayloadExpectation {
  model: string
  dimensions: number
  vectorCount: number
  sourceTextFingerprint: string
}

export function retrievalRecordIdForTextDocument<T extends Pick<V3RetrievalTextDocument, "text_doc_id">>(document: T): string {
  return document.text_doc_id.replace(/^TEXT_/, "")
}

export function fingerprintRetrievalDocuments(documents: V3RetrievalTextDocument[]): string {
  const canonical = documents
    .map((document) => ({
      text_doc_id: document.text_doc_id,
      doc_type: document.doc_type,
      text: document.text,
      scene_id: document.scene_id ?? "",
      event_id: document.event_id ?? "",
    }))
    .sort((a, b) => a.text_doc_id.localeCompare(b.text_doc_id))
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex")
}

export function createV3SemanticVectorPayload(params: {
  model: string
  documents: V3RetrievalTextDocument[]
  embeddings: number[][]
}): V3SemanticVectorPayload {
  if (params.documents.length !== params.embeddings.length) {
    throw new Error(`Embedding count mismatch: expected ${params.documents.length}, received ${params.embeddings.length}`)
  }
  const dimensions = params.embeddings[0]?.length ?? 0
  if (dimensions < 1) throw new Error("Embedding vectors must have at least one dimension")
  if (params.embeddings.some((embedding) => embedding.length !== dimensions)) {
    throw new Error("Embedding vectors have inconsistent dimensions")
  }

  return {
    artifact_version: V3_SEMANTIC_VECTOR_VERSION,
    model: params.model,
    dimensions,
    source_text_fingerprint: fingerprintRetrievalDocuments(params.documents),
    vectors: params.documents.map((document, index) => ({
      text_doc_id: document.text_doc_id,
      embedding: params.embeddings[index],
    })),
  }
}

export function buildV3SemanticIndexArtifact({
  docId,
  chapterId,
  parents = {},
  model,
  dimensions,
  vectorCount,
  sourceTextFingerprint,
  promptTokens,
  blob,
}: BuildV3SemanticIndexArtifactParams): V3SemanticIndexArtifact {
  return {
    run_id: `v3_semantic_index__${docId}__${chapterId}`,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: V3_SEMANTIC_INDEX_STAGE_ID,
    method: "embedding",
    parents,
    artifact_version: V3_SEMANTIC_INDEX_VERSION,
    extraction_profile: V3_SEMANTIC_INDEX_PROFILE,
    source_stage_ids: ["IDX.1", "PRE.1"],
    embedding_provider: "openrouter",
    embedding_model: model,
    source_text_fingerprint: sourceTextFingerprint,
    vector_stats: {
      vectors: vectorCount,
      dimensions,
      prompt_tokens: promptTokens,
    },
    vector_blob: {
      bucket: blob.bucket,
      storage_path: blob.storagePath,
      gs_uri: blob.gsUri,
      file_name: blob.fileName,
      content_type: blob.contentType,
      size_bytes: blob.sizeBytes,
      content_hash: blob.contentHash,
    },
  }
}

export function validateV3SemanticVectorPayload(
  payload: V3SemanticVectorPayload,
  expected: VectorPayloadExpectation,
): void {
  const knownVersions = new Set<V3SemanticVectorVersion>([
    V3_SEMANTIC_VECTOR_LEGACY_VERSION,
    V3_SEMANTIC_VECTOR_VERSION,
  ])
  if (!knownVersions.has(payload.artifact_version)) {
    throw new Error(`Unsupported semantic vector version: ${payload.artifact_version}`)
  }
  if (payload.model !== expected.model) throw new Error("Semantic vector model does not match IDX.2 metadata")
  if (payload.dimensions !== expected.dimensions) throw new Error("Semantic vector dimensions do not match IDX.2 metadata")
  if (payload.vectors.length !== expected.vectorCount) throw new Error("Semantic vector count does not match IDX.2 metadata")
  if (payload.source_text_fingerprint !== expected.sourceTextFingerprint) {
    throw new Error("Semantic vector source fingerprint does not match IDX.2 metadata")
  }
  if (payload.vectors.some((row) => row.embedding.length !== payload.dimensions)) {
    throw new Error("Semantic vector row dimensions are inconsistent")
  }
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length) throw new Error("Embedding dimension mismatch")
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0
    const rightValue = right[index] ?? 0
    dot += leftValue * rightValue
    leftNorm += leftValue * leftValue
    rightNorm += rightValue * rightValue
  }
  if (leftNorm === 0 || rightNorm === 0) return 0
  return dot / Math.sqrt(leftNorm * rightNorm)
}

export function semanticScoresByRecordId(
  queryEmbedding: number[],
  payload: V3SemanticVectorPayload,
): Record<string, number> {
  if (queryEmbedding.length !== payload.dimensions) throw new Error("Query embedding dimension does not match IDX.2")
  return Object.fromEntries(payload.vectors.map((row) => [
    retrievalRecordIdForTextDocument({ text_doc_id: row.text_doc_id }),
    cosineSimilarity(queryEmbedding, row.embedding),
  ]))
}
