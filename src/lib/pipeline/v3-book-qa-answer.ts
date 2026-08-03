import { selectV3BookReadableChapters } from "./v3-book-qa-corpus"
import type { V3BookQARetrievalHit } from "./v3-book-qa-retrieval"
import type {
  V3BookQAAnswerChapterParagraphInput,
  V3BookQAAnswerContext,
  V3BookQAAnswerContextEvidence,
  V3BookQAAnswerContextParagraph,
  V3BookQAGroundedAnswer,
  V3BookQAParagraphRef,
} from "./v3-book-qa-answer-types"
import type { V3BookQACorpusManifest, V3BookReaderPosition } from "./v3-book-qa-types"

const DEFAULT_MAX_PARAGRAPH_CHARS = 12_000
const DEFAULT_MAX_EVIDENCE_CHARS = 1_200

export interface BuildV3BookQAAnswerContextParams {
  question: string
  manifest: V3BookQACorpusManifest
  readerPosition: V3BookReaderPosition
  chapterParagraphs: V3BookQAAnswerChapterParagraphInput[]
  hits: V3BookQARetrievalHit[]
  maxParagraphChars?: number
  maxEvidenceChars?: number
}

function compareText(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function tupleKey(chapterId: string, pid: number): string {
  return `${chapterId}\u0000${pid}`
}

function validatedBudget(value: number | undefined, fallback: number, label: string): number {
  const budget = value ?? fallback
  if (!Number.isSafeInteger(budget) || budget < 0) {
    throw new Error(`${label} must be a non-negative integer`)
  }
  return budget
}

function validSpan(hit: V3BookQARetrievalHit): { start: number; end: number } | null {
  const start = hit.text_span?.start_pid
  const end = hit.text_span?.end_pid
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    (start ?? -1) < 0 ||
    (end ?? -1) < (start ?? 0)
  ) return null
  if (hit.pid !== undefined && (start !== end || hit.pid !== start)) return null
  return { start: start as number, end: end as number }
}

function indexReadableParagraphs(params: {
  manifest: V3BookQACorpusManifest
  readerPosition: V3BookReaderPosition
  chapterParagraphs: V3BookQAAnswerChapterParagraphInput[]
}): {
  readableThroughByChapter: Map<string, number>
  readableMetadataByChapter: Map<string, { chapterTitle: string; chapterIndex: number }>
  chapterOrder: Map<string, number>
  paragraphByTuple: Map<string, V3BookQAAnswerContextParagraph>
} {
  const readable = selectV3BookReadableChapters(params.manifest, params.readerPosition)
  const readableThroughByChapter = new Map(
    readable.map((chapter) => [chapter.chapter_id, chapter.readable_through_pid]),
  )
  const readableById = new Map(readable.map((chapter) => [chapter.chapter_id, chapter]))
  const readableMetadataByChapter = new Map(readable.map((chapter) => [chapter.chapter_id, {
    chapterTitle: chapter.chapter_title,
    chapterIndex: chapter.chapter_index,
  }]))
  const chapterOrder = new Map(
    params.manifest.ordered_chapter_ids.map((chapterId, index) => [chapterId, index]),
  )
  const seenChapterInputs = new Set<string>()
  const paragraphByTuple = new Map<string, V3BookQAAnswerContextParagraph>()

  for (const chapter of params.chapterParagraphs) {
    const expected = readableById.get(chapter.chapter_id)
    if (!expected) continue
    if (seenChapterInputs.has(chapter.chapter_id)) {
      throw new Error(`Duplicate chapter paragraph input: ${chapter.chapter_id}`)
    }
    seenChapterInputs.add(chapter.chapter_id)
    if (chapter.chapter_title !== expected.chapter_title) {
      throw new Error(`Chapter title does not match BOOK.1: ${chapter.chapter_id}`)
    }
    for (const paragraph of chapter.paragraphs) {
      if (
        !Number.isSafeInteger(paragraph.pid) ||
        paragraph.pid < 0 ||
        typeof paragraph.text !== "string"
      ) {
        throw new Error(`Invalid source paragraph in ${chapter.chapter_id}`)
      }
      if (paragraph.pid > expected.readable_through_pid) continue
      const key = tupleKey(chapter.chapter_id, paragraph.pid)
      if (paragraphByTuple.has(key)) {
        throw new Error(`Duplicate source paragraph tuple: ${chapter.chapter_id}/P${paragraph.pid}`)
      }
      paragraphByTuple.set(key, {
        chapter_id: chapter.chapter_id,
        chapter_title: chapter.chapter_title,
        pid: paragraph.pid,
        text: paragraph.text,
      })
    }
  }
  return { readableThroughByChapter, readableMetadataByChapter, chapterOrder, paragraphByTuple }
}

function paragraphsForHit(
  hit: V3BookQARetrievalHit,
  paragraphByTuple: Map<string, V3BookQAAnswerContextParagraph>,
  readableThroughByChapter: Map<string, number>,
  readableMetadataByChapter: Map<string, { chapterTitle: string; chapterIndex: number }>,
): V3BookQAAnswerContextParagraph[] {
  const readableThrough = readableThroughByChapter.get(hit.chapter_id)
  const metadata = readableMetadataByChapter.get(hit.chapter_id)
  const span = validSpan(hit)
  if (
    readableThrough === undefined ||
    !metadata ||
    hit.chapter_title !== metadata.chapterTitle ||
    hit.chapter_index !== metadata.chapterIndex ||
    !span ||
    span.end > readableThrough ||
    hit.progress_status !== "available" ||
    !hit.record_id.startsWith(`${hit.chapter_id}:`)
  ) return []

  const paragraphs: V3BookQAAnswerContextParagraph[] = []
  for (let pid = span.start; pid <= span.end; pid += 1) {
    const paragraph = paragraphByTuple.get(tupleKey(hit.chapter_id, pid))
    if (paragraph) paragraphs.push(paragraph)
  }
  return paragraphs
}

function boundedWholeParagraphs(
  paragraphs: V3BookQAAnswerContextParagraph[],
  maxChars: number,
): V3BookQAAnswerContextParagraph[] {
  const selected: V3BookQAAnswerContextParagraph[] = []
  let usedChars = 0
  for (const paragraph of paragraphs) {
    const separatorChars = selected.length > 0 ? 1 : 0
    if (usedChars + separatorChars + paragraph.text.length > maxChars) continue
    selected.push(paragraph)
    usedChars += separatorChars + paragraph.text.length
  }
  return selected
}

export function buildV3BookQAAnswerContext({
  question,
  manifest,
  readerPosition,
  chapterParagraphs,
  hits,
  maxParagraphChars,
  maxEvidenceChars,
}: BuildV3BookQAAnswerContextParams): V3BookQAAnswerContext {
  const paragraphBudget = validatedBudget(
    maxParagraphChars,
    DEFAULT_MAX_PARAGRAPH_CHARS,
    "maxParagraphChars",
  )
  const evidenceBudget = validatedBudget(
    maxEvidenceChars,
    DEFAULT_MAX_EVIDENCE_CHARS,
    "maxEvidenceChars",
  )
  const indexed = indexReadableParagraphs({ manifest, readerPosition, chapterParagraphs })
  const selectedTupleKeys = new Set<string>()
  let selectedChars = 0

  for (const hit of hits) {
    for (const paragraph of paragraphsForHit(
      hit,
      indexed.paragraphByTuple,
      indexed.readableThroughByChapter,
      indexed.readableMetadataByChapter,
    )) {
      const key = tupleKey(paragraph.chapter_id, paragraph.pid)
      if (selectedTupleKeys.has(key)) continue
      if (selectedChars + paragraph.text.length > paragraphBudget) continue
      selectedTupleKeys.add(key)
      selectedChars += paragraph.text.length
    }
  }

  const paragraphs = [...selectedTupleKeys]
    .map((key) => indexed.paragraphByTuple.get(key)!)
    .sort((left, right) =>
      (indexed.chapterOrder.get(left.chapter_id) ?? Number.MAX_SAFE_INTEGER)
      - (indexed.chapterOrder.get(right.chapter_id) ?? Number.MAX_SAFE_INTEGER)
      || left.pid - right.pid
      || compareText(left.text, right.text))

  const evidence: V3BookQAAnswerContextEvidence[] = []
  for (const hit of hits) {
    const hitParagraphs = paragraphsForHit(
      hit,
      indexed.paragraphByTuple,
      indexed.readableThroughByChapter,
      indexed.readableMetadataByChapter,
    ).filter((paragraph) => selectedTupleKeys.has(tupleKey(paragraph.chapter_id, paragraph.pid)))
    const bounded = boundedWholeParagraphs(hitParagraphs, evidenceBudget)
    if (bounded.length === 0) continue
    evidence.push({
      evidence_id: `E${evidence.length + 1}`,
      record_id: hit.record_id,
      record_type: hit.record_type,
      label: hit.label,
      text: bounded.map((paragraph) => paragraph.text).join("\n"),
      paragraph_refs: bounded.map((paragraph) => ({
        chapter_id: paragraph.chapter_id,
        pid: paragraph.pid,
      })),
    })
  }

  return {
    question: question.trim(),
    reader_position: { ...readerPosition },
    paragraphs,
    evidence,
  }
}

export function insufficientV3BookQAGroundedAnswer(): V3BookQAGroundedAnswer {
  return { status: "insufficient_evidence", text: "", citations: [], used_evidence: [] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function parseCitationRef(value: unknown): V3BookQAParagraphRef | null {
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== "chapter_id,pid") return null
  if (
    typeof value.chapter_id !== "string" ||
    value.chapter_id.length === 0 ||
    !Number.isSafeInteger(value.pid) ||
    (value.pid as number) < 0
  ) return null
  return { chapter_id: value.chapter_id, pid: value.pid as number }
}

export function normalizeV3BookQAGroundedAnswer({
  raw,
  context,
}: {
  raw: unknown
  context: V3BookQAAnswerContext
}): V3BookQAGroundedAnswer {
  if (!isRecord(raw) || raw.status !== "answered") return insufficientV3BookQAGroundedAnswer()
  const text = typeof raw.answer === "string" ? raw.answer.trim() : ""
  if (!text || !Array.isArray(raw.citation_refs) || !Array.isArray(raw.used_evidence_ids)) {
    return insufficientV3BookQAGroundedAnswer()
  }

  const paragraphByTuple = new Map<string, V3BookQAAnswerContextParagraph>()
  for (const paragraph of context.paragraphs) {
    const key = tupleKey(paragraph.chapter_id, paragraph.pid)
    if (paragraphByTuple.has(key)) return insufficientV3BookQAGroundedAnswer()
    paragraphByTuple.set(key, paragraph)
  }
  const evidenceById = new Map<string, V3BookQAAnswerContextEvidence>()
  for (const evidence of context.evidence) {
    if (!evidence.evidence_id || evidenceById.has(evidence.evidence_id)) {
      return insufficientV3BookQAGroundedAnswer()
    }
    evidenceById.set(evidence.evidence_id, evidence)
  }

  const citationRefs: V3BookQAParagraphRef[] = []
  const seenCitationKeys = new Set<string>()
  for (const value of raw.citation_refs) {
    const parsed = parseCitationRef(value)
    if (!parsed) return insufficientV3BookQAGroundedAnswer()
    const key = tupleKey(parsed.chapter_id, parsed.pid)
    if (!paragraphByTuple.has(key)) return insufficientV3BookQAGroundedAnswer()
    if (seenCitationKeys.has(key)) continue
    seenCitationKeys.add(key)
    citationRefs.push(parsed)
  }

  const evidenceIds: string[] = []
  const seenEvidenceIds = new Set<string>()
  for (const value of raw.used_evidence_ids) {
    if (typeof value !== "string" || !evidenceById.has(value)) {
      return insufficientV3BookQAGroundedAnswer()
    }
    if (seenEvidenceIds.has(value)) continue
    seenEvidenceIds.add(value)
    evidenceIds.push(value)
  }
  if (citationRefs.length === 0 || evidenceIds.length === 0) {
    return insufficientV3BookQAGroundedAnswer()
  }

  const selectedEvidence = evidenceIds.map((evidenceId) => evidenceById.get(evidenceId)!)
  const citationKeys = new Set(citationRefs.map((ref) => tupleKey(ref.chapter_id, ref.pid)))
  const citationSupported = citationRefs.every((citation) => selectedEvidence.some((evidence) =>
    evidence.paragraph_refs.some((ref) =>
      ref.chapter_id === citation.chapter_id && ref.pid === citation.pid)))
  const evidenceSupportsCitation = selectedEvidence.every((evidence) =>
    evidence.paragraph_refs.some((ref) => citationKeys.has(tupleKey(ref.chapter_id, ref.pid))))
  if (!citationSupported || !evidenceSupportsCitation) {
    return insufficientV3BookQAGroundedAnswer()
  }

  return {
    status: "answered",
    text,
    citations: citationRefs.map((ref) => {
      const paragraph = paragraphByTuple.get(tupleKey(ref.chapter_id, ref.pid))!
      return {
        chapter_id: ref.chapter_id,
        chapter_title: paragraph.chapter_title,
        pid: ref.pid,
        paragraph_text: paragraph.text,
      }
    }),
    used_evidence: selectedEvidence.map((evidence) => ({
      evidence_id: evidence.evidence_id,
      record_id: evidence.record_id,
      record_type: evidence.record_type,
      label: evidence.label,
    })),
  }
}
