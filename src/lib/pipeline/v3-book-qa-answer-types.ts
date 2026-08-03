import type { V3BookQARetrievalResult } from "./v3-book-qa-retrieval"
import type { V3BookReaderPosition } from "./v3-book-qa-types"
import type { V3RetrievalRecordType } from "./v3-narrative-memory-types"

export type V3BookQAAnswerStatus = "answered" | "insufficient_evidence"

export interface V3BookQAParagraphRef {
  chapter_id: string
  pid: number
}

export interface V3BookQAAnswerContextParagraph extends V3BookQAParagraphRef {
  chapter_title: string
  text: string
}

export interface V3BookQAAnswerContextEvidence {
  evidence_id: string
  record_id: string
  record_type: V3RetrievalRecordType
  label: string
  text: string
  paragraph_refs: V3BookQAParagraphRef[]
}

export interface V3BookQAAnswerContext {
  question: string
  reader_position: V3BookReaderPosition
  paragraphs: V3BookQAAnswerContextParagraph[]
  evidence: V3BookQAAnswerContextEvidence[]
}

export interface V3BookQAAnswerChapterParagraphInput {
  chapter_id: string
  chapter_title: string
  paragraphs: Array<{ pid: number; text: string }>
}

export interface V3BookQAAnswerCitation extends V3BookQAParagraphRef {
  chapter_title: string
  paragraph_text: string
}

export interface V3BookQAUsedEvidence {
  evidence_id: string
  record_id: string
  record_type: V3RetrievalRecordType
  label: string
}

export interface V3BookQAGroundedAnswer {
  status: V3BookQAAnswerStatus
  text: string
  citations: V3BookQAAnswerCitation[]
  used_evidence: V3BookQAUsedEvidence[]
}

export interface V3BookQAAnswerResult {
  retrieval: V3BookQARetrievalResult
  answer: V3BookQAGroundedAnswer
}
