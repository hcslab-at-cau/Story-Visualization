import assert from "node:assert/strict"
import test from "node:test"
import {
  createCorpusAwareFirestoreReads,
  type EmbeddedChapterRecord,
} from "../src/lib/server/corpus-aware-firestore-read.ts"
import type { FirestoreDataSource } from "../src/lib/data-source.ts"
import type { RawChapter } from "../src/types/schema.ts"

const CORPUS_REVISION_ID = `cr_v1_${"a".repeat(64)}`

interface WorkspaceRecord {
  docId: string
  title: string
  corpusRevisionId?: string
}

interface CallLog {
  listedWorkspaceSources: FirestoreDataSource[]
  loadedWorkspaces: Array<{ docId: string; source: FirestoreDataSource }>
  checkedRevisions: string[]
  canonicalLoads: Array<{ corpusRevisionId: string; chapterId: string }>
  embeddedLoads: Array<{ docId: string; chapterId: string; source: FirestoreDataSource }>
  canonicalLists: string[]
  embeddedLists: Array<{ docId: string; source: FirestoreDataSource }>
  canonicalCleanupLists: string[]
  embeddedCleanupLists: Array<{ docId: string; source: FirestoreDataSource }>
}

function rawChapter(chapterId: string): RawChapter {
  return {
    doc_id: "doc-1",
    chapter_id: chapterId,
    title: chapterId,
    text: `Narrative for ${chapterId}`,
    paragraphs: [{ pid: 0, start: 0, end: 9, text: "Narrative" }],
  }
}

function createHarness(input: {
  workspaces?: WorkspaceRecord[]
  workspaceData?: unknown
  completeRevisionIds?: string[]
  canonicalChapter?: RawChapter | null
  embeddedChapter?: RawChapter | null
  canonicalChapters?: RawChapter[]
  embeddedChapters?: EmbeddedChapterRecord[]
  canonicalCleanupChapterIds?: string[]
  embeddedCleanupChapterIds?: string[]
} = {}) {
  const calls: CallLog = {
    listedWorkspaceSources: [],
    loadedWorkspaces: [],
    checkedRevisions: [],
    canonicalLoads: [],
    embeddedLoads: [],
    canonicalLists: [],
    embeddedLists: [],
    canonicalCleanupLists: [],
    embeddedCleanupLists: [],
  }
  const completeRevisionIds = new Set(input.completeRevisionIds ?? [])

  const reads = createCorpusAwareFirestoreReads<WorkspaceRecord>({
    async listWorkspaceDocuments(source) {
      calls.listedWorkspaceSources.push(source)
      return input.workspaces ?? []
    },
    async loadWorkspace(docId, source) {
      calls.loadedWorkspaces.push({ docId, source })
      return input.workspaceData
    },
    async isCanonicalRevisionComplete(corpusRevisionId) {
      calls.checkedRevisions.push(corpusRevisionId)
      return completeRevisionIds.has(corpusRevisionId)
    },
    async loadCanonicalRawChapter(corpusRevisionId, chapterId) {
      calls.canonicalLoads.push({ corpusRevisionId, chapterId })
      return input.canonicalChapter ?? null
    },
    async loadEmbeddedRawChapter(docId, chapterId, source) {
      calls.embeddedLoads.push({ docId, chapterId, source })
      return input.embeddedChapter ?? null
    },
    async listCanonicalRawChapters(corpusRevisionId) {
      calls.canonicalLists.push(corpusRevisionId)
      return input.canonicalChapters ?? []
    },
    async listEmbeddedChapters(docId, source) {
      calls.embeddedLists.push({ docId, source })
      return input.embeddedChapters ?? []
    },
    async listCanonicalChapterIds(corpusRevisionId) {
      calls.canonicalCleanupLists.push(corpusRevisionId)
      return input.canonicalCleanupChapterIds ?? []
    },
    async listEmbeddedChapterIds(docId, source) {
      calls.embeddedCleanupLists.push({ docId, source })
      return input.embeddedCleanupChapterIds ?? []
    },
  })

  return { calls, reads }
}

test("listDocuments keeps markerless workspaces and hides incomplete canonical references", async () => {
  const completeRevisionId = `cr_v1_${"b".repeat(64)}`
  const incompleteRevisionId = `cr_v1_${"c".repeat(64)}`
  const { calls, reads } = createHarness({
    workspaces: [
      { docId: "legacy", title: "Legacy" },
      { docId: "complete", title: "Complete", corpusRevisionId: completeRevisionId },
      { docId: "incomplete", title: "Incomplete", corpusRevisionId: incompleteRevisionId },
    ],
    completeRevisionIds: [completeRevisionId],
  })

  const result = await reads.listDocuments("v3")

  assert.deepEqual(result.map((document) => document.docId), ["legacy", "complete"])
  assert.deepEqual(calls.listedWorkspaceSources, ["v3"])
  assert.deepEqual(calls.checkedRevisions, [completeRevisionId, incompleteRevisionId])
})

test("listDocuments forwards every workspace source", async () => {
  for (const source of ["current", "v3", "legacy"] as const) {
    const workspace = { docId: source, title: source }
    const { calls, reads } = createHarness({ workspaces: [workspace] })

    assert.deepEqual(await reads.listDocuments(source), [workspace])
    assert.deepEqual(calls.listedWorkspaceSources, [source])
  }
})

test("loadRawChapter uses a canonical marker without embedded fallback", async () => {
  const canonical = rawChapter("ch01")
  const { calls, reads } = createHarness({
    workspaceData: { corpusRevisionId: CORPUS_REVISION_ID },
    canonicalChapter: canonical,
    embeddedChapter: rawChapter("wrong"),
  })

  const result = await reads.loadRawChapter("workspace", "ch01", "current")

  assert.equal(result, canonical)
  assert.deepEqual(calls.loadedWorkspaces, [{ docId: "workspace", source: "current" }])
  assert.deepEqual(calls.canonicalLoads, [{ corpusRevisionId: CORPUS_REVISION_ID, chapterId: "ch01" }])
  assert.deepEqual(calls.embeddedLoads, [])
})

test("loadRawChapter preserves markerless embedded reads for every source", async () => {
  for (const source of ["current", "v3", "legacy"] as const) {
    const embedded = rawChapter(`chapter-${source}`)
    const { calls, reads } = createHarness({ workspaceData: {}, embeddedChapter: embedded })

    const result = await reads.loadRawChapter("workspace", "ch02", source)

    assert.equal(result, embedded)
    assert.deepEqual(calls.loadedWorkspaces, [{ docId: "workspace", source }])
    assert.deepEqual(calls.embeddedLoads, [{ docId: "workspace", chapterId: "ch02", source }])
    assert.deepEqual(calls.canonicalLoads, [])
  }
})

test("listChapters uses canonical rows without embedded fallback", async () => {
  const canonical = [rawChapter("ch01"), rawChapter("ch02")]
  const { calls, reads } = createHarness({
    workspaceData: { corpusRevisionId: CORPUS_REVISION_ID },
    canonicalChapters: canonical,
    embeddedChapters: [{ chapterId: "wrong", raw: rawChapter("wrong") }],
  })

  const result = await reads.listChapters("workspace", "legacy")

  assert.deepEqual(result, { kind: "canonical", chapters: canonical })
  assert.deepEqual(calls.loadedWorkspaces, [{ docId: "workspace", source: "legacy" }])
  assert.deepEqual(calls.canonicalLists, [CORPUS_REVISION_ID])
  assert.deepEqual(calls.embeddedLists, [])
})

test("listChapters preserves markerless embedded chapter records and source", async () => {
  const embedded = [
    { chapterId: "front00" },
    { chapterId: "ch01", raw: rawChapter("ch01") },
  ]
  for (const source of ["current", "v3", "legacy"] as const) {
    const { calls, reads } = createHarness({ workspaceData: {}, embeddedChapters: embedded })

    const result = await reads.listChapters("workspace", source)

    assert.deepEqual(result, { kind: "embedded", chapters: embedded })
    assert.deepEqual(calls.loadedWorkspaces, [{ docId: "workspace", source }])
    assert.deepEqual(calls.embeddedLists, [{ docId: "workspace", source }])
    assert.deepEqual(calls.canonicalLists, [])
  }
})

test("cleanup resolves canonical chapter IDs from the complete manifest when parent docs are absent", async () => {
  const manifestChapterIds = ["ch01", "ch02"]
  const { calls, reads } = createHarness({
    workspaceData: { corpusRevisionId: CORPUS_REVISION_ID },
    canonicalCleanupChapterIds: manifestChapterIds,
    embeddedCleanupChapterIds: [],
  })

  const result = await reads.listCleanupChapterIds("workspace", "current")

  assert.deepEqual(result, manifestChapterIds)
  assert.deepEqual(calls.canonicalCleanupLists, [CORPUS_REVISION_ID])
  assert.deepEqual(calls.embeddedCleanupLists, [])
})

test("cleanup preserves every markerless embedded parent ID without story filtering", async () => {
  const embeddedParentIds = ["front00", "ch01", "ch01-copy", "hidden99"]
  const { calls, reads } = createHarness({
    workspaceData: {},
    embeddedCleanupChapterIds: embeddedParentIds,
  })

  const result = await reads.listCleanupChapterIds("legacy-doc", "current")

  assert.deepEqual(result, embeddedParentIds)
  assert.deepEqual(calls.embeddedCleanupLists, [{ docId: "legacy-doc", source: "current" }])
  assert.deepEqual(calls.canonicalCleanupLists, [])
})
