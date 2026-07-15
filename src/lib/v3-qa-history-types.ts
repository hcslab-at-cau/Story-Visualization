import type { V3QAGroundedAnswer } from "./pipeline/v3-qa-answer-types"
import type { V3QARetrievalResult } from "./pipeline/v3-qa-retrieval-types"

export const V3_QA_HISTORY_SCHEMA_VERSION = "v3-qa-history-0.1" as const
export const V3_QA_HISTORY_PAGE_SIZE = 20

export interface V3QAHistoryAnswerSnapshot {
  answer: V3QAGroundedAnswer
  retrieval: Pick<V3QARetrievalResult, "stats" | "hits">
}

export interface V3QAHistoryEntry {
  schema_version: typeof V3_QA_HISTORY_SCHEMA_VERSION
  entry_id: string
  doc_id: string
  chapter_id: string
  run_id: string
  question: string
  progress_end_pid: number
  answer_snapshot: V3QAHistoryAnswerSnapshot
  created_at: string
}

export interface V3QAHistoryPage {
  entries: V3QAHistoryEntry[]
  next_cursor: string | null
  has_more: boolean
}

export interface V3QAHistoryCreateRequest {
  source: string
  docId: string
  chapterId: string
  runId: string
  question: string
  progressEndPid: number
  answerSnapshot: V3QAHistoryAnswerSnapshot
}

export interface V3QAHistoryScopeRequest {
  source: string
  docId: string
  chapterId: string
  runId: string
  cursor?: string
}

export interface V3QAHistoryDeleteRequest extends V3QAHistoryScopeRequest {
  entryId: string
}

export function createV3QAHistoryAnswerSnapshot(
  result: { answer: V3QAGroundedAnswer; retrieval: V3QARetrievalResult },
): V3QAHistoryAnswerSnapshot {
  return {
    answer: result.answer,
    retrieval: {
      stats: result.retrieval.stats,
      hits: result.retrieval.hits,
    },
  }
}
