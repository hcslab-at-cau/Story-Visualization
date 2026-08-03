import assert from "node:assert/strict"
import test from "node:test"
import {
  createV3WorkbenchHref,
  firstSearchParam,
  parseV3ReaderPosition,
  parseV3NavigationSource,
  parseV3WorkbenchView,
  reduceV3BookQANavigationState,
} from "../src/components/v3/v3-navigation.ts"

test("createV3WorkbenchHref carries document, chapter, source, and non-default view", () => {
  assert.equal(
    createV3WorkbenchHref({
      docId: "doc-1",
      chapterId: "chapter-2",
      source: "v3",
      view: "qa",
    }),
    "/v3?docId=doc-1&chapterId=chapter-2&source=v3&view=qa",
  )
})

test("createV3WorkbenchHref preserves book QA corpus, pinned run, and original reader position", () => {
  assert.equal(
    createV3WorkbenchHref({
      docId: "doc",
      chapterId: "ch01",
      runId: "run-a",
      source: "v3",
      view: "qa",
      qaCorpusId: "BOOK1_abc",
      readerPosition: { chapter_id: "ch02", pid: 4 },
    }),
    "/v3?docId=doc&chapterId=ch01&runId=run-a&source=v3&view=qa&qaCorpusId=BOOK1_abc&readerChapterId=ch02&readerPid=4",
  )
})

test("parseV3NavigationSource defaults unknown or missing source to current", () => {
  assert.equal(parseV3NavigationSource(undefined), "current")
  assert.equal(parseV3NavigationSource("current"), "current")
  assert.equal(parseV3NavigationSource("v3"), "v3")
  assert.equal(parseV3NavigationSource("legacy"), "legacy")
  assert.equal(parseV3NavigationSource("bad-source"), "current")
})

test("parseV3WorkbenchView defaults unknown or missing view to pipeline", () => {
  assert.equal(parseV3WorkbenchView(undefined), "pipeline")
  assert.equal(parseV3WorkbenchView("pipeline"), "pipeline")
  assert.equal(parseV3WorkbenchView("timeline"), "timeline")
  assert.equal(parseV3WorkbenchView("qa"), "qa")
  assert.equal(parseV3WorkbenchView("bad-view"), "pipeline")
})

test("firstSearchParam reads the first value from repeated query params", () => {
  assert.equal(firstSearchParam(["doc-1", "doc-2"]), "doc-1")
  assert.equal(firstSearchParam("doc-3"), "doc-3")
})

test("parseV3ReaderPosition accepts only a chapter and non-negative integer PID", () => {
  assert.deepEqual(parseV3ReaderPosition("ch02", "4"), { chapter_id: "ch02", pid: 4 })
  assert.deepEqual(parseV3ReaderPosition(["ch03", "ignored"], ["0", "9"]), { chapter_id: "ch03", pid: 0 })
  assert.equal(parseV3ReaderPosition("ch02", "4.5"), undefined)
  assert.equal(parseV3ReaderPosition("ch02", "-1"), undefined)
  assert.equal(parseV3ReaderPosition(undefined, "4"), undefined)
})

test("book QA navigation state synchronizes from URL state", () => {
  assert.deepEqual(
    reduceV3BookQANavigationState(
      {},
      {
        type: "url_sync",
        qaCorpusId: "BOOK1_abc",
        readerPosition: { chapter_id: "ch02", pid: 4 },
      },
    ),
    {
      qaCorpusId: "BOOK1_abc",
      readerPosition: { chapter_id: "ch02", pid: 4 },
    },
  )
})

test("manual chapter or run changes clear the active book QA scope", () => {
  assert.deepEqual(
    reduceV3BookQANavigationState(
      {
        qaCorpusId: "BOOK1_abc",
        readerPosition: { chapter_id: "ch02", pid: 4 },
      },
      { type: "manual_context_change" },
    ),
    {},
  )
})
