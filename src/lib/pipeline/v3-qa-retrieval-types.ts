import type { V3MemoryTextSpan } from "./v3-memory-contract-types"
import type { V3RetrievalGraphEdge, V3RetrievalRecordType } from "./v3-narrative-memory-types"

export const V3_QA_RETRIEVAL_PROFILE = "v3_qa_retrieval" as const
export const V3_QA_RETRIEVAL_VERSION = "v3-qa-retrieval-0.1" as const

export type V3QARetrievalMode = "hybrid" | "lexical_fallback"
export type V3QAMatchKind = "hybrid" | "semantic" | "lexical" | "graph_neighbor"
export type V3QAProgressStatus = "available" | "blocked_ahead" | "unknown"

export interface V3QARetrievalHit {
  record_id: string
  record_type: V3RetrievalRecordType
  label: string
  text: string
  score: number
  match_kind: V3QAMatchKind
  scene_id?: string
  event_id?: string
  text_span?: V3MemoryTextSpan
  progress_status: V3QAProgressStatus
  evidence_refs: string[]
  matched_terms: string[]
  semantic_similarity?: number
}

export interface V3QARetrievalResult {
  artifact_version: typeof V3_QA_RETRIEVAL_VERSION
  extraction_profile: typeof V3_QA_RETRIEVAL_PROFILE
  retrieval_mode: V3QARetrievalMode
  query: {
    question: string
    normalized_terms: string[]
    progress_end_pid: number
  }
  stats: {
    total_records: number
    searched_records: number
    blocked_ahead_records: number
    direct_hits: number
    lexical_hits: number
    semantic_hits: number
    graph_neighbor_hits: number
    returned_hits: number
  }
  hits: V3QARetrievalHit[]
  graph_edges: V3RetrievalGraphEdge[]
}
