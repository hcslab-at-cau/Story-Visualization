import assert from "node:assert/strict"
import test from "node:test"
import { EPub } from "epub2"
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

test("parseEpub counts filtered source units against extraction budgets", async (t) => {
  const contentTitle = "Harbor Watch"
  const contentBody = (
    "Harbor Watch follows a synthetic lookout across a rainlit pier, records an invented signal, " +
    "and closes the patrol ledger without using any published story text. "
  ).repeat(5)
  const filteredTitle = "Copyright Notice"
  const filteredBody = "All rights reserved by a wholly synthetic publisher for this test fixture."
  const buffer = await buildSyntheticEpub({
    chapters: [
      {
        manifestId: "harbor-watch",
        href: "Text/harbor-watch.xhtml",
        title: contentTitle,
        bodyParagraphs: [contentBody],
      },
      {
        manifestId: "copyright-notice",
        href: "Text/copyright-notice.xhtml",
        title: filteredTitle,
        bodyParagraphs: [filteredBody],
      },
    ],
  })
  const retainedTextBytes = Buffer.byteLength(contentTitle, "utf8") +
    Buffer.byteLength(contentBody.trim(), "utf8")

  await t.test("paragraph work exceeds the final retained paragraph count", async () => {
    await assert.rejects(
      parseEpub(buffer, "doc-filtered-paragraph-work", parseLimits({ maxParagraphs: 2 })),
      isParseLimit("paragraphs"),
    )
  })

  await t.test("text work exceeds the final retained text bytes", async () => {
    await assert.rejects(
      parseEpub(buffer, "doc-filtered-text-work", parseLimits({ maxTextBytes: retainedTextBytes })),
      isParseLimit("text_bytes"),
    )
  })
})

test("parseEpub reads a successful duplicate spine source only once", async () => {
  const title = "Single Read"
  const body = (
    "Single Read follows an invented survey crew through a quiet lock gate and records a synthetic " +
    "checkpoint detail for parser testing. "
  ).repeat(5)
  const buffer = await buildSyntheticEpub({
    chapters: [{
      manifestId: "single-read",
      href: "Text/single-read.xhtml",
      title,
      bodyParagraphs: [body],
    }],
    spineIdRefs: ["single-read", "single-read"],
  })
  const originalGetChapter = EPub.prototype.getChapter
  let getChapterCalls = 0
  EPub.prototype.getChapter = function (
    chapterId: string,
    callback: (error: Error, text?: string) => void,
  ): void {
    getChapterCalls += 1
    originalGetChapter.call(this, chapterId, callback)
  }

  let parsed: Awaited<ReturnType<typeof parseEpub>> | undefined
  try {
    parsed = await parseEpub(buffer, "doc-single-read", parseLimits({
      maxSpineItems: 2,
      maxParagraphsPerSourceItem: 2,
      maxParagraphs: 2,
      maxTextBytes: Buffer.byteLength(title, "utf8") + Buffer.byteLength(body.trim(), "utf8"),
    }))
  } finally {
    EPub.prototype.getChapter = originalGetChapter
  }

  assert.equal(getChapterCalls, 1)
  assert.equal(parsed?.length, 1)
})

test("parseEpub retries a duplicate alias when its first source read is unreadable", async () => {
  const title = "Readable Alias"
  const body = (
    "Readable Alias follows an invented harbor clerk through a synthetic handoff and preserves a " +
    "neutral checkpoint record for parser testing. "
  ).repeat(5)
  const buffer = await buildSyntheticEpub({
    chapters: [{
      manifestId: "readable-alias",
      href: "Text/readable-alias.xhtml",
      title,
      bodyParagraphs: [body],
    }],
    spineIdRefs: ["readable-alias", "readable-alias"],
  })
  const originalGetChapter = EPub.prototype.getChapter
  let getChapterCalls = 0
  EPub.prototype.getChapter = function (
    chapterId: string,
    callback: (error: Error, text?: string) => void,
  ): void {
    getChapterCalls += 1
    if (getChapterCalls === 1) {
      callback(new Error("synthetic unreadable first alias"))
      return
    }
    originalGetChapter.call(this, chapterId, callback)
  }

  let parsed: Awaited<ReturnType<typeof parseEpub>> | undefined
  try {
    parsed = await parseEpub(buffer, "doc-readable-alias", parseLimits({
      maxSpineItems: 2,
      maxParagraphsPerSourceItem: 2,
      maxParagraphs: 2,
      maxTextBytes: Buffer.byteLength(title, "utf8") + Buffer.byteLength(body.trim(), "utf8"),
    }))
  } finally {
    EPub.prototype.getChapter = originalGetChapter
  }

  assert.equal(getChapterCalls, 2)
  assert.equal(parsed?.length, 1)
  assert.equal(parsed?.[0]?.source?.manifest_id, "readable-alias")
  assert.ok(parsed?.[0]?.paragraphs.some((paragraph) => paragraph.text === body.trim()))
})

test("parseEpub applies the chapter limit after splitting one oversized source", async () => {
  const oversizedParagraphs = Array.from(
    { length: 45 },
    (_, index) => (
      `Switchyard oversized paragraph ${index + 1} follows the same invented signal crew through a ` +
      "synthetic platform survey and repeats enough neutral fixture prose to exercise final chapter splitting. "
    ).repeat(4),
  )
  const buffer = await buildSyntheticEpub({
    chapters: [{
      manifestId: "switchyard-oversized",
      href: "Text/switchyard-oversized.xhtml",
      title: "Switchyard Run",
      bodyParagraphs: oversizedParagraphs,
    }],
  })
  const baseline = await parseEpub(buffer, "doc-split-chapter-limit")

  assert.ok(baseline.length > 1, "expected the oversized source to split")
  const parsedAtLimit = await parseEpub(
    buffer,
    "doc-split-chapter-limit",
    parseLimits({ maxChapters: baseline.length }),
  )
  assert.deepEqual(parsedAtLimit, baseline)

  await assert.rejects(
    parseEpub(
      buffer,
      "doc-split-chapter-limit",
      parseLimits({ maxChapters: baseline.length - 1 }),
    ),
    isParseLimit("chapters"),
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
