import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"

import { buildV3BookQACorpusManifest } from "../src/lib/pipeline/v3-book-qa-corpus.ts"
import type { V3BookQACorpusManifest } from "../src/lib/pipeline/v3-book-qa-types.ts"
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
