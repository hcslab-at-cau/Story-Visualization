import assert from "node:assert/strict"
import test from "node:test"
import {
  DEFAULT_EPUB_PARSE_LIMITS,
  EpubParseLimitError,
  parseEpub,
  type EpubParseLimits,
} from "../src/lib/epub.ts"
import { buildSyntheticEpub } from "./helpers/synthetic-epub.ts"

const LIMIT_ERROR_MESSAGE = "EPUB content exceeds the configured resource budget"

function parseLimits(overrides: Partial<EpubParseLimits>): EpubParseLimits {
  return { ...DEFAULT_EPUB_PARSE_LIMITS, ...overrides }
}

function isParseLimit(limit: string): (error: unknown) => true {
  return (error: unknown) => {
    assert.ok(error instanceof EpubParseLimitError)
    assert.equal(error.name, "EpubParseLimitError")
    assert.equal(error.message, LIMIT_ERROR_MESSAGE)
    assert.equal(error.limit, limit)
    return true
  }
}

test("parseEpub rejects excessive spine items with a typed limit error", async () => {
  const buffer = await buildSyntheticEpub()

  await assert.rejects(
    parseEpub(buffer, "doc-spine-limit", parseLimits({ maxSpineItems: 1 })),
    isParseLimit("spine_items"),
  )
})

test("parseEpub propagates a per-source paragraph limit from inside the spine fallback", async () => {
  const buffer = await buildSyntheticEpub({
    chapters: [{
      manifestId: "paragraph-source",
      href: "Text/paragraph-source.xhtml",
      title: "Paragraph Source",
      paragraphCount: 2,
    }],
  })

  await assert.rejects(
    parseEpub(
      buffer,
      "doc-source-paragraph-limit",
      parseLimits({ maxParagraphsPerSourceItem: 2 }),
    ),
    isParseLimit("paragraphs_per_source_item"),
  )
})

test("parseEpub measures one normalized paragraph in UTF-8 bytes", async () => {
  const multibyteParagraph = "가".repeat(200)
  const buffer = await buildSyntheticEpub({
    chapters: [{
      manifestId: "unicode-paragraph",
      href: "Text/unicode-paragraph.xhtml",
      title: "Unicode Budget",
      bodyParagraphs: [multibyteParagraph],
    }],
  })

  assert.equal(Buffer.byteLength(multibyteParagraph, "utf8"), 600)
  await assert.rejects(
    parseEpub(buffer, "doc-paragraph-byte-limit", parseLimits({ maxParagraphBytes: 599 })),
    isParseLimit("paragraph_bytes"),
  )
})

test("parseEpub rejects excessive final normalized chapters", async () => {
  const buffer = await buildSyntheticEpub()

  await assert.rejects(
    parseEpub(buffer, "doc-chapter-limit", parseLimits({ maxChapters: 1 })),
    isParseLimit("chapters"),
  )
})

test("parseEpub rejects excessive total normalized paragraphs", async () => {
  const buffer = await buildSyntheticEpub({
    chapters: [
      {
        manifestId: "paragraph-total-a",
        href: "Text/paragraph-total-a.xhtml",
        title: "Paragraph Total A",
        paragraphCount: 1,
      },
      {
        manifestId: "paragraph-total-b",
        href: "Text/paragraph-total-b.xhtml",
        title: "Paragraph Total B",
        paragraphCount: 1,
      },
    ],
  })

  await assert.rejects(
    parseEpub(buffer, "doc-total-paragraph-limit", parseLimits({ maxParagraphs: 3 })),
    isParseLimit("paragraphs"),
  )
})

test("parseEpub rejects excessive total normalized text in UTF-8 bytes", async () => {
  const buffer = await buildSyntheticEpub({
    chapters: [{
      manifestId: "unicode-total",
      href: "Text/unicode-total.xhtml",
      title: "Unicode Total",
      bodyParagraphs: ["가".repeat(200)],
    }],
  })

  await assert.rejects(
    parseEpub(buffer, "doc-total-byte-limit", parseLimits({ maxTextBytes: 600 })),
    isParseLimit("text_bytes"),
  )
})

test("parseEpub accepts exact limits without changing normalized output", async () => {
  const buffer = await buildSyntheticEpub()
  const baseline = await parseEpub(buffer, "doc-exact-limits")
  const paragraphs = baseline.flatMap((chapter) => chapter.paragraphs)
  const paragraphBytes = paragraphs.map((paragraph) => Buffer.byteLength(paragraph.text, "utf8"))

  const parsedAtLimits = await parseEpub(buffer, "doc-exact-limits", {
    maxSpineItems: 2,
    maxParagraphsPerSourceItem: Math.max(...baseline.map((chapter) => chapter.paragraphs.length)),
    maxChapters: baseline.length,
    maxParagraphs: paragraphs.length,
    maxParagraphBytes: Math.max(...paragraphBytes),
    maxTextBytes: paragraphBytes.reduce((sum, bytes) => sum + bytes, 0),
  })

  assert.deepEqual(parsedAtLimits, baseline)
})
