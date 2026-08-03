import assert from "node:assert/strict"
import test from "node:test"
import type { V3BookQACorpusManifest } from "../src/lib/pipeline/v3-book-qa-types.ts"
import {
  createV3BookCitationAction,
  createV3BookQACorpusBuildRunIds,
  createV3BookParagraphDomId,
  createV3BookQAReadinessViewModel,
  filterV3BookReadableParagraphs,
  isV3BookParagraphReadable,
} from "../src/components/v3/v3-book-qa-view-model.ts"

function manifest(readiness: V3BookQACorpusManifest["readiness"] = []): V3BookQACorpusManifest {
  return {
    stage_id: "BOOK.1",
    artifact_version: "v3-book-qa-corpus-0.1",
    qa_corpus_id: "BOOK1_abc",
    doc_id: "doc",
    ordered_chapter_ids: ["ch01", "ch02", "ch03"],
    chapters: [
      {
        chapter_id: "ch01",
        chapter_title: "Chapter 1",
        chapter_index: 0,
        run_id: "run-a",
        progress_end_pid: 8,
        artifact_ids: {},
      },
      {
        chapter_id: "ch02",
        chapter_title: "Chapter 2",
        chapter_index: 1,
        run_id: "run-b",
        progress_end_pid: 7,
        artifact_ids: {},
      },
      {
        chapter_id: "ch03",
        chapter_title: "Chapter 3",
        chapter_index: 2,
        run_id: "run-c",
        progress_end_pid: 9,
        artifact_ids: {},
      },
    ],
    fingerprint: "fingerprint",
    readiness,
  }
}

test("book QA readiness reports only diagnostics inside the readable prefix", () => {
  const viewModel = createV3BookQAReadinessViewModel(
    manifest([
      {
        chapter_id: "ch01",
        run_id: "run-a",
        stage_id: "IDX.1",
        code: "paragraph_descriptors_missing",
        message: "IDX.1 contains no valid paragraph descriptors.",
      },
      {
        chapter_id: "ch03",
        run_id: "run-c",
        stage_id: "PRE.1",
        code: "missing_artifact_ref",
        message: "PRE.1 is missing.",
      },
    ]),
    { chapter_id: "ch02", pid: 4 },
  )

  assert.equal(viewModel.status, "blocked")
  assert.equal(viewModel.message, "1 readiness issue across 2 readable chapters.")
  assert.deepEqual(viewModel.diagnostics.map((item) => item.chapter_id), ["ch01"])
})

test("book QA readiness reports a query-ready readable prefix", () => {
  const viewModel = createV3BookQAReadinessViewModel(
    manifest(),
    { chapter_id: "ch02", pid: 4 },
  )

  assert.equal(viewModel.status, "ready")
  assert.equal(viewModel.message, "Ready across 2 readable chapters.")
  assert.deepEqual(viewModel.diagnostics, [])
})

test("current displayed chapter citation resolves to a deterministic scroll target", () => {
  const action = createV3BookCitationAction({
    docId: "doc",
    displayedChapterId: "ch02",
    qaCorpusId: "BOOK1_abc",
    readerPosition: { chapter_id: "ch02", pid: 4 },
    manifest: manifest(),
    citation: {
      chapter_id: "ch02",
      chapter_title: "Chapter 2",
      pid: 3,
    },
  })

  assert.deepEqual(action, {
    kind: "scroll",
    label: "Chapter 2 / P3",
    targetId: createV3BookParagraphDomId("ch02", 3),
  })
})

test("earlier chapter citation uses the manifest pinned run and preserves reader state", () => {
  const action = createV3BookCitationAction({
    docId: "doc",
    displayedChapterId: "ch02",
    qaCorpusId: "BOOK1_abc",
    readerPosition: { chapter_id: "ch02", pid: 4 },
    manifest: manifest(),
    citation: {
      chapter_id: "ch01",
      chapter_title: "Chapter 1",
      pid: 6,
    },
  })

  assert.deepEqual(action, {
    kind: "navigate",
    label: "Chapter 1 / P6",
    href: "/v3?docId=doc&chapterId=ch01&runId=run-a&source=v3&view=qa&qaCorpusId=BOOK1_abc&readerChapterId=ch02&readerPid=4",
  })
})

test("book paragraph readability follows chapter order and current PID", () => {
  const corpus = manifest()
  const readerPosition = { chapter_id: "ch02", pid: 4 }

  assert.equal(isV3BookParagraphReadable(corpus, readerPosition, "ch01", 8), true)
  assert.equal(isV3BookParagraphReadable(corpus, readerPosition, "ch02", 4), true)
  assert.equal(isV3BookParagraphReadable(corpus, readerPosition, "ch02", 5), false)
  assert.equal(isV3BookParagraphReadable(corpus, readerPosition, "ch03", 1), false)
})

test("readable paragraph filtering excludes current P5+ and every future-chapter paragraph", () => {
  const corpus = manifest()
  const readerPosition = { chapter_id: "ch02", pid: 4 }
  const currentChapter = [
    { pid: 3, text: "safe" },
    { pid: 4, text: "safe boundary" },
    { pid: 5, text: "future current-chapter text" },
  ]
  const futureChapter = [{ pid: 1, text: "future chapter text" }]

  assert.deepEqual(
    filterV3BookReadableParagraphs(corpus, readerPosition, "ch02", currentChapter),
    currentChapter.slice(0, 2),
  )
  assert.deepEqual(
    filterV3BookReadableParagraphs(corpus, readerPosition, "ch03", futureChapter),
    [],
  )
})

test("corpus build run IDs are omitted initially and complete when rebuilding a manifest", () => {
  assert.equal(createV3BookQACorpusBuildRunIds(), undefined)
  assert.deepEqual(createV3BookQACorpusBuildRunIds(manifest()), {
    ch01: "run-a",
    ch02: "run-b",
    ch03: "run-c",
  })
})
