import test from "node:test"
import assert from "node:assert/strict"
import { deriveCorpusIdentity } from "../src/lib/corpus-identity.ts"
import { parseEpub } from "../src/lib/epub.ts"
import { buildSyntheticEpub, type SyntheticEpubChapter } from "./helpers/synthetic-epub.ts"

type ParsedChapters = Awaited<ReturnType<typeof parseEpub>>
type FlattenedParagraph = {
  chapter: ParsedChapters[number]
  paragraph: ParsedChapters[number]["paragraphs"][number]
}

function flattenParagraphs(chapters: ParsedChapters): FlattenedParagraph[] {
  return chapters.flatMap((chapter) => chapter.paragraphs.map((paragraph) => ({ chapter, paragraph })))
}

function assertContiguousGlobals(chapters: ParsedChapters): void {
  assert.deepEqual(
    flattenParagraphs(chapters).map(({ paragraph }) => paragraph.global_ordinal),
    Array.from({ length: flattenParagraphs(chapters).length }, (_, index) => index),
  )
}

function assertSourceOrdinalsSequential(paragraphs: FlattenedParagraph[]): void {
  const ordinalsBySource = new Map<string, number[]>()

  for (const { paragraph } of paragraphs) {
    if (!paragraph.source_item_id) continue
    const ordinals = ordinalsBySource.get(paragraph.source_item_id) ?? []
    ordinals.push(paragraph.source_paragraph_ordinal ?? Number.NaN)
    ordinalsBySource.set(paragraph.source_item_id, ordinals)
  }

  for (const ordinals of ordinalsBySource.values()) {
    assert.deepEqual(ordinals, Array.from({ length: ordinals.length }, (_, index) => index))
  }
}

function buildContext(bytes: Buffer, docId = "doc-synthetic-epub") {
  const identity = deriveCorpusIdentity(bytes)
  return {
    identity,
    context: {
      docId,
      bookId: identity.bookId,
      corpusRevisionId: identity.corpusRevisionId,
    },
  }
}

test("parseEpub preserves EPUB provenance and deterministic book-wide paragraph coordinates", async () => {
  const bytes = await buildSyntheticEpub()
  const { context } = buildContext(bytes)

  const first = await parseEpub(bytes, context)
  const second = await parseEpub(Buffer.from(bytes), context)

  assert.ok(first.length >= 2, "expected at least two chapters after normalization")
  assert.equal(second.length, first.length)

  const firstParagraphs = flattenParagraphs(first)
  const secondParagraphs = flattenParagraphs(second)

  assert.equal(secondParagraphs.length, firstParagraphs.length)

  let expectedGlobalOrdinal = 0
  for (const [chapterIndex, chapter] of first.entries()) {
    assert.equal(chapter.doc_id, context.docId)
    assert.equal(chapter.book_id, context.bookId)
    assert.equal(chapter.corpus_revision_id, context.corpusRevisionId)
    assert.ok(chapter.source?.source_item_ids?.length, "expected source item IDs on chapter source")
    assert.equal(
      new Set(chapter.source?.source_item_ids ?? []).size,
      chapter.source?.source_item_ids?.length ?? 0,
      "expected chapter source item IDs to stay unique",
    )

    const paragraphSourceIds = new Set<string>()
    for (const [paragraphIndex, paragraph] of chapter.paragraphs.entries()) {
      const otherParagraph = second[chapterIndex]?.paragraphs[paragraphIndex]

      assert.equal(paragraph.pid, paragraphIndex)
      assert.equal(paragraph.global_ordinal, expectedGlobalOrdinal)
      assert.match(paragraph.source_item_id ?? "", /^si_v1_[a-f0-9]{64}$/)
      assert.match(paragraph.paragraph_id ?? "", /^p_v1_[a-f0-9]{64}$/)
      assert.equal(paragraph.source_paragraph_ordinal, paragraphIndex)

      assert.equal(otherParagraph?.source_item_id, paragraph.source_item_id)
      assert.equal(otherParagraph?.paragraph_id, paragraph.paragraph_id)
      assert.equal(otherParagraph?.global_ordinal, paragraph.global_ordinal)

      paragraphSourceIds.add(paragraph.source_item_id ?? "")
      expectedGlobalOrdinal += 1
    }

    assert.deepEqual(
      chapter.source?.source_item_ids,
      Array.from(paragraphSourceIds),
      "expected chapter source to preserve unique source item provenance",
    )
    assert.deepEqual(second[chapterIndex]?.source?.source_item_ids, chapter.source?.source_item_ids)
  }

  assertContiguousGlobals(first)
})

test("changed valid EPUB bytes create a new revision and different paragraph IDs", async () => {
  const firstBytes = await buildSyntheticEpub()
  const firstIdentity = deriveCorpusIdentity(firstBytes)
  const changedBytes = await buildSyntheticEpub({ editionLabel: "revised" })
  const changedIdentity = deriveCorpusIdentity(changedBytes, firstIdentity.bookId)

  const first = await parseEpub(firstBytes, {
    docId: "doc-synthetic-epub",
    bookId: firstIdentity.bookId,
    corpusRevisionId: firstIdentity.corpusRevisionId,
  })
  const changed = await parseEpub(changedBytes, {
    docId: "doc-synthetic-epub",
    bookId: changedIdentity.bookId,
    corpusRevisionId: changedIdentity.corpusRevisionId,
  })

  assert.ok(changed.length >= 2, "expected at least two chapters after normalization")
  assert.notEqual(changedIdentity.corpusRevisionId, firstIdentity.corpusRevisionId)
  assert.equal(changedIdentity.bookId, firstIdentity.bookId)

  const firstParagraphs = flattenParagraphs(first)
  const changedParagraphs = flattenParagraphs(changed)

  assert.equal(changedParagraphs.length, firstParagraphs.length)
  for (const [index, paragraph] of firstParagraphs.entries()) {
    assert.notEqual(changedParagraphs[index]?.paragraph.paragraph_id, paragraph.paragraph.paragraph_id)
  }
})

test("mergeShortChapters preserves both source items and resets source ordinals per source", async () => {
  const chapters: SyntheticEpubChapter[] = [
    {
      manifestId: "chap-long",
      href: "Text/chapter-long.xhtml",
      title: "Harbor Watch",
      topic: "night harbor patrol",
    },
    {
      manifestId: "chap-short",
      href: "Text/chapter-short.xhtml",
      title: "Lantern Log",
      bodyParagraphs: [
        "Lantern Log keeps a named lookout, a quay setting, and a handoff detail so it remains story content despite staying short.",
      ],
    },
    {
      manifestId: "chap-after",
      href: "Text/chapter-after.xhtml",
      title: "Signal Return",
      topic: "return march",
    },
  ]
  const bytes = await buildSyntheticEpub({ chapters })
  const { context } = buildContext(bytes, "doc-merge-short")

  const parsed = await parseEpub(bytes, context)

  assert.equal(parsed.length, 2)

  const mergedChapter = parsed[0]
  assert.deepEqual(
    mergedChapter.source?.hrefs?.map((href) => href.replace(/^OEBPS\//, "")),
    ["Text/chapter-long.xhtml", "Text/chapter-short.xhtml"],
  )
  assert.equal(mergedChapter.source?.source_item_ids?.length, 2)
  assert.ok(mergedChapter.paragraphs.length >= 4)

  const paragraphs = mergedChapter.paragraphs
  const sourceSwitchIndex = paragraphs.findIndex(
    (paragraph, index) => index > 0 && paragraph.source_item_id !== paragraphs[index - 1]?.source_item_id,
  )

  assert.ok(sourceSwitchIndex > 0, "expected a second source item in the merged chapter")
  assert.equal(paragraphs[sourceSwitchIndex]?.source_paragraph_ordinal, 0)

  assertSourceOrdinalsSequential(flattenParagraphs(parsed))
  assertContiguousGlobals(parsed)
})

test("splitLongChapter keeps one source item while source ordinals continue across emitted parts", async () => {
  const oversizedParagraphs = Array.from(
    { length: 45 },
    (_, index) => `Foundry Run oversized paragraph ${index + 1} keeps the same lookout crew, iron stairwell, and checkpoint ledger in view while repeating enough synthetic prose to force the 30000 character split threshold without using any real copyrighted text. `.repeat(4),
  )
  const bytes = await buildSyntheticEpub({
    chapters: [
      {
        manifestId: "chap-oversized",
        href: "Text/chapter-oversized.xhtml",
        title: "Foundry Run",
        bodyParagraphs: oversizedParagraphs,
      },
    ],
  })
  const { context } = buildContext(bytes, "doc-split-long")

  const parsed = await parseEpub(bytes, context)

  assert.ok(parsed.length >= 2, "expected oversized chapter to split into multiple parts")

  const firstSourceItemId = parsed[0]?.source?.source_item_ids?.[0]
  assert.ok(firstSourceItemId)

  const flattened = flattenParagraphs(parsed)
  for (const chapter of parsed) {
    assert.deepEqual(
      chapter.paragraphs.map((paragraph) => paragraph.pid),
      Array.from({ length: chapter.paragraphs.length }, (_, index) => index),
    )
    assert.deepEqual(chapter.source?.source_item_ids, [firstSourceItemId])
  }

  assert.ok(flattened.every(({ paragraph }) => paragraph.source_item_id === firstSourceItemId))
  assert.deepEqual(
    flattened.map(({ paragraph }) => paragraph.source_paragraph_ordinal),
    Array.from({ length: flattened.length }, (_, index) => index),
  )
  assertContiguousGlobals(parsed)
})

test("dedupeSourceUnits drops duplicate spine idrefs for the same manifest and keeps contiguous globals", async () => {
  const bytes = await buildSyntheticEpub({
    chapters: [
      {
        manifestId: "chap-1",
        href: "Text/chapter-1.xhtml",
        title: "Bridge Entry",
        topic: "bridge watch",
      },
      {
        manifestId: "chap-2",
        href: "Text/chapter-2.xhtml",
        title: "Quay Ledger",
        topic: "quay ledger",
      },
    ],
    spineIdRefs: ["chap-1", "chap-1", "chap-2"],
  })
  const { context } = buildContext(bytes, "doc-dedupe-source-units")

  const parsed = await parseEpub(bytes, context)

  assert.equal(parsed.length, 2)
  assert.deepEqual(parsed.map((chapter) => chapter.source?.manifest_id), ["chap-1", "chap-2"])
  assertContiguousGlobals(parsed)
})

test("candidate fingerprint dedupe keeps one duplicate long-text chapter even from distinct source items", async () => {
  const duplicateParagraphs = Array.from(
    { length: 3 },
    (_, index) => `Mirror Hall duplicate paragraph ${index + 1} keeps the same vaulted corridor, patrol rhythm, and ledger exchange in play so the candidate text fingerprint exceeds the dedupe threshold using only synthetic test prose. `.repeat(10),
  )
  const bytes = await buildSyntheticEpub({
    chapters: [
      {
        manifestId: "dup-a",
        href: "Text/duplicate-a.xhtml",
        title: "Mirror Hall",
        bodyParagraphs: duplicateParagraphs,
      },
      {
        manifestId: "dup-b",
        href: "Text/duplicate-b.xhtml",
        title: "Mirror Hall",
        bodyParagraphs: duplicateParagraphs,
      },
      {
        manifestId: "tail",
        href: "Text/tail.xhtml",
        title: "After Corridor",
        topic: "corridor return",
      },
    ],
  })
  const { context } = buildContext(bytes, "doc-candidate-dedupe")

  const parsed = await parseEpub(bytes, context)

  assert.equal(parsed.length, 2)
  assert.equal(
    parsed.filter((chapter) => ["dup-a", "dup-b"].includes(chapter.source?.manifest_id ?? "")).length,
    1,
  )
  assert.equal(parsed[1]?.source?.manifest_id, "tail")
  assertContiguousGlobals(parsed)
})

test("legacy parseEpub keeps doc_id but omits corpus-derived provenance fields", async () => {
  const bytes = await buildSyntheticEpub()

  const parsed = await parseEpub(bytes, "legacy-doc")

  assert.ok(parsed.length >= 2)
  for (const chapter of parsed) {
    assert.equal(chapter.doc_id, "legacy-doc")
    assert.equal(chapter.book_id, undefined)
    assert.equal(chapter.corpus_revision_id, undefined)
    assert.equal(chapter.source?.source_item_ids, undefined)

    for (const paragraph of chapter.paragraphs) {
      assert.equal(paragraph.paragraph_id, undefined)
      assert.equal(paragraph.source_item_id, undefined)
      assert.equal(paragraph.source_paragraph_ordinal, undefined)
      assert.equal(paragraph.global_ordinal, undefined)
    }
  }
})
