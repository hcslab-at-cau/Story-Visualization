import test from "node:test"
import assert from "node:assert/strict"
import { deriveCorpusIdentity } from "../src/lib/corpus-identity.ts"
import { parseEpub } from "../src/lib/epub.ts"
import { buildSyntheticEpub } from "./helpers/synthetic-epub.ts"

function flattenParagraphs(chapters: Awaited<ReturnType<typeof parseEpub>>) {
  return chapters.flatMap((chapter) => chapter.paragraphs.map((paragraph) => ({ chapter, paragraph })))
}

test("parseEpub preserves EPUB provenance and deterministic book-wide paragraph coordinates", async () => {
  const bytes = await buildSyntheticEpub()
  const identity = deriveCorpusIdentity(bytes)
  const context = {
    docId: "doc-synthetic-epub",
    bookId: identity.bookId,
    corpusRevisionId: identity.corpusRevisionId,
  }

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

  assert.deepEqual(
    firstParagraphs.map(({ paragraph }) => paragraph.global_ordinal),
    Array.from({ length: firstParagraphs.length }, (_, index) => index),
  )
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
