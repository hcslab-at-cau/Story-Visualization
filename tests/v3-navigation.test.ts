import assert from "node:assert/strict"
import test from "node:test"
import {
  createV3WorkbenchHref,
  firstSearchParam,
  parseV3NavigationSource,
  parseV3WorkbenchView,
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
