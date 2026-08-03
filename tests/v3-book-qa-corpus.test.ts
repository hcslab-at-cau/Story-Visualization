import test from "node:test"
import assert from "node:assert/strict"
import {
  V3BookReaderPositionValidationError,
  buildV3BookQACorpusManifest,
  selectV3BookReadableChapters,
  validateV3BookReaderPosition,
} from "../src/lib/pipeline/v3-book-qa-corpus.ts"
import type {
  V3BookQAChapterRef,
  V3BookQAReadinessDiagnostic,
} from "../src/lib/pipeline/v3-book-qa-types.ts"

function chapter(
  chapterId: string,
  chapterIndex: number,
  overrides: Partial<V3BookQAChapterRef> = {},
): V3BookQAChapterRef {
  return {
    chapter_id: chapterId,
    chapter_title: `Title ${chapterId}`,
    chapter_index: chapterIndex,
    run_id: `run-${chapterId}`,
    progress_end_pid: 12,
    artifact_ids: {
      "PRE.1": `${chapterId}-pre1`,
      "PRE.2": `${chapterId}-pre2`,
      "EVID.3": `${chapterId}-evid3`,
      "EVID.4": `${chapterId}-evid4`,
      "MEM.0": `${chapterId}-mem0`,
      "MEM.1": `${chapterId}-mem1`,
      "EVENT.2": `${chapterId}-event2`,
      "IDX.1": `${chapterId}-idx1`,
      "IDX.2": `${chapterId}-idx2`,
    },
    ...overrides,
  }
}

const diagnostic: V3BookQAReadinessDiagnostic = {
  chapter_id: "appendix",
  run_id: "run-appendix",
  stage_id: "IDX.2",
  code: "optional_stage_missing",
  message: "IDX.2 is unavailable.",
}

test("BOOK.1 manifest identity is deterministic and ignores readiness wording", () => {
  const chapters = [chapter("chapter-ten", 10), chapter("chapter-two", 20)]
  const first = buildV3BookQACorpusManifest({
    docId: "doc-1",
    chapters,
    readiness: [diagnostic],
  })
  const cloned = buildV3BookQACorpusManifest({
    docId: "doc-1",
    chapters: structuredClone(chapters),
    readiness: [{ ...diagnostic, message: "Different wording at a later time." }],
  })

  assert.equal(first.stage_id, "BOOK.1")
  assert.equal(first.artifact_version, "v3-book-qa-corpus-0.1")
  assert.match(first.fingerprint, /^[a-f0-9]{64}$/)
  assert.equal(first.qa_corpus_id, `BOOK1_${first.fingerprint.slice(0, 32)}`)
  assert.equal(cloned.fingerprint, first.fingerprint)
  assert.equal(cloned.qa_corpus_id, first.qa_corpus_id)
})

test("BOOK.1 canonicalizes returned artifact IDs independently of caller property order", () => {
  const canonicalOrder = chapter("chapter-one", 1, {
    artifact_ids: {
      "PRE.1": "chapter-one-pre1",
      "EVID.3": "chapter-one-evid3",
      "IDX.1": "chapter-one-idx1",
    },
  })
  const reverseInsertionOrder = chapter("chapter-one", 1, {
    artifact_ids: {
      "IDX.1": "chapter-one-idx1",
      "EVID.3": "chapter-one-evid3",
      "PRE.1": "chapter-one-pre1",
    },
  })

  const first = buildV3BookQACorpusManifest({ docId: "doc-1", chapters: [canonicalOrder] })
  const second = buildV3BookQACorpusManifest({ docId: "doc-1", chapters: [reverseInsertionOrder] })

  assert.deepEqual(first, second)
  assert.equal(JSON.stringify(first), JSON.stringify(second))
  assert.deepEqual(Object.keys(first.chapters[0].artifact_ids), ["PRE.1", "EVID.3", "IDX.1"])
})

test("BOOK.1 identity changes for every pinned reference and ordered chapter identity field", () => {
  const original = [chapter("chapter-ten", 10), chapter("chapter-two", 20)]
  const baseline = buildV3BookQACorpusManifest({ docId: "doc-1", chapters: original }).fingerprint
  const variants: V3BookQAChapterRef[][] = [
    original.map((item, index) => index === 0
      ? { ...item, artifact_ids: { ...item.artifact_ids, "EVID.4": "replacement-evid4" } }
      : item),
    original.map((item, index) => index === 0 ? { ...item, run_id: "replacement-run" } : item),
    original.map((item, index) => index === 0 ? { ...item, chapter_id: "chapter-eleven" } : item),
    original.map((item, index) => index === 0 ? { ...item, chapter_title: "Replacement title" } : item),
    original.map((item, index) => index === 0 ? { ...item, chapter_index: 11 } : item),
    original.map((item, index) => index === 0 ? { ...item, progress_end_pid: 13 } : item),
    [chapter("chapter-two", 10), chapter("chapter-ten", 20)],
  ]

  for (const chapters of variants) {
    const changed = buildV3BookQACorpusManifest({ docId: "doc-1", chapters }).fingerprint
    assert.notEqual(changed, baseline)
  }

  for (const stageId of ["PRE.1", "PRE.2", "EVID.3", "EVID.4", "MEM.0", "MEM.1", "EVENT.2", "IDX.1", "IDX.2"] as const) {
    const changedChapters = structuredClone(original)
    changedChapters[1].artifact_ids[stageId] = `replacement-${stageId}`
    const changed = buildV3BookQACorpusManifest({ docId: "doc-1", chapters: changedChapters }).fingerprint
    assert.notEqual(changed, baseline, `${stageId} must participate in the fingerprint`)
  }
})

test("BOOK.1 preserves server order without interpreting chapter IDs numerically", () => {
  const manifest = buildV3BookQACorpusManifest({
    docId: "doc-1",
    chapters: [
      chapter("chapter-ten", 10),
      chapter("prologue", 15),
      chapter("chapter-two", 20),
    ],
  })

  assert.deepEqual(manifest.ordered_chapter_ids, ["chapter-ten", "prologue", "chapter-two"])
  assert.deepEqual(manifest.chapters.map((item) => item.chapter_id), manifest.ordered_chapter_ids)
})

test("BOOK.1 rejects duplicate chapter IDs and chapter-index/order inconsistency", () => {
  assert.throws(
    () => buildV3BookQACorpusManifest({
      docId: "doc-1",
      chapters: [chapter("duplicate", 1), chapter("duplicate", 2)],
    }),
    /Duplicate chapter_id: duplicate/,
  )
  assert.throws(
    () => buildV3BookQACorpusManifest({
      docId: "doc-1",
      chapters: [chapter("first", 20), chapter("second", 10)],
    }),
    /chapter_index.*server order/i,
  )
})

test("reader positions validate chapter membership and inclusive PID bounds", () => {
  const manifest = buildV3BookQACorpusManifest({
    docId: "doc-1",
    chapters: [chapter("chapter-ten", 10, { progress_end_pid: 8 })],
  })

  assert.deepEqual(
    validateV3BookReaderPosition(manifest, { chapter_id: "chapter-ten", pid: 0 }),
    { chapter_id: "chapter-ten", pid: 0 },
  )
  assert.deepEqual(
    validateV3BookReaderPosition(manifest, { chapter_id: "chapter-ten", pid: 8 }),
    { chapter_id: "chapter-ten", pid: 8 },
  )

  for (const position of [
    { chapter_id: "unknown", pid: 0 },
    { chapter_id: "chapter-ten", pid: -1 },
    { chapter_id: "chapter-ten", pid: 9 },
    { chapter_id: "chapter-ten", pid: 1.5 },
  ]) {
    assert.throws(
      () => validateV3BookReaderPosition(manifest, position),
      (error) => error instanceof V3BookReaderPositionValidationError,
    )
  }
})

test("readable chapter selection includes previous chapters fully and only the current prefix", () => {
  const manifest = buildV3BookQACorpusManifest({
    docId: "doc-1",
    chapters: [
      chapter("chapter-ten", 10, { progress_end_pid: 8 }),
      chapter("prologue", 15, { progress_end_pid: 11 }),
      chapter("chapter-two", 20, { progress_end_pid: 14 }),
    ],
  })

  const readable = selectV3BookReadableChapters(manifest, { chapter_id: "prologue", pid: 4 })

  assert.deepEqual(
    readable.map(({ chapter_id, readable_through_pid, is_current }) => ({
      chapter_id,
      readable_through_pid,
      is_current,
    })),
    [
      { chapter_id: "chapter-ten", readable_through_pid: 8, is_current: false },
      { chapter_id: "prologue", readable_through_pid: 4, is_current: true },
    ],
  )
  assert.equal(readable.some((item) => item.chapter_id === "chapter-two"), false)
})
