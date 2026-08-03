import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"

import { buildV3BookQACorpusManifest } from "../src/lib/pipeline/v3-book-qa-corpus.ts"
import type { V3BookQACorpusManifest } from "../src/lib/pipeline/v3-book-qa-types.ts"
import type { StoredV3BookQACorpus } from "../src/lib/server/v3-book-qa-corpus-store.ts"
import { V3BookQACorpusImmutableConflictError } from "../src/lib/server/v3-book-qa-corpus-store.ts"
import {
  V3_BOOK_QA_HISTORY_PAGE_SIZE,
  V3_BOOK_QA_HISTORY_SCHEMA_VERSION,
  createV3BookQAHistoryAnswerSnapshot,
  type V3BookQAHistoryAnswerSnapshot,
  type V3BookQAHistoryEntry,
} from "../src/lib/v3-book-qa-history-types.ts"
import {
  V3_BOOK_QA_HISTORY_MAX_BYTES,
  V3BookQAHistoryCorpusIntegrityError,
  V3BookQAHistoryValidationError,
  createV3BookQAHistoryScopeId,
  decodeV3BookQAHistoryCursor,
  encodeV3BookQAHistoryCursor,
  normalizeV3BookQAHistoryCreateInput,
  normalizeV3BookQAHistoryDeleteInput,
  normalizeV3BookQAHistoryPage,
  normalizeV3BookQAHistoryScopeInput,
  normalizeV3BookQAHistoryStoredEntry,
  validateV3BookQAHistoryCreateForCorpus,
} from "../src/lib/server/v3-book-qa-history.ts"
import {
  V3BookQAHistoryStore,
  V3BookQAHistoryStoreIntegrityError,
  type V3BookQAHistoryStoreAdapter,
  type V3BookQAHistoryStoreDocument,
  type V3BookQAHistoryStoreListQuery,
  type V3BookQAHistoryStoreListedDocument,
} from "../src/lib/server/v3-book-qa-history-store.ts"
import { createV3BookQAHistoryRouteHandlers } from "../src/app/api/v3/book-qa-history/route.ts"
import {
  deleteV3BookQAHistory,
  listV3BookQAHistory,
  saveV3BookQAHistory,
} from "../src/lib/client-data.ts"

function manifest(): V3BookQACorpusManifest {
  return buildV3BookQACorpusManifest({
    docId: "doc-one",
    chapters: [
      {
        chapter_id: "ch-one",
        chapter_title: "Chapter One",
        chapter_index: 1,
        run_id: "run-one",
        progress_end_pid: 5,
        artifact_ids: {},
      },
      {
        chapter_id: "ch-two",
        chapter_title: "Chapter Two",
        chapter_index: 2,
        run_id: "run-two",
        progress_end_pid: 6,
        artifact_ids: {},
      },
      {
        chapter_id: "ch-three",
        chapter_title: "Chapter Three",
        chapter_index: 3,
        run_id: "run-three",
        progress_end_pid: 8,
        artifact_ids: {},
      },
    ],
  })
}

function corpus(overrides: Partial<StoredV3BookQACorpus> = {}): StoredV3BookQACorpus {
  return { manifest: manifest(), groups: [], ...overrides }
}

function retrievalHit(params: {
  chapterId: string
  chapterTitle: string
  chapterIndex: number
  localId: string
  pid: number
}) {
  return {
    record_id: `${params.chapterId}:${params.localId}`,
    local_record_id: params.localId,
    record_type: "event" as const,
    chapter_id: params.chapterId,
    chapter_title: params.chapterTitle,
    chapter_index: params.chapterIndex,
    label: `Event ${params.localId}`,
    text: `Text ${params.localId}`,
    score: 0.9,
    match_kind: "hybrid" as const,
    text_span: { start_pid: params.pid, end_pid: params.pid },
    pid: params.pid,
    progress_status: "available" as const,
    evidence_refs: [`${params.chapterId}:evidence-${params.localId}`],
    matched_terms: [params.localId],
    semantic_similarity: 0.8,
    entity_group_ids: [],
  }
}

function answerSnapshot(): V3BookQAHistoryAnswerSnapshot {
  const hits = [
    retrievalHit({
      chapterId: "ch-one",
      chapterTitle: "Chapter One",
      chapterIndex: 1,
      localId: "earlier",
      pid: 2,
    }),
    retrievalHit({
      chapterId: "ch-two",
      chapterTitle: "Chapter Two",
      chapterIndex: 2,
      localId: "current",
      pid: 2,
    }),
  ]
  return {
    answer: {
      status: "answered",
      text: "The earlier event explains the current one.",
      citations: [
        {
          chapter_id: "ch-one",
          chapter_title: "Chapter One",
          pid: 2,
          paragraph_text: "Earlier.",
        },
        {
          chapter_id: "ch-two",
          chapter_title: "Chapter Two",
          pid: 2,
          paragraph_text: "Current.",
        },
      ],
      used_evidence: hits.map((hit, index) => ({
        evidence_id: `E${index + 1}`,
        record_id: hit.record_id,
        record_type: hit.record_type,
        label: hit.label,
      })),
    },
    retrieval: {
      stats: {
        readable_chapters: 2,
        total_records: 2,
        searched_records: 2,
        blocked_ahead_records: 0,
        direct_hits: 2,
        lexical_hits: 2,
        semantic_hits: 2,
        entity_group_hits: 0,
        graph_neighbor_hits: 0,
        returned_hits: 2,
      },
      hits,
    },
  }
}

function createInput(snapshot: V3BookQAHistoryAnswerSnapshot = answerSnapshot()) {
  const bookManifest = manifest()
  return {
    source: "v3" as const,
    docId: bookManifest.doc_id,
    qaCorpusId: bookManifest.qa_corpus_id,
    question: "How are the events connected?",
    readerPosition: { chapter_id: "ch-two", pid: 2 },
    answerSnapshot: snapshot,
  }
}

function storedEntry(index = 0): V3BookQAHistoryEntry {
  const input = createInput()
  return {
    schema_version: V3_BOOK_QA_HISTORY_SCHEMA_VERSION,
    entry_id: `entry-${String(index).padStart(2, "0")}`,
    doc_id: input.docId,
    qa_corpus_id: input.qaCorpusId,
    question: input.question,
    reader_position: input.readerPosition,
    answer_snapshot: input.answerSnapshot,
    created_at: new Date(1_710_000_000_000 - index * 1_000).toISOString(),
  }
}

test("book history has an isolated 0.2 corpus scope", () => {
  const qaCorpusId = manifest().qa_corpus_id
  assert.equal(V3_BOOK_QA_HISTORY_SCHEMA_VERSION, "v3-book-qa-history-0.2")
  assert.equal(V3_BOOK_QA_HISTORY_PAGE_SIZE, 20)
  assert.equal(
    createV3BookQAHistoryScopeId(qaCorpusId),
    createHash("sha256").update(JSON.stringify(["book", qaCorpusId])).digest("hex"),
  )
  assert.notEqual(
    createV3BookQAHistoryScopeId(qaCorpusId),
    createV3BookQAHistoryScopeId(`${qaCorpusId}-other`),
  )
})

test("answer snapshot helper keeps only the answer plus retrieval stats and hits", () => {
  const snapshot = answerSnapshot()
  const created = createV3BookQAHistoryAnswerSnapshot({
    answer: snapshot.answer,
    retrieval: {
      artifact_version: "v3-book-qa-retrieval-0.1",
      extraction_profile: "v3_book_qa_retrieval",
      qa_corpus_id: manifest().qa_corpus_id,
      retrieval_mode: "hybrid",
      query: {
        question: "How are the events connected?",
        normalized_terms: ["events"],
        reader_position: { chapter_id: "ch-two", pid: 2 },
      },
      graph_edges: [],
      ...snapshot.retrieval,
    },
  })
  assert.deepEqual(created, snapshot)
  assert.equal("query" in created.retrieval, false)
})

test("strictly normalizes v3 scope, delete, create, and cursor requests", () => {
  const input = createInput()
  const cursor = encodeV3BookQAHistoryCursor({ createdAtMs: 1_710_000_000_000, entryId: "e-1" })
  assert.deepEqual(decodeV3BookQAHistoryCursor(cursor), {
    createdAtMs: 1_710_000_000_000,
    entryId: "e-1",
  })
  assert.equal(decodeV3BookQAHistoryCursor("not-a-cursor"), null)
  assert.equal(normalizeV3BookQAHistoryScopeInput({
    source: "v3",
    docId: input.docId,
    qaCorpusId: input.qaCorpusId,
    cursor,
  }).cursor, cursor)
  assert.equal(normalizeV3BookQAHistoryDeleteInput({
    source: "v3",
    docId: input.docId,
    qaCorpusId: input.qaCorpusId,
    entryId: "e-1",
  }).entryId, "e-1")

  assert.throws(() => normalizeV3BookQAHistoryCreateInput({ ...input, source: "v2" }, manifest()))
  assert.throws(() => normalizeV3BookQAHistoryCreateInput({ ...input, unexpected: true }, manifest()))
  assert.throws(() => normalizeV3BookQAHistoryScopeInput({
    source: "v3", docId: input.docId, qaCorpusId: input.qaCorpusId, cursor: "bad",
  }))
  assert.throws(() => normalizeV3BookQAHistoryScopeInput({
    source: "v3", docId: "escaped/doc", qaCorpusId: input.qaCorpusId,
  }))
  assert.throws(() => normalizeV3BookQAHistoryDeleteInput({
    source: "v3", docId: input.docId, qaCorpusId: input.qaCorpusId, entryId: "e-1", extra: true,
  }))
})

test("accepts cross-chapter evidence with the same PID at a saved reader position", () => {
  const normalized = normalizeV3BookQAHistoryCreateInput(createInput(), manifest())
  assert.deepEqual(normalized.readerPosition, { chapter_id: "ch-two", pid: 2 })
  assert.deepEqual(
    normalized.answer_snapshot.answer.citations.map(({ chapter_id, pid }) => [chapter_id, pid]),
    [["ch-one", 2], ["ch-two", 2]],
  )

  const parsedWithoutCorpus = normalizeV3BookQAHistoryCreateInput(createInput())
  assert.equal(validateV3BookQAHistoryCreateForCorpus(
    parsedWithoutCorpus,
    { manifest: manifest() },
  ), parsedWithoutCorpus)
})

test("validates document, corpus, and reader position against the exact BOOK.1 manifest", async (t) => {
  const cases: Array<[string, () => unknown]> = [
    ["document", () => ({ ...createInput(), docId: "other-doc" })],
    ["corpus", () => ({ ...createInput(), qaCorpusId: "other-corpus" })],
    ["unknown chapter", () => ({
      ...createInput(), readerPosition: { chapter_id: "missing", pid: 0 },
    })],
    ["current chapter suffix", () => ({
      ...createInput(), readerPosition: { chapter_id: "ch-two", pid: 7 },
    })],
  ]
  for (const [name, makeInput] of cases) {
    await t.test(name, () => {
      assert.throws(
        () => normalizeV3BookQAHistoryCreateInput(makeInput(), manifest()),
        (error: unknown) => error instanceof V3BookQAHistoryValidationError,
      )
    })
  }

  const malformed = { ...manifest(), doc_id: "tampered" }
  assert.throws(
    () => normalizeV3BookQAHistoryCreateInput(createInput(), malformed),
    (error: unknown) => error instanceof V3BookQAHistoryCorpusIntegrityError,
  )
})

test("rejects previous overflow, future, and current-suffix hits or citations", async (t) => {
  const cases: Array<[string, (snapshot: V3BookQAHistoryAnswerSnapshot) => void]> = [
    ["previous overflow hit", (snapshot) => {
      snapshot.retrieval.hits[0]!.text_span = { start_pid: 6, end_pid: 6 }
      snapshot.retrieval.hits[0]!.pid = 6
    }],
    ["future hit", (snapshot) => {
      snapshot.retrieval.hits[0] = retrievalHit({
        chapterId: "ch-three",
        chapterTitle: "Chapter Three",
        chapterIndex: 3,
        localId: "future",
        pid: 0,
      })
    }],
    ["current suffix hit", (snapshot) => {
      snapshot.retrieval.hits[1]!.text_span = { start_pid: 3, end_pid: 3 }
      snapshot.retrieval.hits[1]!.pid = 3
    }],
    ["future citation", (snapshot) => {
      snapshot.answer.citations[0] = {
        chapter_id: "ch-three",
        chapter_title: "Chapter Three",
        pid: 0,
        paragraph_text: "Future.",
      }
    }],
    ["current suffix citation", (snapshot) => {
      snapshot.answer.citations[1]!.pid = 3
    }],
  ]

  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const snapshot = structuredClone(answerSnapshot())
      mutate(snapshot)
      assert.throws(
        () => normalizeV3BookQAHistoryCreateInput(createInput(snapshot), manifest()),
        (error: unknown) => error instanceof V3BookQAHistoryValidationError,
      )
    })
  }
})

test("rejects hit namespace, title, index, citation title, and evidence mismatches", async (t) => {
  const cases: Array<[string, (snapshot: V3BookQAHistoryAnswerSnapshot) => void]> = [
    ["namespace", (snapshot) => { snapshot.retrieval.hits[0]!.record_id = "ch-two:earlier" }],
    ["title", (snapshot) => { snapshot.retrieval.hits[0]!.chapter_title = "Wrong" }],
    ["index", (snapshot) => { snapshot.retrieval.hits[0]!.chapter_index = 99 }],
    ["citation title", (snapshot) => { snapshot.answer.citations[0]!.chapter_title = "Wrong" }],
    ["used record", (snapshot) => { snapshot.answer.used_evidence[0]!.record_id = "ch-one:missing" }],
    ["used label", (snapshot) => { snapshot.answer.used_evidence[0]!.label = "Wrong" }],
  ]
  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const snapshot = structuredClone(answerSnapshot())
      mutate(snapshot)
      assert.throws(
        () => normalizeV3BookQAHistoryCreateInput(createInput(snapshot), manifest()),
        (error: unknown) => error instanceof V3BookQAHistoryValidationError,
      )
    })
  }
})

test("rejects non-finite scores and excessive bounded arrays", () => {
  const nonFinite = answerSnapshot()
  nonFinite.retrieval.hits[0]!.score = Number.POSITIVE_INFINITY
  assert.throws(() => normalizeV3BookQAHistoryCreateInput(createInput(nonFinite), manifest()))

  const excessive = answerSnapshot()
  excessive.retrieval.hits = Array.from(
    { length: 101 },
    (_, index) => retrievalHit({
      chapterId: "ch-one",
      chapterTitle: "Chapter One",
      chapterIndex: 1,
      localId: `hit-${index}`,
      pid: 2,
    }),
  )
  excessive.retrieval.stats.returned_hits = 101
  assert.throws(() => normalizeV3BookQAHistoryCreateInput(createInput(excessive), manifest()))
})

test("requires insufficient-evidence answers to be exactly empty", () => {
  const valid = answerSnapshot()
  valid.answer = { status: "insufficient_evidence", text: "", citations: [], used_evidence: [] }
  assert.equal(
    normalizeV3BookQAHistoryCreateInput(createInput(valid), manifest()).answer_snapshot.answer.status,
    "insufficient_evidence",
  )

  const invalid = structuredClone(valid)
  invalid.answer.text = "Not empty"
  assert.throws(() => normalizeV3BookQAHistoryCreateInput(createInput(invalid), manifest()))
})

test("rejects stored content above the 800 KiB UTF-8 budget", () => {
  const snapshot = answerSnapshot()
  const large = "가".repeat(200_000)
  snapshot.answer.text = large
  snapshot.retrieval.hits = Array.from({ length: 2 }, (_, index) => ({
    ...snapshot.retrieval.hits[index]!,
    record_id: `${snapshot.retrieval.hits[index]!.chapter_id}:large-${index}`,
    local_record_id: `large-${index}`,
    text: large,
  }))
  snapshot.retrieval.stats.returned_hits = 2
  assert.throws(
    () => normalizeV3BookQAHistoryCreateInput(createInput(snapshot), manifest()),
    new RegExp(`too large|${V3_BOOK_QA_HISTORY_MAX_BYTES}`),
  )
  assert.throws(
    () => normalizeV3BookQAHistoryStoredEntry({
      ...storedEntry(),
      answer_snapshot: snapshot,
    }),
    new RegExp(`too large|${V3_BOOK_QA_HISTORY_MAX_BYTES}`),
  )
})

test("stored entry parsing preserves the saved reader position", () => {
  const entry = storedEntry()
  assert.deepEqual(
    normalizeV3BookQAHistoryStoredEntry(entry, manifest()).reader_position,
    { chapter_id: "ch-two", pid: 2 },
  )
  assert.throws(() => normalizeV3BookQAHistoryStoredEntry({ ...entry, unexpected: true }))
})

test("page normalization emits 20 entries and a strict base64url cursor", () => {
  const entries = Array.from({ length: 21 }, (_, index) => storedEntry(index))
  const page = normalizeV3BookQAHistoryPage(entries)
  assert.equal(page.entries.length, 20)
  assert.equal(page.has_more, true)
  assert.ok(page.next_cursor)
  assert.deepEqual(decodeV3BookQAHistoryCursor(page.next_cursor), {
    createdAtMs: Date.parse(entries[19]!.created_at),
    entryId: entries[19]!.entry_id,
  })

  const exactPage = normalizeV3BookQAHistoryPage(entries.slice(0, 20))
  assert.equal(exactPage.has_more, false)
  assert.equal(exactPage.next_cursor, null)
  assert.throws(() => normalizeV3BookQAHistoryPage(entries, 101))
})

function normalizedInput() {
  return normalizeV3BookQAHistoryCreateInput(createInput(), manifest())
}

class FakeHistoryAdapter implements V3BookQAHistoryStoreAdapter {
  readonly documents = new Map<string, Record<string, unknown>>()
  readonly writes: V3BookQAHistoryStoreDocument[][] = []
  readonly listQueries: V3BookQAHistoryStoreListQuery[] = []

  async readDocument(path: string): Promise<Record<string, unknown> | null> {
    return structuredClone(this.documents.get(path) ?? null)
  }

  async writeDocuments(documents: V3BookQAHistoryStoreDocument[]): Promise<void> {
    this.writes.push(structuredClone(documents))
    for (const document of documents) {
      const existing = this.documents.get(document.path)
      if (document.createOnly && existing) throw new Error("duplicate")
      this.documents.set(document.path, document.merge && existing
        ? { ...structuredClone(existing), ...structuredClone(document.data) }
        : structuredClone(document.data))
    }
  }

  async listDocuments(query: V3BookQAHistoryStoreListQuery): Promise<V3BookQAHistoryStoreListedDocument[]> {
    this.listQueries.push(structuredClone(query))
    const prefix = `${query.collectionPath}/`
    return [...this.documents.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .map(([path, data]) => ({ id: path.slice(prefix.length), data: structuredClone(data) }))
      .sort((left, right) => {
        const time = Date.parse(String(right.data.created_at)) - Date.parse(String(left.data.created_at))
        return time || right.id.localeCompare(left.id)
      })
      .filter((document) => {
        if (!query.cursor) return true
        const time = Date.parse(String(document.data.created_at))
        return time < query.cursor.createdAtMs
          || (time === query.cursor.createdAtMs && document.id < query.cursor.entryId)
      })
      .slice(0, query.limit)
  }

  async deleteDocument(path: string): Promise<boolean> {
    return this.documents.delete(path)
  }
}

test("store uses the isolated book path and persists reader position with atomic scope metadata", async () => {
  const adapter = new FakeHistoryAdapter()
  let sequence = 0
  const store = new V3BookQAHistoryStore({
    adapter,
    now: () => new Date(1_710_000_000_000 - sequence * 1_000),
    createEntryId: () => `entry-${String(++sequence).padStart(2, "0")}`,
  })
  const input = normalizedInput()
  const saved = await store.save(input)
  const scopeId = createV3BookQAHistoryScopeId(input.qaCorpusId)
  const root = `documents_v3/${input.docId}/book_qa_history/${scopeId}`
  const entryPath = `${root}/entries/entry-01`

  assert.equal(adapter.writes.length, 1)
  assert.deepEqual(adapter.writes[0]?.map(({ path }) => path), [root, entryPath])
  assert.equal(adapter.documents.get(root)?.qa_corpus_id, input.qaCorpusId)
  assert.equal(adapter.documents.get(root)?.schema_version, V3_BOOK_QA_HISTORY_SCHEMA_VERSION)
  assert.deepEqual(saved.reader_position, { chapter_id: "ch-two", pid: 2 })
  assert.deepEqual(adapter.documents.get(entryPath)?.reader_position, { chapter_id: "ch-two", pid: 2 })
  assert.equal(entryPath.includes("/qa_history/"), false)
})

test("store paginates newest entries at 20 and decodes the next cursor", async () => {
  const adapter = new FakeHistoryAdapter()
  let sequence = 0
  const store = new V3BookQAHistoryStore({
    adapter,
    createEntryId: () => `entry-${String(++sequence).padStart(2, "0")}`,
    now: () => new Date(1_710_000_000_000 - sequence * 1_000),
  })
  const input = normalizedInput()
  for (let index = 0; index < 21; index += 1) await store.save(input)

  const first = await store.list(normalizeV3BookQAHistoryScopeInput({
    source: "v3", docId: input.docId, qaCorpusId: input.qaCorpusId,
  }))
  assert.equal(first.entries.length, 20)
  assert.equal(first.has_more, true)
  assert.ok(first.next_cursor)
  assert.equal(adapter.listQueries[0]?.limit, 21)
  assert.deepEqual(adapter.listQueries[0]?.orderBy, [
    { field: "created_at", direction: "desc" },
    { field: "__name__", direction: "desc" },
  ])

  const second = await store.list(normalizeV3BookQAHistoryScopeInput({
    source: "v3",
    docId: input.docId,
    qaCorpusId: input.qaCorpusId,
    cursor: first.next_cursor!,
  }))
  assert.equal(second.entries.length, 1)
  assert.ok(adapter.listQueries[1]?.cursor)
})

test("store isolates corpus scopes and deletion fails closed on missing or mismatched ownership", async () => {
  const adapter = new FakeHistoryAdapter()
  let sequence = 0
  const store = new V3BookQAHistoryStore({
    adapter,
    createEntryId: () => `delete-${++sequence}`,
    now: () => new Date(1_710_000_000_000),
  })
  const input = normalizedInput()
  const saved = await store.save(input)
  const deletion = normalizeV3BookQAHistoryDeleteInput({
    source: "v3",
    docId: input.docId,
    qaCorpusId: input.qaCorpusId,
    entryId: saved.entry_id,
  })
  const scopeId = createV3BookQAHistoryScopeId(input.qaCorpusId)
  const root = `documents_v3/${input.docId}/book_qa_history/${scopeId}`
  const entryPath = `${root}/entries/${saved.entry_id}`

  adapter.documents.set(entryPath, { ...adapter.documents.get(entryPath)!, doc_id: "other-doc" })
  assert.equal(await store.delete(deletion), false)
  adapter.documents.set(entryPath, { ...adapter.documents.get(entryPath)!, doc_id: input.docId })
  assert.equal(await store.delete(deletion), true)
  assert.equal(await store.delete(deletion), false)

  const otherInput = { ...input, qaCorpusId: `${input.qaCorpusId}-other` }
  await store.save(otherInput)
  const otherScope = createV3BookQAHistoryScopeId(otherInput.qaCorpusId)
  const otherRoot = `documents_v3/${input.docId}/book_qa_history/${otherScope}`
  assert.notEqual(root, otherRoot)
  assert.equal(adapter.documents.get(root)?.qa_corpus_id, input.qaCorpusId)
  assert.equal(adapter.documents.get(otherRoot)?.qa_corpus_id, otherInput.qaCorpusId)
})

test("store rejects mismatched scope metadata and malformed stored rows", async () => {
  const input = normalizedInput()
  const scopeId = createV3BookQAHistoryScopeId(input.qaCorpusId)
  const root = `documents_v3/${input.docId}/book_qa_history/${scopeId}`

  const mismatched = new FakeHistoryAdapter()
  mismatched.documents.set(root, {
    schema_version: V3_BOOK_QA_HISTORY_SCHEMA_VERSION,
    scope_id: scopeId,
    doc_id: "other-doc",
    qa_corpus_id: input.qaCorpusId,
    updated_at: new Date().toISOString(),
  })
  await assert.rejects(
    new V3BookQAHistoryStore({ adapter: mismatched }).save(input),
    (error: unknown) => error instanceof V3BookQAHistoryStoreIntegrityError,
  )

  const malformed = new FakeHistoryAdapter()
  malformed.documents.set(root, {
    schema_version: V3_BOOK_QA_HISTORY_SCHEMA_VERSION,
    scope_id: scopeId,
    doc_id: input.docId,
    qa_corpus_id: input.qaCorpusId,
    updated_at: new Date().toISOString(),
  })
  malformed.documents.set(`${root}/entries/bad-entry`, {
    ...storedEntry(),
    entry_id: "different-entry",
  })
  await assert.rejects(
    new V3BookQAHistoryStore({ adapter: malformed }).list(normalizeV3BookQAHistoryScopeInput({
      source: "v3", docId: input.docId, qaCorpusId: input.qaCorpusId,
    })),
    (error: unknown) => error instanceof V3BookQAHistoryStoreIntegrityError,
  )
})

test("store propagates unexpected adapter failures", async () => {
  const failure = new Error("storage unavailable")
  const adapter: V3BookQAHistoryStoreAdapter = {
    readDocument: async () => { throw failure },
    writeDocuments: async () => { throw new Error("unexpected write") },
    listDocuments: async () => { throw new Error("unexpected list") },
    deleteDocument: async () => { throw new Error("unexpected delete") },
  }
  const input = normalizedInput()
  await assert.rejects(
    new V3BookQAHistoryStore({ adapter }).list(normalizeV3BookQAHistoryScopeInput({
      source: "v3", docId: input.docId, qaCorpusId: input.qaCorpusId,
    })),
    (error: unknown) => error === failure,
  )
})

function request(method: string, body?: unknown, query = ""): Request {
  return new Request(`http://localhost/api/v3/book-qa-history${query}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined
      ? {}
      : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  })
}

function routeDependencies(overrides: Record<string, unknown> = {}) {
  return {
    loadCorpus: async () => corpus(),
    save: async (input: ReturnType<typeof normalizedInput>) => ({
      schema_version: V3_BOOK_QA_HISTORY_SCHEMA_VERSION,
      entry_id: "entry-route",
      doc_id: input.docId,
      qa_corpus_id: input.qaCorpusId,
      reader_position: input.readerPosition,
      question: input.question,
      answer_snapshot: input.answer_snapshot,
      created_at: new Date(1_710_000_000_000).toISOString(),
    }),
    list: async () => ({ entries: [], next_cursor: null, has_more: false }),
    delete: async () => true,
    ...overrides,
  }
}

test("route POST validates the exact corpus before saving the reader-position snapshot", async () => {
  const saves: Array<ReturnType<typeof normalizedInput>> = []
  const handlers = createV3BookQAHistoryRouteHandlers(routeDependencies({
    save: async (input: ReturnType<typeof normalizedInput>) => {
      saves.push(input)
      return storedEntry()
    },
  }))
  const response = await handlers.POST(request("POST", createInput()))
  assert.equal(response.status, 200)
  assert.equal(saves.length, 1)
  assert.deepEqual(saves[0]!.readerPosition, { chapter_id: "ch-two", pid: 2 })
  assert.deepEqual((await response.json() as V3BookQAHistoryEntry).reader_position, {
    chapter_id: "ch-two",
    pid: 2,
  })
})

test("route rejects a future snapshot with 400 and does not save", async () => {
  const snapshot = answerSnapshot()
  snapshot.retrieval.hits[1]!.text_span = { start_pid: 3, end_pid: 3 }
  snapshot.retrieval.hits[1]!.pid = 3
  snapshot.answer.citations[1]!.pid = 3
  let saves = 0
  let corpusLoads = 0
  const handlers = createV3BookQAHistoryRouteHandlers(routeDependencies({
    loadCorpus: async () => { corpusLoads += 1; return corpus() },
    save: async () => { saves += 1; return storedEntry() },
  }))
  const response = await handlers.POST(request("POST", createInput(snapshot)))
  assert.equal(response.status, 400)
  assert.equal(corpusLoads, 1)
  assert.equal(saves, 0)
})

test("route maps corpus, cursor, delete, integrity, and infrastructure outcomes", async (t) => {
  await t.test("unknown corpus 404", async () => {
    const handlers = createV3BookQAHistoryRouteHandlers(routeDependencies({ loadCorpus: async () => null }))
    assert.equal((await handlers.POST(request("POST", createInput()))).status, 404)
  })
  await t.test("invalid cursor 400", async () => {
    const handlers = createV3BookQAHistoryRouteHandlers(routeDependencies())
    const input = createInput()
    assert.equal((await handlers.GET(request(
      "GET",
      undefined,
      `?source=v3&docId=${input.docId}&qaCorpusId=${input.qaCorpusId}&cursor=bad`,
    ))).status, 400)
  })
  await t.test("delete miss 404", async () => {
    const handlers = createV3BookQAHistoryRouteHandlers(routeDependencies({ delete: async () => false }))
    const input = createInput()
    assert.equal((await handlers.DELETE(request("DELETE", {
      source: "v3",
      docId: input.docId,
      qaCorpusId: input.qaCorpusId,
      entryId: "missing",
    }))).status, 404)
  })
  await t.test("immutable corpus 409", async () => {
    const handlers = createV3BookQAHistoryRouteHandlers(routeDependencies({
      loadCorpus: async () => { throw new V3BookQACorpusImmutableConflictError("corpus") },
    }))
    assert.equal((await handlers.POST(request("POST", createInput()))).status, 409)
  })
  await t.test("malformed corpus 409", async () => {
    const handlers = createV3BookQAHistoryRouteHandlers(routeDependencies({
      loadCorpus: async () => corpus({ manifest: { ...manifest(), doc_id: "tampered" } }),
    }))
    assert.equal((await handlers.POST(request("POST", createInput()))).status, 409)
  })
  await t.test("history integrity 409", async () => {
    const handlers = createV3BookQAHistoryRouteHandlers(routeDependencies({
      list: async () => { throw new V3BookQAHistoryStoreIntegrityError("bad row") },
    }))
    const input = createInput()
    assert.equal((await handlers.GET(request(
      "GET",
      undefined,
      `?source=v3&docId=${input.docId}&qaCorpusId=${input.qaCorpusId}`,
    ))).status, 409)
  })
  await t.test("unexpected infrastructure 500", async () => {
    const handlers = createV3BookQAHistoryRouteHandlers(routeDependencies({
      save: async () => { throw new Error("database unavailable") },
    }))
    assert.equal((await handlers.POST(request("POST", createInput()))).status, 500)
  })
  await t.test("invalid JSON 400", async () => {
    const handlers = createV3BookQAHistoryRouteHandlers(routeDependencies())
    assert.equal((await handlers.POST(request("POST", "{"))).status, 400)
  })
})

test("route GET returns the injected paginated result", async () => {
  const expected = { entries: [storedEntry()], next_cursor: "next", has_more: true }
  const handlers = createV3BookQAHistoryRouteHandlers(routeDependencies({ list: async () => expected }))
  const input = createInput()
  const response = await handlers.GET(request(
    "GET",
    undefined,
    `?source=v3&docId=${input.docId}&qaCorpusId=${input.qaCorpusId}`,
  ))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), expected)
})

test("typed client helpers use only the book-history endpoint and source v3", async () => {
  const originalFetch = globalThis.fetch
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const entry = storedEntry()
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    if (init?.method === "POST") return Response.json(entry)
    if (init?.method === "DELETE") return Response.json({ ok: true })
    return Response.json({ entries: [entry], next_cursor: null, has_more: false })
  }) as typeof fetch

  try {
    const input = createInput()
    assert.equal((await listV3BookQAHistory({
      docId: input.docId,
      qaCorpusId: input.qaCorpusId,
      cursor: "cursor",
    })).entries[0]?.entry_id, entry.entry_id)
    assert.equal((await saveV3BookQAHistory({
      docId: input.docId,
      qaCorpusId: input.qaCorpusId,
      question: input.question,
      readerPosition: input.readerPosition,
      answerSnapshot: input.answerSnapshot,
    })).entry_id, entry.entry_id)
    await deleteV3BookQAHistory({
      docId: input.docId,
      qaCorpusId: input.qaCorpusId,
      entryId: entry.entry_id,
    })
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(calls.length, 3)
  assert.match(calls[0]!.url, /^\/api\/v3\/book-qa-history\?/)
  assert.match(calls[0]!.url, /source=v3/)
  assert.equal(calls[1]!.url, "/api/v3/book-qa-history")
  assert.equal(JSON.parse(String(calls[1]!.init?.body)).source, "v3")
  assert.equal(calls[2]!.url, "/api/v3/book-qa-history")
  assert.equal(JSON.parse(String(calls[2]!.init?.body)).source, "v3")
})
