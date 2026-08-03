import test from "node:test"
import assert from "node:assert/strict"
import {
  V3BookQACorpusImmutableConflictError,
  V3BookQACorpusStore,
  type V3BookQACorpusStoreAdapter,
  type V3BookQACorpusStoreDocument,
  type V3BookQACorpusStoreListedDocument,
} from "../src/lib/server/v3-book-qa-corpus-store.ts"
import { buildV3BookQACorpusManifest } from "../src/lib/pipeline/v3-book-qa-corpus.ts"
import type {
  V3BookEntityGroup,
  V3BookQAChapterRef,
} from "../src/lib/pipeline/v3-book-qa-types.ts"

function clone<T>(value: T): T {
  return structuredClone(value)
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`
}

class FakeStoreAdapter implements V3BookQACorpusStoreAdapter {
  readonly documents = new Map<string, Record<string, unknown>>()
  readonly writeCalls: string[][] = []
  failOnWriteCall?: number

  async readDocument(path: string): Promise<Record<string, unknown> | null> {
    return clone(this.documents.get(path) ?? null)
  }

  async listDocuments(collectionPath: string): Promise<V3BookQACorpusStoreListedDocument[]> {
    const prefix = `${collectionPath}/`
    return [...this.documents.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .map(([path, data]) => ({
        id: path.slice(prefix.length),
        data: clone(data),
      }))
  }

  async writeImmutableDocuments(
    documents: V3BookQACorpusStoreDocument[],
  ): Promise<void> {
    this.writeCalls.push(documents.map((document) => document.path))
    if (this.failOnWriteCall === this.writeCalls.length) {
      throw new Error("injected write failure")
    }

    for (const document of documents) {
      const existing = this.documents.get(document.path)
      if (existing && stableStringify(existing) !== stableStringify(document.data)) {
        throw new V3BookQACorpusImmutableConflictError(document.path)
      }
    }
    for (const document of documents) {
      if (!this.documents.has(document.path)) {
        this.documents.set(document.path, clone(document.data))
      }
    }
  }
}

function chapter(): V3BookQAChapterRef {
  return {
    chapter_id: "chapter-one",
    chapter_title: "Chapter One",
    chapter_index: 1,
    run_id: "run-one",
    progress_end_pid: 12,
    artifact_ids: {
      "PRE.1": "pre1-artifact",
      "EVID.3": "evid3-artifact",
      "EVID.4": "evid4-artifact",
      "IDX.1": "idx1-artifact",
    },
  }
}

function manifest() {
  return buildV3BookQACorpusManifest({
    docId: "doc-one",
    chapters: [chapter()],
  })
}

function entityGroup(id: string): V3BookEntityGroup {
  return {
    global_entity_id: id,
    entity_type: "cast",
    canonical_label: `Entity ${id}`,
    members: [{
      chapter_id: "chapter-one",
      chapter_index: 1,
      run_id: "run-one",
      local_cluster_id: `local-${id}`,
      canonical_label: `Entity ${id}`,
      aliases: [{ value: `Alias ${id}`, evidence_pids: [2], available_from_pid: 2 }],
      evidence_pids: [2],
      link_available_from_pid: 2,
    }],
  }
}

function corpusPath(qaCorpusId: string): string {
  return `documents_v3/doc-one/qa_corpora/${qaCorpusId}`
}

test("writes entity groups to the BOOK.1 subcollection in bounded batches before the manifest", async () => {
  const adapter = new FakeStoreAdapter()
  const store = new V3BookQACorpusStore({ adapter, maxGroupsPerBatch: 2 })
  const bookManifest = manifest()
  const groups = ["group-e", "group-c", "group-a", "group-d", "group-b"].map(entityGroup)

  await store.save(bookManifest, groups)

  const root = corpusPath(bookManifest.qa_corpus_id)
  assert.deepEqual(adapter.writeCalls, [
    [`${root}/entity_groups/group-a`, `${root}/entity_groups/group-b`],
    [`${root}/entity_groups/group-c`, `${root}/entity_groups/group-d`],
    [`${root}/entity_groups/group-e`],
    [root],
  ])
  assert.equal(adapter.documents.has(root), true)
  assert.equal(adapter.documents.has(`${root}/entity_groups/group-a`), true)
  assert.equal("groups" in (adapter.documents.get(root) ?? {}), false)
})

test("does not expose a partially written corpus when a group batch fails before the manifest", async () => {
  const adapter = new FakeStoreAdapter()
  adapter.failOnWriteCall = 2
  const store = new V3BookQACorpusStore({ adapter, maxGroupsPerBatch: 2 })
  const bookManifest = manifest()

  await assert.rejects(
    store.save(bookManifest, ["group-a", "group-b", "group-c"].map(entityGroup)),
    /injected write failure/,
  )

  assert.equal(adapter.documents.has(corpusPath(bookManifest.qa_corpus_id)), false)
  assert.equal(await store.load(bookManifest.doc_id, bookManifest.qa_corpus_id), null)
})

test("retries identical corpus writes idempotently and loads groups deterministically", async () => {
  const adapter = new FakeStoreAdapter()
  const store = new V3BookQACorpusStore({ adapter, maxGroupsPerBatch: 2 })
  const bookManifest = manifest()
  const groups = [entityGroup("group-z"), entityGroup("group-a")]

  await store.save(bookManifest, groups)
  const firstDocuments = clone([...adapter.documents.entries()])
  await store.save(clone(bookManifest), clone(groups).reverse())

  assert.deepEqual([...adapter.documents.entries()], firstDocuments)
  const loaded = await store.load(bookManifest.doc_id, bookManifest.qa_corpus_id)
  assert.deepEqual(loaded?.manifest, bookManifest)
  assert.deepEqual(loaded?.groups.map((group) => group.global_entity_id), ["group-a", "group-z"])
})

test("rejects immutable group or manifest conflicts with HTTP 409", async (t) => {
  await t.test("group content conflict", async () => {
    const adapter = new FakeStoreAdapter()
    const store = new V3BookQACorpusStore({ adapter })
    const bookManifest = manifest()
    await store.save(bookManifest, [entityGroup("group-a")])

    const changedGroup = entityGroup("group-a")
    changedGroup.canonical_label = "Changed"
    await assert.rejects(
      store.save(bookManifest, [changedGroup]),
      (error: unknown) => error instanceof V3BookQACorpusImmutableConflictError &&
        error.statusCode === 409 &&
        error.code === "book_qa_corpus_immutable_conflict",
    )
  })

  await t.test("manifest fingerprint conflict", async () => {
    const adapter = new FakeStoreAdapter()
    const store = new V3BookQACorpusStore({ adapter })
    const bookManifest = manifest()
    const root = corpusPath(bookManifest.qa_corpus_id)
    adapter.documents.set(root, {
      ...bookManifest,
      fingerprint: "f".repeat(64),
      entity_group_count: 0,
    })

    await assert.rejects(
      store.save(bookManifest, []),
      (error: unknown) => error instanceof V3BookQACorpusImmutableConflictError &&
        error.statusCode === 409,
    )
  })
})
