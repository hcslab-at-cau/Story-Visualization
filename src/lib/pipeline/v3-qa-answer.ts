import type { V3QARetrievalHit } from "./v3-qa-retrieval-types"
import type {
  V3QAAnswerContext,
  V3QAAnswerContextEvidence,
  V3QAGroundedAnswer,
} from "./v3-qa-answer-types"

const DEFAULT_MAX_PARAGRAPH_CHARS = 12_000
const DEFAULT_MAX_EVIDENCE_CHARS = 1_200

interface SourceParagraph {
  pid: number
  text: string
}

interface BuildV3QAAnswerContextParams {
  question: string
  progressEndPid: number
  paragraphs: SourceParagraph[]
  hits: V3QARetrievalHit[]
  maxParagraphChars?: number
  maxEvidenceChars?: number
}

function uniqueIntegers(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  const result: number[] = []
  const seen = new Set<number>()
  for (const item of value) {
    if (!Number.isInteger(item) || seen.has(item as number)) continue
    seen.add(item as number)
    result.push(item as number)
  }
  return result
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const result: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== "string" || seen.has(item)) continue
    seen.add(item)
    result.push(item)
  }
  return result
}

export function filterV3QAProgressSafeHits(
  hits: V3QARetrievalHit[],
  progressEndPid: number,
): V3QARetrievalHit[] {
  return hits.filter((hit) => {
    const span = hit.text_span
    return Boolean(
      span
      && Number.isInteger(span.start_pid)
      && Number.isInteger(span.end_pid)
      && span.start_pid >= 0
      && span.end_pid >= span.start_pid
      && span.end_pid <= progressEndPid,
    )
  })
}

export function buildV3QAAnswerContext({
  question,
  progressEndPid,
  paragraphs,
  hits,
  maxParagraphChars = DEFAULT_MAX_PARAGRAPH_CHARS,
  maxEvidenceChars = DEFAULT_MAX_EVIDENCE_CHARS,
}: BuildV3QAAnswerContextParams): V3QAAnswerContext {
  const readableParagraphs = paragraphs
    .filter((paragraph) => paragraph.pid <= progressEndPid)
    .sort((a, b) => a.pid - b.pid)
  const selectedPids = new Set<number>()
  let selectedChars = 0

  for (const hit of hits) {
    if (!hit.text_span) continue
    const endPid = Math.min(hit.text_span.end_pid, progressEndPid)
    for (const paragraph of readableParagraphs) {
      if (paragraph.pid < hit.text_span.start_pid || paragraph.pid > endPid || selectedPids.has(paragraph.pid)) continue
      const exceedsBudget = selectedChars > 0 && selectedChars + paragraph.text.length > maxParagraphChars
      if (exceedsBudget) continue
      selectedPids.add(paragraph.pid)
      selectedChars += paragraph.text.length
    }
  }

  const selectedParagraphs = readableParagraphs.filter((paragraph) => selectedPids.has(paragraph.pid))
  const evidence: V3QAAnswerContextEvidence[] = []
  for (const hit of hits) {
    if (!hit.text_span) continue
    const evidenceParagraphs = selectedParagraphs
      .filter((paragraph) => paragraph.pid >= hit.text_span!.start_pid && paragraph.pid <= hit.text_span!.end_pid)
    const paragraphPids = evidenceParagraphs.map((paragraph) => paragraph.pid)
    if (paragraphPids.length === 0) continue
    const crossesProgressBoundary = hit.text_span.end_pid > progressEndPid
    evidence.push({
      evidence_id: `E${evidence.length + 1}`,
      record_id: hit.record_id,
      record_type: hit.record_type,
      label: crossesProgressBoundary ? `${hit.record_type} evidence` : hit.label,
      text: evidenceParagraphs.map((paragraph) => paragraph.text).join("\n").slice(0, maxEvidenceChars),
      paragraph_pids: paragraphPids,
    })
  }

  return {
    question,
    progress_end_pid: progressEndPid,
    paragraphs: selectedParagraphs,
    evidence,
  }
}

export function normalizeV3QAGroundedAnswer({
  raw,
  context,
}: {
  raw: Record<string, unknown>
  context: V3QAAnswerContext
}): V3QAGroundedAnswer {
  const requestedStatus = raw.status === "answered" ? "answered" : "insufficient_evidence"
  const text = typeof raw.answer === "string" ? raw.answer.trim() : ""
  if (requestedStatus === "insufficient_evidence") {
    return { status: "insufficient_evidence", text: "", citations: [], used_evidence: [] }
  }

  const paragraphByPid = new Map(context.paragraphs.map((paragraph) => [paragraph.pid, paragraph]))
  const evidenceById = new Map(context.evidence.map((evidence) => [evidence.evidence_id, evidence]))
  if (!Array.isArray(raw.citation_pids) || !Array.isArray(raw.used_evidence_ids)) {
    return { status: "insufficient_evidence", text: "", citations: [], used_evidence: [] }
  }
  if (!raw.citation_pids.every((pid) => Number.isInteger(pid) && paragraphByPid.has(pid as number))) {
    return { status: "insufficient_evidence", text: "", citations: [], used_evidence: [] }
  }
  if (!raw.used_evidence_ids.every((evidenceId) => typeof evidenceId === "string" && evidenceById.has(evidenceId))) {
    return { status: "insufficient_evidence", text: "", citations: [], used_evidence: [] }
  }

  const requestedCitations = uniqueIntegers(raw.citation_pids)
    .map((pid) => paragraphByPid.get(pid)!)
  const requestedEvidence = uniqueStrings(raw.used_evidence_ids)
    .map((evidenceId) => evidenceById.get(evidenceId)!)
  const requestedCitationPids = new Set(requestedCitations.map((paragraph) => paragraph.pid))
  const everyCitationIsSupported = requestedCitations.every((paragraph) =>
    requestedEvidence.some((evidence) => evidence.paragraph_pids.includes(paragraph.pid)))
  const everyEvidenceSupportsACitation = requestedEvidence.every((evidence) =>
    evidence.paragraph_pids.some((pid) => requestedCitationPids.has(pid)))
  if (!everyCitationIsSupported || !everyEvidenceSupportsACitation) {
    return { status: "insufficient_evidence", text: "", citations: [], used_evidence: [] }
  }

  const citations = requestedCitations
    .map((paragraph) => ({ pid: paragraph.pid, paragraph_text: paragraph.text }))
  const usedEvidence = requestedEvidence
    .map((evidence) => ({
      evidence_id: evidence.evidence_id,
      record_id: evidence.record_id,
      record_type: evidence.record_type,
      label: evidence.label,
    }))

  if (!text || citations.length === 0 || usedEvidence.length === 0) {
    return { status: "insufficient_evidence", text: "", citations: [], used_evidence: [] }
  }

  return {
    status: "answered",
    text,
    citations,
    used_evidence: usedEvidence,
  }
}
