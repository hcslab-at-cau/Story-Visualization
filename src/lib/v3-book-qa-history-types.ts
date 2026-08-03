import type { V3BookQAAnswerResult, V3BookQAGroundedAnswer } from "./pipeline/v3-book-qa-answer-types"
import type { V3BookQARetrievalResult } from "./pipeline/v3-book-qa-retrieval"
import type { V3BookReaderPosition } from "./pipeline/v3-book-qa-types"

export const V3_BOOK_QA_HISTORY_SCHEMA_VERSION = "v3-book-qa-history-0.2" as const
export const V3_BOOK_QA_HISTORY_PAGE_SIZE = 20

export interface V3BookQAHistoryAnswerSnapshot {
  answer: V3BookQAGroundedAnswer
  retrieval: Pick<V3BookQARetrievalResult, "stats" | "hits">
}

export interface V3BookQAHistoryEntry {
  schema_version: typeof V3_BOOK_QA_HISTORY_SCHEMA_VERSION
  entry_id: string
  doc_id: string
  qa_corpus_id: string
  question: string
  reader_position: V3BookReaderPosition
  answer_snapshot: V3BookQAHistoryAnswerSnapshot
  created_at: string
}

export interface V3BookQAHistoryPage {
  entries: V3BookQAHistoryEntry[]
  next_cursor: string | null
  has_more: boolean
}

export interface V3BookQAHistoryCreateRequest {
  source: string
  docId: string
  qaCorpusId: string
  question: string
  readerPosition: V3BookReaderPosition
  answerSnapshot: V3BookQAHistoryAnswerSnapshot
}

export interface V3BookQAHistoryScopeRequest {
  source: string
  docId: string
  qaCorpusId: string
  cursor?: string
}

export interface V3BookQAHistoryDeleteRequest extends V3BookQAHistoryScopeRequest {
  entryId: string
}

export function createV3BookQAHistoryAnswerSnapshot(
  result: V3BookQAAnswerResult,
): V3BookQAHistoryAnswerSnapshot {
  return {
    answer: result.answer,
    retrieval: {
      stats: result.retrieval.stats,
      hits: result.retrieval.hits,
    },
  }
}
