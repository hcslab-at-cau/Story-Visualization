import type { RawChapter, SceneBoundaries } from "@/types/schema"

export type State3BoundaryExportLabel = "BORDER" | "NOBORDER"

export interface State3BoundaryExportSentence {
  id: number
  start: number
  end: number
  text: string
}

export interface State3BoundaryExport {
  doc_id: string
  text: string
  sentences: State3BoundaryExportSentence[]
  labels: State3BoundaryExportLabel[]
}

interface SentenceSegment {
  index: number
  segment: string
}

type SentenceSegmenter = {
  segment(input: string): Iterable<SentenceSegment>
}

type IntlWithSentenceSegmenter = typeof Intl & {
  Segmenter?: new (
    locale?: string,
    options?: { granularity: "sentence" },
  ) => SentenceSegmenter
}

const SENTENCE_END_CHARS = new Set([
  ".",
  "!",
  "?",
  "\u3002",
  "\uff01",
  "\uff1f",
  "\u2026",
])

const SENTENCE_CLOSING_CHARS = new Set([
  "\"",
  "'",
  ")",
  "]",
  "}",
  "\u201d",
  "\u2019",
  "\u300d",
  "\u300f",
])

function chapterExportDocId(chapter: RawChapter): string {
  return [chapter.doc_id, chapter.chapter_id].filter(Boolean).join("_")
}

function trimSegment(segment: SentenceSegment): SentenceSegment | null {
  const leading = segment.segment.match(/^\s*/)?.[0].length ?? 0
  const trailing = segment.segment.match(/\s*$/)?.[0].length ?? 0
  const text = segment.segment.slice(leading, segment.segment.length - trailing)
  if (!text) return null
  return {
    index: segment.index + leading,
    segment: text,
  }
}

function splitSentencesWithIntl(text: string): SentenceSegment[] | null {
  const Segmenter = (Intl as IntlWithSentenceSegmenter).Segmenter
  if (!Segmenter) return null

  const segmenter = new Segmenter(undefined, { granularity: "sentence" })
  return Array.from(segmenter.segment(text), trimSegment).filter(
    (segment): segment is SentenceSegment => segment !== null,
  )
}

function splitSentencesWithFallback(text: string): SentenceSegment[] {
  const sentences: SentenceSegment[] = []
  let start = 0

  for (let i = 0; i < text.length; i++) {
    if (!SENTENCE_END_CHARS.has(text[i])) continue

    let end = i + 1
    while (end < text.length && SENTENCE_CLOSING_CHARS.has(text[end])) {
      end += 1
    }

    if (end < text.length && !/\s/.test(text[end])) continue

    const trimmed = trimSegment({
      index: start,
      segment: text.slice(start, end),
    })
    if (trimmed) sentences.push(trimmed)

    start = end
    while (start < text.length && /\s/.test(text[start])) {
      start += 1
    }
    i = start - 1
  }

  if (start < text.length) {
    const trimmed = trimSegment({
      index: start,
      segment: text.slice(start),
    })
    if (trimmed) sentences.push(trimmed)
  }

  return sentences
}

export function splitParagraphSentences(text: string): SentenceSegment[] {
  return splitSentencesWithIntl(text) ?? splitSentencesWithFallback(text)
}

function resolveParagraphStart(
  chapterText: string,
  paragraphText: string,
  declaredStart: number,
  declaredEnd: number,
  searchFrom: number,
): number {
  if (
    Number.isFinite(declaredStart) &&
    Number.isFinite(declaredEnd) &&
    declaredStart >= 0 &&
    declaredEnd <= chapterText.length &&
    declaredEnd >= declaredStart &&
    chapterText.slice(declaredStart, declaredEnd) === paragraphText
  ) {
    return declaredStart
  }

  const found = chapterText.indexOf(paragraphText, searchFrom)
  if (found >= 0) return found

  return Math.max(0, Math.min(chapterText.length, searchFrom))
}

export function buildState3BoundaryExport(
  chapter: RawChapter,
  boundaries: SceneBoundaries,
): State3BoundaryExport {
  const sceneStartPids = new Set(boundaries.scenes.map((scene) => scene.start_pid))
  const sentences: State3BoundaryExportSentence[] = []
  const labels: State3BoundaryExportLabel[] = []
  let searchFrom = 0

  for (const paragraph of chapter.paragraphs) {
    const paragraphStart = resolveParagraphStart(
      chapter.text,
      paragraph.text,
      paragraph.start,
      paragraph.end,
      searchFrom,
    )
    const paragraphSentences = splitParagraphSentences(paragraph.text)

    paragraphSentences.forEach((sentence, sentenceIndex) => {
      sentences.push({
        id: sentences.length,
        start: paragraphStart + sentence.index,
        end: paragraphStart + sentence.index + sentence.segment.length,
        text: sentence.segment,
      })
      labels.push(
        sentenceIndex === 0 && sceneStartPids.has(paragraph.pid)
          ? "BORDER"
          : "NOBORDER",
      )
    })

    searchFrom = paragraphStart + paragraph.text.length
  }

  return {
    doc_id: chapterExportDocId(chapter),
    text: chapter.text,
    sentences,
    labels,
  }
}

export function state3BoundaryExportFilename(exportDocId: string): string {
  return `${exportDocId.replace(/[^a-zA-Z0-9._-]+/g, "_")}_state3.json`
}
