import assert from "node:assert/strict"
import test from "node:test"
import type { RawChapter } from "../src/types/schema.ts"
import { chapterMetaFromRawChapters } from "../src/lib/firestore.ts"

function rawChapter(input: {
  chapterId: string
  title: string
  text?: string
  heading?: string
  source?: RawChapter["source"]
}): RawChapter {
  const text = input.text ?? "Narrative text ".repeat(10)
  const heading = input.heading ?? "CHAPTER I"
  return {
    doc_id: "doc-1",
    chapter_id: input.chapterId,
    title: input.title,
    text,
    paragraphs: [{ pid: 0, start: 0, end: heading.length, text: heading }],
    ...(input.source ? { source: input.source } : {}),
  }
}

test("chapterMetaFromRawChapters maps a single raw chapter", () => {
  const chapter = rawChapter({ chapterId: "ch01", title: "Arrival" })

  assert.deepEqual(chapterMetaFromRawChapters([chapter]), [
    {
      chapterId: "ch01",
      title: "Arrival",
      index: 1,
    },
  ])
})

test("chapterMetaFromRawChapters preserves filtering, ordering, titles, and long duplicate removal", () => {
  const duplicateText = "The same canonical narrative paragraph. ".repeat(12)
  const source = {
    type: "spine",
    hrefs: ["chapter-ten.xhtml"],
    toc_title: "Chapter Ten: Return",
  }

  const chapters = chapterMetaFromRawChapters([
    rawChapter({ chapterId: "ch12", title: "Later Copy", text: duplicateText }),
    rawChapter({
      chapterId: "front00",
      title: "Copyright",
      source: { type: "copyright", hrefs: ["copyright.xhtml"], classification: "copyright" },
    }),
    rawChapter({ chapterId: "ch10", title: "item10", source }),
    rawChapter({ chapterId: "ch03", title: "Earlier Copy", text: duplicateText }),
    rawChapter({ chapterId: "ch02", title: "Second Chapter" }),
  ])

  assert.deepEqual(chapters, [
    { chapterId: "ch02", title: "Second Chapter", index: 2 },
    { chapterId: "ch03", title: "Earlier Copy", index: 3 },
    { chapterId: "ch10", title: "Chapter Ten: Return", index: 10 },
  ])
})

test("chapterMetaFromRawChapters keeps duplicate text below the long-chapter threshold", () => {
  const shortText = "A brief repeated scene."

  assert.deepEqual(chapterMetaFromRawChapters([
    rawChapter({ chapterId: "ch02", title: "CHAPTER II", text: shortText }),
    rawChapter({ chapterId: "ch01", title: "CHAPTER I", text: shortText }),
  ]), [
    { chapterId: "ch01", title: "CHAPTER I", index: 1 },
    { chapterId: "ch02", title: "CHAPTER II", index: 2 },
  ])
})
