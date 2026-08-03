import type { ArtifactBase } from "@/types/schema"

export const V3_SEMANTIC_INDEX_STAGE_ID = "IDX.2" as const
export const V3_SEMANTIC_INDEX_PROFILE = "v3_semantic_vector_index" as const
export const V3_SEMANTIC_INDEX_LEGACY_VERSION = "v3-semantic-vector-index-0.1" as const
export const V3_SEMANTIC_INDEX_VERSION = "v3-semantic-vector-index-0.2" as const
export const V3_SEMANTIC_VECTOR_LEGACY_VERSION = "v3-semantic-vectors-0.1" as const
export const V3_SEMANTIC_VECTOR_VERSION = "v3-semantic-vectors-0.2" as const

export type V3SemanticIndexStageId = typeof V3_SEMANTIC_INDEX_STAGE_ID
export type V3SemanticIndexVersion =
  | typeof V3_SEMANTIC_INDEX_LEGACY_VERSION
  | typeof V3_SEMANTIC_INDEX_VERSION
export type V3SemanticVectorVersion =
  | typeof V3_SEMANTIC_VECTOR_LEGACY_VERSION
  | typeof V3_SEMANTIC_VECTOR_VERSION

export interface V3SemanticVectorRow {
  text_doc_id: string
  embedding: number[]
}

export interface V3SemanticVectorPayload {
  artifact_version: V3SemanticVectorVersion
  model: string
  dimensions: number
  source_text_fingerprint: string
  vectors: V3SemanticVectorRow[]
}

export interface V3SemanticVectorBlobRef {
  bucket: string
  storage_path: string
  gs_uri: string
  file_name: string
  content_type: "application/gzip"
  size_bytes: number
  content_hash: string
}

export interface V3SemanticIndexArtifact extends ArtifactBase {
  stage_id: V3SemanticIndexStageId
  method: "embedding"
  artifact_version: V3SemanticIndexVersion
  extraction_profile: typeof V3_SEMANTIC_INDEX_PROFILE
  source_stage_ids: ["IDX.1"] | ["IDX.1", "PRE.1"]
  embedding_provider: "openrouter"
  embedding_model: string
  source_text_fingerprint: string
  vector_stats: {
    vectors: number
    dimensions: number
    prompt_tokens: number
  }
  vector_blob: V3SemanticVectorBlobRef
}
