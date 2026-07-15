import type { V3RetrievalRecordType } from "./v3-narrative-memory-types"
import type { V3QARetrievalResult } from "./v3-qa-retrieval-types"

export type V3QAAnswerStatus = "answered" | "insufficient_evidence"

export interface V3QAAnswerContextParagraph {
  pid: number
  text: string
}
export interface V3QAAnswerContextEvidence {
  evidence_id: string
  record_id: string
  record_type: V3RetrievalRecordType
  label: string
  text: string
  paragraph_pids: number[]
}

export interface V3QAAnswerContext {
  question: string
  progress_end_pid: number
  paragraphs: V3QAAnswerContextParagraph[]
  evidence: V3QAAnswerContextEvidence[]
}

export interface V3QAAnswerCitation {
  pid: number
  paragraph_text: string
}

export interface V3QAUsedEvidence {
  evidence_id: string
  record_id: string
  record_type: V3RetrievalRecordType
  label: string
}

export interface V3QAGroundedAnswer {
  status: V3QAAnswerStatus
  text: string
  citations: V3QAAnswerCitation[]
  used_evidence: V3QAUsedEvidence[]
}

export interface V3QAAnswerResult {
  retrieval: V3QARetrievalResult
  answer: V3QAGroundedAnswer
}
