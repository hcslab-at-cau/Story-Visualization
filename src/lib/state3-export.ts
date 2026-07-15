import type {
  BoundaryCandidate,
  BoundaryLabel,
  BoundaryReasonTag,
  RawChapter,
  SceneBoundaries,
} from "@/types/schema"

export type State3BoundaryExportLabel = "BORDER" | "NOBORDER"
export type State3BoundaryExportType = BoundaryReasonTag | "START"
export type State3BoundaryExportRuleLabel = BoundaryLabel | "chapter_start" | null

export interface State3BoundaryExportSentence {
  id: number
  start: number
  end: number
  text: string
}

export interface State3BoundaryExportParagraph {
  id: number
  pid: number
  start: number
  end: number
  text: string
}

export interface State3SentenceBoundaryExport {
  doc_id: string
  text: string
  sentences: State3BoundaryExportSentence[]
  labels: State3BoundaryExportLabel[]
  boundary_types: State3BoundaryExportType[][]
  boundary_scores: Array<number | null>
  boundary_rule_labels: State3BoundaryExportRuleLabel[]
}

export interface State3ParagraphBoundaryExport {
  doc_id: string
  text: string
  paragraphs: State3BoundaryExportParagraph[]
  labels: State3BoundaryExportLabel[]
  boundary_types: State3BoundaryExportType[][]
  boundary_scores: Array<number | null>
  boundary_rule_labels: State3BoundaryExportRuleLabel[]
}

export type State3BoundaryExportUnit = "sentence" | "paragraph"

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

const BOUNDARY_REASON_TAG_ORDER: State3BoundaryExportType[] = [
  "START",
  "PLACE",
  "TIME",
  "CAST",
  "OTHER",
]

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

function safeFilenamePart(value: string | undefined, fallback: string): string {
  const normalized = (value ?? "")
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._\s]+|[._\s]+$/g, "")
  return normalized || fallback
}

function chapterFilenamePart(chapterId: string): string {
  const numericMatch = chapterId.match(/^(?:ch(?:apter)?[_-]?)?(\d+)$/i)
  if (numericMatch?.[1]) {
    return `ch${numericMatch[1].padStart(2, "0")}`
  }
  return safeFilenamePart(chapterId, "chapter")
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

function buildBoundaryByStartPid(boundaries: SceneBoundaries): Map<number, BoundaryCandidate> {
  return new Map(
    boundaries.boundaries.map((boundary) => [boundary.boundary_before_pid, boundary]),
  )
}

function uniqueOrderedBoundaryTypes(
  types: State3BoundaryExportType[],
): State3BoundaryExportType[] {
  const found = new Set(types)
  const ordered = BOUNDARY_REASON_TAG_ORDER.filter((type) => found.has(type))
  return ordered.length > 0 ? ordered : []
}

function deriveBoundaryReasonTags(boundary: BoundaryCandidate | undefined): BoundaryReasonTag[] {
  if (!boundary) return []
  if (boundary.llm_reason_tags && boundary.llm_reason_tags.length > 0) {
    return boundary.llm_reason_tags
  }

  const tags = boundary.reasons.map((reason): BoundaryReasonTag => {
    switch (reason.type) {
      case "place_shift":
      case "place_set_after_previous_place":
        return "PLACE"
      case "cast_turnover":
        return "CAST"
      case "time_signal":
        return "TIME"
      default:
        return "OTHER"
    }
  })

  return uniqueOrderedBoundaryTypes(tags) as BoundaryReasonTag[]
}

function getBoundaryExportInfo(params: {
  pid: number
  sceneStartPids: Set<number>
  firstSceneStartPid: number | undefined
  boundaryByStartPid: Map<number, BoundaryCandidate>
}): {
  label: State3BoundaryExportLabel
  types: State3BoundaryExportType[]
  score: number | null
  ruleLabel: State3BoundaryExportRuleLabel
} {
  const { pid, sceneStartPids, firstSceneStartPid, boundaryByStartPid } = params
  if (!sceneStartPids.has(pid)) {
    return {
      label: "NOBORDER",
      types: [],
      score: null,
      ruleLabel: null,
    }
  }

  if (pid === firstSceneStartPid) {
    return {
      label: "BORDER",
      types: ["START"],
      score: null,
      ruleLabel: "chapter_start",
    }
  }

  const boundary = boundaryByStartPid.get(pid)
  const reasonTags = deriveBoundaryReasonTags(boundary)
  return {
    label: "BORDER",
    types: uniqueOrderedBoundaryTypes(reasonTags.length > 0 ? reasonTags : ["OTHER"]),
    score: boundary?.score ?? null,
    ruleLabel: boundary?.label ?? null,
  }
}

export function buildState3SentenceBoundaryExport(
  chapter: RawChapter,
  boundaries: SceneBoundaries,
): State3SentenceBoundaryExport {
  const sceneStartPids = new Set(boundaries.scenes.map((scene) => scene.start_pid))
  const firstSceneStartPid = boundaries.scenes[0]?.start_pid
  const boundaryByStartPid = buildBoundaryByStartPid(boundaries)
  const sentences: State3BoundaryExportSentence[] = []
  const labels: State3BoundaryExportLabel[] = []
  const boundaryTypes: State3BoundaryExportType[][] = []
  const boundaryScores: Array<number | null> = []
  const boundaryRuleLabels: State3BoundaryExportRuleLabel[] = []
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
    const boundaryInfo = getBoundaryExportInfo({
      pid: paragraph.pid,
      sceneStartPids,
      firstSceneStartPid,
      boundaryByStartPid,
    })

    paragraphSentences.forEach((sentence, sentenceIndex) => {
      sentences.push({
        id: sentences.length,
        start: paragraphStart + sentence.index,
        end: paragraphStart + sentence.index + sentence.segment.length,
        text: sentence.segment,
      })
      const isBoundarySentence = sentenceIndex === 0 && boundaryInfo.label === "BORDER"
      labels.push(isBoundarySentence ? "BORDER" : "NOBORDER")
      boundaryTypes.push(isBoundarySentence ? boundaryInfo.types : [])
      boundaryScores.push(isBoundarySentence ? boundaryInfo.score : null)
      boundaryRuleLabels.push(isBoundarySentence ? boundaryInfo.ruleLabel : null)
    })

    searchFrom = paragraphStart + paragraph.text.length
  }

  return {
    doc_id: chapterExportDocId(chapter),
    text: chapter.text,
    sentences,
    labels,
    boundary_types: boundaryTypes,
    boundary_scores: boundaryScores,
    boundary_rule_labels: boundaryRuleLabels,
  }
}

export function buildState3ParagraphBoundaryExport(
  chapter: RawChapter,
  boundaries: SceneBoundaries,
): State3ParagraphBoundaryExport {
  const sceneStartPids = new Set(boundaries.scenes.map((scene) => scene.start_pid))
  const firstSceneStartPid = boundaries.scenes[0]?.start_pid
  const boundaryByStartPid = buildBoundaryByStartPid(boundaries)
  const paragraphs: State3BoundaryExportParagraph[] = []
  const labels: State3BoundaryExportLabel[] = []
  const boundaryTypes: State3BoundaryExportType[][] = []
  const boundaryScores: Array<number | null> = []
  const boundaryRuleLabels: State3BoundaryExportRuleLabel[] = []
  let searchFrom = 0

  for (const paragraph of chapter.paragraphs) {
    const paragraphStart = resolveParagraphStart(
      chapter.text,
      paragraph.text,
      paragraph.start,
      paragraph.end,
      searchFrom,
    )

    paragraphs.push({
      id: paragraphs.length,
      pid: paragraph.pid,
      start: paragraphStart,
      end: paragraphStart + paragraph.text.length,
      text: paragraph.text,
    })
    const boundaryInfo = getBoundaryExportInfo({
      pid: paragraph.pid,
      sceneStartPids,
      firstSceneStartPid,
      boundaryByStartPid,
    })
    labels.push(boundaryInfo.label)
    boundaryTypes.push(boundaryInfo.types)
    boundaryScores.push(boundaryInfo.score)
    boundaryRuleLabels.push(boundaryInfo.ruleLabel)

    searchFrom = paragraphStart + paragraph.text.length
  }

  return {
    doc_id: chapterExportDocId(chapter),
    text: chapter.text,
    paragraphs,
    labels,
    boundary_types: boundaryTypes,
    boundary_scores: boundaryScores,
    boundary_rule_labels: boundaryRuleLabels,
  }
}

export function buildState3BoundaryExport(
  chapter: RawChapter,
  boundaries: SceneBoundaries,
  unit: State3BoundaryExportUnit,
): State3SentenceBoundaryExport | State3ParagraphBoundaryExport {
  return unit === "paragraph"
    ? buildState3ParagraphBoundaryExport(chapter, boundaries)
    : buildState3SentenceBoundaryExport(chapter, boundaries)
}

export function state3BoundaryExportFilename(params: {
  workTitle?: string
  chapterId: string
  unit: State3BoundaryExportUnit
}): string {
  return `${safeFilenamePart(params.workTitle, "work")}_${params.unit}_${chapterFilenamePart(params.chapterId)}.json`
}
