/**
 * EPUB Parser — converts EPUB file Buffer → RawChapter[].
 * Port of Story-Decomposition/src/viewer/epub.py
 *
 * Uses: epub2 (EPub), cheerio (BeautifulSoup equivalent)
 */

import { EPub } from "epub2"
import * as cheerio from "cheerio"
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
    hrefs: [],
  }
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
    } else {
      merged.push({ ...cand, paragraphs: [...cand.paragraphs] })
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
  // Collect spine items in reading order
  const spineIds: string[] = epub.spine.contents.map((s: { id?: string }) => s.id ?? "").filter(Boolean)

  const spineDocs: Array<{ id: string; title: string; html: string }> = []
  for (const id of spineIds) {
    try {
      const html = await new Promise<string>((resolve, reject) =>
        epub.getChapter(id, (err: Error, text?: string) =>
          err ? reject(err) : resolve(text ?? ""),
        ),
      )
      const item = epub.manifest[id] as { id: string; title?: string } | undefined
      spineDocs.push({ id, title: item?.title ?? id, html })
    } catch {
      // skip unreadable items
    }
  }

  // Try TOC-based splitting first
  const tocItems = epub.toc as Array<{ id: string; title: string; order: number }> | undefined
  if (tocItems && tocItems.length > 0) {
    const candidates = chaptersFromSpineDocs(spineDocs)
    if (candidates.length > 0) return candidates
  }

  // Fallback: 1 spine doc = 1 chapter
  return chaptersFromSpineDocs(spineDocs)
}

function chaptersFromSpineDocs(
  docs: Array<{ id: string; title: string; html: string }>,
): RawChapterCandidate[] {
  return docs
    .map((d) => {
      const paragraphs = htmlToParagraphs(d.html)
      return {
        title: d.title,
        paragraphs,
        textLength: paragraphs.reduce((s, p) => s + p.length, 0),
        sourceType: "spine",
      }
    })
    .filter((c) => c.paragraphs.length > 0)
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
