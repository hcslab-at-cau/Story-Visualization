import type { RawChapter } from "@/types/schema"

const NON_STORY_CLASSIFICATIONS = new Set([
  "blank",
  "cover",
  "toc",
  "nav",
  "copyright",
  "front_matter",
  "back_matter",
  "publisher_note",
])

const NON_STORY_TITLE_RE = /\b(cover|title\s*page|copyright|contents|table\s+of\s+contents|toc|nav|navigation|colophon|imprint|acknowledg|dedication|pg[-_\s]*header|pg[-_\s]*footer|project\s+gutenberg|footer|header)\b/i
const KOREAN_NON_STORY_RE = /(목차|차례|라이선스|저작권|판권|이\s*저작물은)/

export function normalizeChapterTitle(value: string | undefined): string | undefined {
  if (!value) return undefined
  const withoutFragment = value.split("#")[0] ?? value
  const basename = withoutFragment.split(/[\\/]/).pop() ?? withoutFragment
  const withoutExtension = basename.replace(/\.(xhtml|html|htm)$/i, "")
  const normalized = withoutExtension
    .replace(/_+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return normalized.length > 0 ? normalized : undefined
}

export function isGenericChapterTitle(value: string | undefined): boolean {
  const normalized = normalizeChapterTitle(value)
  if (!normalized) return true
  const compact = normalized.toLowerCase().replace(/[\s._-]+/g, "")
  return (
    /^(item|id|xhtml|html|body|text|page|file|section)\d*$/.test(compact) ||
    /^(nav|toc|contents|cover|titlepage|pgheader|pgfooter)$/.test(compact) ||
    /^chapter\d+$/.test(compact)
  )
}

export function isChapterHeadingCandidate(value: string | undefined): boolean {
  const normalized = value?.replace(/\s+/g, " ").trim()
  if (!normalized || normalized.length > 140) return false
  if (NON_STORY_TITLE_RE.test(normalized)) return false

  return (
    /^chapter\s+([0-9]+|[ivxlcdm]+)\b/i.test(normalized) ||
    /^(book|part|volume)\s+([0-9]+|[ivxlcdm]+)\b/i.test(normalized) ||
    /^[0-9]+[.)]\s+\S+/.test(normalized) ||
    /^[IVXLCDM]+[.)]\s+\S+/.test(normalized) ||
    (normalized.length <= 80 &&
      normalized === normalized.toUpperCase() &&
      /[A-Z]/.test(normalized))
  )
}

function cleanCandidateTitle(value: string | undefined): string | undefined {
  const normalized = normalizeChapterTitle(value)
  if (!normalized || isGenericChapterTitle(normalized)) return undefined
  if (NON_STORY_TITLE_RE.test(normalized)) return undefined
  if (normalized.length > 140) return undefined
  return normalized
}

export function displayChapterTitle(
  raw: RawChapter | undefined,
  fallbackId: string,
  fallbackIndex?: number,
): string {
  const rawTitle = cleanCandidateTitle(raw?.title)
  if (rawTitle && /\s+\([0-9]+\)$/.test(rawTitle)) return rawTitle

  const source = raw?.source
  const sourceRecord = source as Record<string, unknown> | undefined
  const candidates = [
    typeof source?.toc_title === "string" ? source.toc_title : undefined,
    typeof sourceRecord?.heading_title === "string" ? sourceRecord.heading_title : undefined,
    raw?.title,
    ...(raw?.paragraphs.slice(0, 3).map((paragraph) => paragraph.text) ?? []),
  ]

  for (const candidate of candidates) {
    if (!candidate) continue
    if (raw?.paragraphs.some((paragraph) => paragraph.text === candidate) && !isChapterHeadingCandidate(candidate)) {
      continue
    }
    const clean = cleanCandidateTitle(candidate)
    if (clean) return clean
  }

  const idTitle = cleanCandidateTitle(fallbackId)
  if (idTitle) return idTitle
  return `Chapter ${fallbackIndex ?? 1}`
}

export function isLikelyNonStoryChapter(raw: RawChapter | undefined, chapterId?: string): boolean {
  if (!raw) return false

  const sourceRecord = raw.source as Record<string, unknown> | undefined
  const classification = typeof sourceRecord?.classification === "string"
    ? sourceRecord.classification
    : raw.source?.type
  if (classification && NON_STORY_CLASSIFICATIONS.has(classification)) return true

  const titleSignal = [
    chapterId,
    raw.title,
    raw.source?.toc_title,
    sourceRecord?.original_title,
    sourceRecord?.heading_title,
    sourceRecord?.manifest_id,
    ...(Array.isArray(raw.source?.hrefs) ? raw.source.hrefs : []),
  ]
    .filter((item): item is string => typeof item === "string")
    .join(" ")
  const titleLooksNonStory = NON_STORY_TITLE_RE.test(titleSignal)
  const titleLooksKoreanNonStory = KOREAN_NON_STORY_RE.test(titleSignal)
  const text = raw.text.replace(/\s+/g, " ").trim()
  const textLower = text.toLowerCase()
  const hasHeading = raw.paragraphs.slice(0, 3).some((paragraph) => isChapterHeadingCandidate(paragraph.text))

  if (/\bpg[-_\s]*(header|footer)\b/i.test(titleSignal)) return true
  if (titleLooksNonStory && text.length < 2500) return true
  if (titleLooksKoreanNonStory && text.length < 2500) return true
  if (/^(목차|차례)\b/.test(text) && text.length < 2500) return true
  if (/^(start|end) of (the )?project gutenberg/i.test(textLower)) return true
  if (textLower.includes("end of the project gutenberg")) return true
  if (text.length < 80 && !hasHeading) return true

  return false
}
