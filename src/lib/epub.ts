/**
 * EPUB Parser — converts EPUB file Buffer → RawChapter[].
 * Port of Story-Decomposition/src/viewer/epub.py
 *
 * Uses: epub2 (EPub), cheerio (BeautifulSoup equivalent)
 */

import { EPub } from "epub2"
import * as cheerio from "cheerio"
import {
  displayChapterTitle,
  isChapterHeadingCandidate,
  isGenericChapterTitle,
  normalizeChapterTitle,
} from "@/lib/chapter-normalization"
import type { RawChapter, Paragraph, ChapterSource } from "@/types/schema"

const BLOCK_TAGS = [
  "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "li", "blockquote", "pre", "figcaption",
]
const BLOCK_SEL = BLOCK_TAGS.join(",")

// ---------------------------------------------------------------------------
// HTML → paragraph strings
// ---------------------------------------------------------------------------

function htmlToParagraphs(html: string): string[] {
  const $ = cheerio.load(html)
  $("script, style, nav, head").remove()

  const paragraphs: string[] = []

  // Pass 1: leaf block elements (no nested block children)
  $(BLOCK_SEL).each((_, el) => {
    if ($(el).find(BLOCK_SEL).length > 0) return // container, skip
    const text = $(el).text().replace(/\s+/g, " ").trim()
    if (text.length > 1) paragraphs.push(text)
  })

  if (paragraphs.length > 0) return paragraphs

  // Pass 2: leaf <div> elements
  $("div").each((_, el) => {
    if ($(el).find("div").length > 0) return
    const text = $(el).text().replace(/\s+/g, " ").trim()
    if (text.length > 1) paragraphs.push(text)
  })

  if (paragraphs.length > 0) return paragraphs

  // Pass 3: split on line breaks (last resort)
  const body = $.root().text()
  return body.split(/\n+/).map((l) => l.trim()).filter((l) => l.length > 1)
}

// ---------------------------------------------------------------------------
// Internal candidate type
// ---------------------------------------------------------------------------

interface RawChapterCandidate {
  title: string
  paragraphs: string[]
  textLength: number
  sourceType: string
  hrefs: string[]
  sourceUnitIds: string[]
  manifestId?: string
  originalTitle?: string
  tocTitle?: string
  headingTitle?: string
  classification?: string
  classificationReason?: string
}

interface EpubSourceUnit {
  unitId: string
  spineIndex: number
  manifestId: string
  href?: string
  originalTitle: string
  tocTitle?: string
  headingTitle?: string
  selectedTitle: string
  html: string
  paragraphs: string[]
  textLength: number
  linkTextLength: number
  imageCount: number
  classHints: string[]
  bodyText: string
  classification: SourceUnitClassification
}

interface SourceUnitClassification {
  kind: "content" | "blank" | "cover" | "toc" | "nav" | "copyright" | "front_matter" | "back_matter" | "publisher_note"
  reason: string
}

function candidateToRawChapter(
  candidate: RawChapterCandidate,
  docId: string,
  chapterId: string,
): RawChapter {
  const paras: Paragraph[] = []
  let pos = 0
  for (let i = 0; i < candidate.paragraphs.length; i++) {
    const text = candidate.paragraphs[i]
    paras.push({ pid: i, start: pos, end: pos + text.length, text })
    pos += text.length + 1
  }
  const source: ChapterSource = {
    type: candidate.sourceType,
    hrefs: candidate.hrefs,
  }
  if (candidate.manifestId) source.manifest_id = candidate.manifestId
  if (candidate.originalTitle) source.original_title = candidate.originalTitle
  if (candidate.tocTitle) source.toc_title = candidate.tocTitle
  if (candidate.headingTitle) source.heading_title = candidate.headingTitle
  if (candidate.classification) source.classification = candidate.classification
  if (candidate.classificationReason) source.classification_reason = candidate.classificationReason
  if (candidate.sourceUnitIds.length > 0) source.source_unit_ids = candidate.sourceUnitIds
  return {
    doc_id: docId,
    chapter_id: chapterId,
    title: candidate.title,
    source,
    text: candidate.paragraphs.join(" "),
    paragraphs: paras,
  }
}

// ---------------------------------------------------------------------------
// Short-chapter merge / long-chapter split
// ---------------------------------------------------------------------------

const MIN_CHARS = 500
const MAX_CHARS = 30000

function mergeShortChapters(
  candidates: RawChapterCandidate[],
): RawChapterCandidate[] {
  const merged: RawChapterCandidate[] = []
  for (const cand of candidates) {
    if (merged.length > 0 && cand.textLength < MIN_CHARS) {
      const prev = merged[merged.length - 1]
      prev.paragraphs.push(...cand.paragraphs)
      prev.textLength += cand.textLength
      prev.hrefs.push(...cand.hrefs)
      prev.sourceUnitIds.push(...cand.sourceUnitIds)
    } else {
      merged.push({
        ...cand,
        paragraphs: [...cand.paragraphs],
        hrefs: [...cand.hrefs],
        sourceUnitIds: [...cand.sourceUnitIds],
      })
    }
  }
  return merged
}

function splitLongChapter(cand: RawChapterCandidate): RawChapterCandidate[] {
  const result: RawChapterCandidate[] = []
  let current: string[] = []
  let currentLen = 0
  let partIdx = 1

  for (const para of cand.paragraphs) {
    if (currentLen + para.length > MAX_CHARS && current.length > 0) {
      result.push({
        title: `${cand.title} (${partIdx})`,
        paragraphs: current,
        textLength: currentLen,
        sourceType: cand.sourceType,
        hrefs: cand.hrefs,
        sourceUnitIds: cand.sourceUnitIds,
        manifestId: cand.manifestId,
        originalTitle: cand.originalTitle,
        tocTitle: cand.tocTitle,
        headingTitle: cand.headingTitle,
        classification: cand.classification,
        classificationReason: cand.classificationReason,
      })
      current = []
      currentLen = 0
      partIdx++
    }
    current.push(para)
    currentLen += para.length
  }
  if (current.length > 0) {
    result.push({
      title: partIdx > 1 ? `${cand.title} (${partIdx})` : cand.title,
      paragraphs: current,
      textLength: currentLen,
      sourceType: cand.sourceType,
      hrefs: cand.hrefs,
      sourceUnitIds: cand.sourceUnitIds,
      manifestId: cand.manifestId,
      originalTitle: cand.originalTitle,
      tocTitle: cand.tocTitle,
      headingTitle: cand.headingTitle,
      classification: cand.classification,
      classificationReason: cand.classificationReason,
    })
  }
  return result
}

// ---------------------------------------------------------------------------
// Main public API
// ---------------------------------------------------------------------------

/**
 * Parse an EPUB buffer and return normalized RawChapter[].
 * @param buffer - ArrayBuffer or Buffer of the EPUB file
 * @param docId - document ID to attach to chapters
 */
export async function parseEpub(
  buffer: Buffer,
  docId: string,
): Promise<RawChapter[]> {
  // epub2 expects a file path; write to a temp location
  const { tmpdir } = await import("os")
  const { join } = await import("path")
  const { writeFileSync, unlinkSync } = await import("fs")

  const tmpPath = join(tmpdir(), `epub-${Date.now()}.epub`)
  writeFileSync(tmpPath, buffer)

  try {
    const epub = await EPub.createAsync(tmpPath)
    const candidates = await extractCandidates(epub)
    const normalized = normalizeCandidates(candidates)
    return normalized.map((c, i) =>
      candidateToRawChapter(c, docId, `ch${String(i + 1).padStart(2, "0")}`),
    )
  } finally {
    unlinkSync(tmpPath)
  }
}

async function extractCandidates(epub: EPub): Promise<RawChapterCandidate[]> {
  const tocTitleByKey = buildTocTitleMap(epub)
  const sourceUnits: EpubSourceUnit[] = []

  for (const [spineIndex, spineItem] of epub.spine.contents.entries()) {
    const id = spineItem.id
    if (!id) continue
    try {
      const html = await new Promise<string>((resolve, reject) =>
        epub.getChapter(id, (err: Error, text?: string) =>
          err ? reject(err) : resolve(text ?? ""),
        ),
      )
      const item = epub.manifest[id] as { id?: string; title?: string; href?: string; mediaType?: string; "media-type"?: string } | undefined
      const href = item?.href ?? spineItem.href
      const originalTitle = item?.title ?? spineItem.title ?? id
      const htmlSummary = summarizeHtml(html)
      const tocTitle = titleFromToc(tocTitleByKey, id, href)
      const selectedTitle = selectSourceUnitTitle({
        spineIndex,
        originalTitle,
        tocTitle,
        headingTitle: htmlSummary.headingTitle,
        paragraphs: htmlSummary.paragraphs,
      })
      const baseUnit = {
        unitId: `spine:${spineIndex}:${id}`,
        spineIndex,
        manifestId: id,
        href,
        originalTitle,
        tocTitle,
        headingTitle: htmlSummary.headingTitle,
        selectedTitle,
        html,
        paragraphs: htmlSummary.paragraphs,
        textLength: htmlSummary.textLength,
        linkTextLength: htmlSummary.linkTextLength,
        imageCount: htmlSummary.imageCount,
        classHints: htmlSummary.classHints,
        bodyText: htmlSummary.bodyText,
      }
      sourceUnits.push({
        ...baseUnit,
        classification: classifySourceUnit(baseUnit),
      })
    } catch {
      // skip unreadable items
    }
  }

  const candidates = chaptersFromSourceUnits(sourceUnits)
  if (candidates.length > 0) return candidates

  // Safety fallback: if a strange EPUB is over-filtered, keep the longest readable units.
  return chaptersFromSourceUnits(
    [...sourceUnits]
      .sort((a, b) => b.textLength - a.textLength)
      .slice(0, Math.max(1, Math.min(3, sourceUnits.length)))
      .map((unit) => ({
        ...unit,
        classification: { kind: "content", reason: "fallback after all source units were filtered" },
      })),
  )
}

function buildTocTitleMap(epub: EPub): Map<string, string> {
  const map = new Map<string, string>()
  const tocItems = epub.toc as Array<{ id?: string; title?: string; href?: string }> | undefined
  for (const item of tocItems ?? []) {
    const title = normalizeChapterTitle(item.title)
    if (!title || isGenericChapterTitle(title)) continue
    if (item.id) map.set(`id:${item.id}`, title)
    if (item.href) {
      map.set(`href:${normalizeHref(item.href)}`, title)
      map.set(`href:${normalizeHrefWithoutFragment(item.href)}`, title)
    }
  }
  return map
}

function titleFromToc(
  titleMap: Map<string, string>,
  manifestId: string,
  href: string | undefined,
): string | undefined {
  return titleMap.get(`id:${manifestId}`) ??
    (href ? titleMap.get(`href:${normalizeHref(href)}`) : undefined) ??
    (href ? titleMap.get(`href:${normalizeHrefWithoutFragment(href)}`) : undefined)
}

function normalizeHref(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.?\//, "").toLowerCase()
}

function normalizeHrefWithoutFragment(value: string): string {
  return normalizeHref(value).split("#")[0] ?? normalizeHref(value)
}

function summarizeHtml(html: string): {
  paragraphs: string[]
  headingTitle?: string
  textLength: number
  linkTextLength: number
  imageCount: number
  classHints: string[]
  bodyText: string
} {
  const $ = cheerio.load(html)
  const headings = $("h1,h2,h3,h4")
    .map((_, el) => $(el).text().replace(/\s+/g, " ").trim())
    .get()
    .filter((text) => text.length > 0)
  const paragraphs = htmlToParagraphs(html)
  const bodyText = $.root().text().replace(/\s+/g, " ").trim()
  const classHints: string[] = []

  $("[id],[class],[epub\\:type],[type],[role]").each((_, el) => {
    const attribs = (el as { attribs?: Record<string, string> }).attribs ?? {}
    for (const key of ["id", "class", "epub:type", "type", "role"]) {
      const value = attribs[key]
      if (value) classHints.push(value)
    }
  })

  return {
    paragraphs,
    headingTitle: headings.find((text) => !isGenericChapterTitle(text) && text.length <= 140) ?? headings[0],
    textLength: paragraphs.reduce((sum, paragraph) => sum + paragraph.length, 0),
    linkTextLength: $("a").toArray().reduce((sum, el) => (
      sum + $(el).text().replace(/\s+/g, " ").trim().length
    ), 0),
    imageCount: $("img,image,svg").length,
    classHints: Array.from(new Set(classHints.flatMap((hint) => hint.split(/\s+/)).filter(Boolean))).slice(0, 40),
    bodyText,
  }
}

function selectSourceUnitTitle(params: {
  spineIndex: number
  originalTitle: string
  tocTitle?: string
  headingTitle?: string
  paragraphs: string[]
}): string {
  const candidates = [
    params.tocTitle,
    params.headingTitle,
    params.originalTitle,
    ...params.paragraphs.slice(0, 3).filter(isChapterHeadingCandidate),
  ]

  for (const candidate of candidates) {
    const normalized = normalizeChapterTitle(candidate)
    if (normalized && !isGenericChapterTitle(normalized)) return normalized
  }
  return `Chapter ${params.spineIndex + 1}`
}

function classifySourceUnit(unit: Omit<EpubSourceUnit, "classification">): SourceUnitClassification {
  const signal = [
    unit.manifestId,
    unit.href,
    unit.originalTitle,
    unit.tocTitle,
    unit.headingTitle,
    unit.classHints.join(" "),
  ].join(" ").toLowerCase()
  const bodyLower = unit.bodyText.toLowerCase()
  const linkRatio = unit.textLength > 0 ? unit.linkTextLength / unit.textLength : 0
  const hasChapterHeading = [unit.headingTitle, ...unit.paragraphs.slice(0, 3)]
    .some(isChapterHeadingCandidate)

  if (unit.textLength < 20 && unit.imageCount === 0) {
    return { kind: "blank", reason: "near-empty spine item" }
  }
  if (/\bpg[-_\s]*header\b/.test(signal)) {
    return { kind: "front_matter", reason: "Project Gutenberg header spine item" }
  }
  if (/\bpg[-_\s]*footer\b/.test(signal)) {
    return { kind: "back_matter", reason: "Project Gutenberg footer spine item" }
  }
  if (/\bcover\b/.test(signal) && unit.textLength < 500) {
    return { kind: "cover", reason: "cover-like id/title with little text" }
  }
  if (unit.imageCount > 0 && unit.textLength < 120 && !hasChapterHeading) {
    return { kind: "cover", reason: "image-only or image-dominant spine item" }
  }
  if (/\b(nav|toc|contents|table[-_\s]*of[-_\s]*contents)\b/.test(signal) && (unit.textLength < 3000 || linkRatio > 0.35)) {
    return { kind: "toc", reason: "navigation or table-of-contents spine item" }
  }
  if (linkRatio > 0.55 && unit.textLength < 5000 && !hasChapterHeading) {
    return { kind: "nav", reason: "link-dominant spine item" }
  }
  if (/\b(copyright|all rights reserved|isbn|license|publisher|produced by)\b/.test(`${signal} ${bodyLower}`) && unit.textLength < 2500) {
    return { kind: "copyright", reason: "copyright or publisher metadata text" }
  }
  if (bodyLower.includes("start of the project gutenberg") || bodyLower.includes("end of the project gutenberg")) {
    return { kind: bodyLower.includes("end of the project gutenberg") ? "back_matter" : "front_matter", reason: "Project Gutenberg boilerplate" }
  }
  if (/\b(title[-_\s]*page|dedication|acknowledg|imprint|colophon)\b/.test(signal) && unit.textLength < 1200) {
    return { kind: "front_matter", reason: "front/back matter title signal with short text" }
  }
  if (unit.textLength < 100 && !hasChapterHeading) {
    return { kind: "front_matter", reason: "short non-heading spine item" }
  }

  return { kind: "content", reason: "readable story content" }
}

function chaptersFromSourceUnits(units: EpubSourceUnit[]): RawChapterCandidate[] {
  return units
    .filter((unit) => unit.classification.kind === "content")
    .filter((unit) => unit.paragraphs.length > 0)
    .map((unit) => ({
      title: displayChapterTitle({
        doc_id: "",
        chapter_id: "",
        title: unit.selectedTitle,
        source: {
          type: "spine",
          toc_title: unit.tocTitle,
          hrefs: unit.href ? [unit.href] : [],
          manifest_id: unit.manifestId,
          original_title: unit.originalTitle,
          heading_title: unit.headingTitle,
          classification: unit.classification.kind,
          classification_reason: unit.classification.reason,
          source_unit_ids: [unit.unitId],
        },
        text: unit.paragraphs.join(" "),
        paragraphs: unit.paragraphs.map((text, index) => ({ pid: index, start: 0, end: text.length, text })),
      }, unit.manifestId, unit.spineIndex + 1),
      paragraphs: unit.paragraphs,
      textLength: unit.textLength,
      sourceType: "spine",
      hrefs: unit.href ? [unit.href] : [],
      sourceUnitIds: [unit.unitId],
      manifestId: unit.manifestId,
      originalTitle: unit.originalTitle,
      tocTitle: unit.tocTitle,
      headingTitle: unit.headingTitle,
      classification: unit.classification.kind,
      classificationReason: unit.classification.reason,
    }))
}

function normalizeCandidates(
  candidates: RawChapterCandidate[],
): RawChapterCandidate[] {
  const merged = mergeShortChapters(candidates)
  const split: RawChapterCandidate[] = []
  for (const c of merged) {
    if (c.textLength > MAX_CHARS) {
      split.push(...splitLongChapter(c))
    } else {
      split.push(c)
    }
  }
  return split
}
