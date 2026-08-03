import test from "node:test"
import assert from "node:assert/strict"

import {
  V3_QA_HISTORY_PAGE_SIZE,
  type V3QAHistoryAnswerSnapshot,
} from "../src/lib/v3-qa-history-types.ts"
import {
  createV3QAHistoryScopeId,
  decodeV3QAHistoryCursor,
  encodeV3QAHistoryCursor,
  normalizeV3QAHistoryCreateInput,
  normalizeV3QAHistoryPage,
  normalizeV3QAHistoryStoredEntry,
  validateV3QAHistoryCreateSource,
  V3QA_HISTORY_MAX_BYTES,
} from "../src/lib/server/v3-qa-history.ts"

const validQuestion = "What happened in the hall at the party?"

function baseCreateInput(status: "answered" | "insufficient_evidence") {
  return {
    source: "v3" as const,
    docId: "doc-1",
    chapterId: "chapter-1",
    runId: "run-1",
    question: validQuestion,
    progressEndPid: 4,
    answerSnapshot: {
      answer: {
        status,
        text: status === "answered" ? "They entered the hall together." : "",
        citations: status === "answered"
          ? [{ pid: 4, paragraph_text: "Bob follows." }]
          : [],
        used_evidence: status === "answered"
          ? [{ evidence_id: "E1", record_id: "event-1", record_type: "event" as const, label: "Entering the hall" }]
          : [],
      },
      retrieval: {
        stats: {
          total_records: 3,
          searched_records: 3,
          blocked_ahead_records: 0,
          direct_hits: 2,
          lexical_hits: 2,
          semantic_hits: 1,
          graph_neighbor_hits: 0,
          returned_hits: 2,
        },
        hits: [
          {
            record_id: "event-1",
            record_type: "event" as const,
            label: "Alice enters",
            text: "Alice enters.",
            score: 0.91,
            match_kind: "hybrid" as const,
            text_span: { start_pid: 2, end_pid: 2 },
            progress_status: "available" as const,
            evidence_refs: ["E1"],
            matched_terms: ["hall"],
          },
          {
            record_id: "event-2",
            record_type: "event" as const,
            label: "Bob follows",
            text: "Bob follows.",
            score: 0.86,
            match_kind: "lexical" as const,
            text_span: { start_pid: 4, end_pid: 4 },
            progress_status: "available" as const,
            evidence_refs: ["E2"],
            matched_terms: ["party"],
          },
        ],
      },
    } satisfies V3QAHistoryAnswerSnapshot,
  }
}

test("V3_QA_HISTORY_PAGE_SIZE is 20", () => {
  assert.equal(V3_QA_HISTORY_PAGE_SIZE, 20)
})

test("createV3QAHistoryScopeId is deterministic and isolates chapter/run", () => {
  assert.equal(createV3QAHistoryScopeId("chapter-1", "run-1"), createV3QAHistoryScopeId("chapter-1", "run-1"))
  assert.notEqual(createV3QAHistoryScopeId("chapter-1", "run-1"), createV3QAHistoryScopeId("chapter-2", "run-1"))
  assert.notEqual(createV3QAHistoryScopeId("chapter-1", "run-1"), createV3QAHistoryScopeId("chapter-1", "run-2"))
})

test("cursor encoding/decoding roundtrips and invalid cursor throws", () => {
  const cursor = encodeV3QAHistoryCursor({
    createdAtMs: 1710000000000,
    entryId: "entry-1",
  })

  assert.equal(decodeV3QAHistoryCursor(cursor)?.createdAtMs, 1710000000000)
  assert.equal(decodeV3QAHistoryCursor(cursor)?.entryId, "entry-1")
  assert.equal(decodeV3QAHistoryCursor("not-a-cursor"), null)
})

test("v3 qa history create input rejects non-v3 source", () => {
  assert.throws(() => validateV3QAHistoryCreateSource("current"))
})

test("normalizeV3QAHistoryCreateInput accepts answered snapshots", () => {
  const normalized = normalizeV3QAHistoryCreateInput(baseCreateInput("answered"))

  assert.equal(normalized.source, "v3")
  assert.equal(normalized.question, validQuestion)
  assert.equal(normalized.answer_snapshot.answer.status, "answered")
})

test("normalizeV3QAHistoryCreateInput accepts insufficient_evidence snapshots", () => {
  const normalized = normalizeV3QAHistoryCreateInput(baseCreateInput("insufficient_evidence"))

  assert.equal(normalized.answer_snapshot.answer.status, "insufficient_evidence")
})

test("legacy 0.1 stored history entries remain parseable unchanged", () => {
  const fixture = {
    schema_version: "v3-qa-history-0.1" as const,
    entry_id: "legacy-entry",
    doc_id: "doc-1",
    chapter_id: "chapter-1",
    run_id: "run-1",
    question: validQuestion,
    progress_end_pid: 4,
    answer_snapshot: baseCreateInput("answered").answerSnapshot,
    created_at: new Date(1_710_000_000_000).toISOString(),
  }

  assert.deepEqual(normalizeV3QAHistoryStoredEntry(fixture), fixture)
})

test("normalizeV3QAHistoryCreateInput accepts paragraph evidence without changing history scope", () => {
  const base = baseCreateInput("answered")
  const input = {
    ...base,
    answerSnapshot: {
      answer: {
        ...base.answerSnapshot.answer,
        used_evidence: [{
          evidence_id: "paragraph-2",
          record_id: "PARAGRAPH_para_0002",
          record_type: "paragraph",
          label: "Paragraph P2",
        }],
      },
      retrieval: {
        ...base.answerSnapshot.retrieval,
        hits: [{
          ...base.answerSnapshot.retrieval.hits[0],
          record_id: "PARAGRAPH_para_0002",
          record_type: "paragraph",
          label: "Paragraph P2",
          text_span: { start_pid: 2, end_pid: 2 },
        }],
      },
    },
  }

  const normalized = normalizeV3QAHistoryCreateInput(input)

  assert.equal(normalized.chapterId, "chapter-1")
  assert.equal(normalized.runId, "run-1")
  assert.equal(normalized.answer_snapshot.answer.used_evidence[0]?.record_type, "paragraph")
  assert.equal(normalized.answer_snapshot.retrieval.hits[0]?.record_type, "paragraph")
})

test("normalizeV3QAHistoryCreateInput rejects hits beyond progress boundary", () => {
  const input = baseCreateInput("answered")
  input.answerSnapshot.retrieval.hits[1].text_span.end_pid = 6

  assert.throws(() => normalizeV3QAHistoryCreateInput(input))
})

test("normalizeV3QAHistoryCreateInput rejects oversized answer snapshots", () => {
  const input = baseCreateInput("answered")
  const largeButIndividuallyValid = "x".repeat(190_000)
  input.answerSnapshot.answer.text = largeButIndividuallyValid
  input.answerSnapshot.retrieval.hits = Array.from({ length: 4 }, (_, index) => ({
    ...input.answerSnapshot.retrieval.hits[0],
    record_id: `event-large-${index}`,
    text: largeButIndividuallyValid,
  }))

  assert.throws(
    () => normalizeV3QAHistoryCreateInput(input),
    new RegExp(`too large|${V3QA_HISTORY_MAX_BYTES}`),
  )
})

test("normalizeV3QAHistoryPage converts 21 ordered rows into 20-item page", () => {
  const entries = Array.from({ length: 21 }, (_, i) => ({
    schema_version: "v3-qa-history-0.1" as const,
    entry_id: `entry-${i + 1}`,
    doc_id: "doc-1",
    chapter_id: "chapter-1",
    run_id: "run-1",
    question: `Q${i + 1}`,
    progress_end_pid: 1,
    answer_snapshot: {
      answer: {
        status: "answered",
        text: "a",
        citations: [{ pid: 1, paragraph_text: "a" }],
        used_evidence: [],
      },
      retrieval: {
        stats: {
          total_records: 0,
          searched_records: 0,
          blocked_ahead_records: 0,
          direct_hits: 0,
          lexical_hits: 0,
          semantic_hits: 0,
          graph_neighbor_hits: 0,
          returned_hits: 0,
        },
        hits: [],
      },
    } as V3QAHistoryAnswerSnapshot,
    created_at: new Date(1700000000000 - i).toISOString(),
  }))

  const page = normalizeV3QAHistoryPage(entries, V3_QA_HISTORY_PAGE_SIZE)

  assert.equal(page.entries.length, V3_QA_HISTORY_PAGE_SIZE)
  assert.equal(page.has_more, true)
  assert.equal(page.entries[page.entries.length - 1]?.entry_id, "entry-20")
  assert.ok(page.next_cursor)
})

test("normalizeV3QAHistoryPage hides pagination at exactly 20 rows", () => {
  const entries = Array.from({ length: 20 }, (_, i) => ({
    schema_version: "v3-qa-history-0.1" as const,
    entry_id: `entry-${i + 1}`,
    doc_id: "doc-1",
    chapter_id: "chapter-1",
    run_id: "run-1",
    question: `Q${i + 1}`,
    progress_end_pid: 1,
    answer_snapshot: baseCreateInput("insufficient_evidence").answerSnapshot,
    created_at: new Date(1700000000000 - i).toISOString(),
  }))

  const page = normalizeV3QAHistoryPage(entries)

  assert.equal(page.entries.length, 20)
  assert.equal(page.has_more, false)
  assert.equal(page.next_cursor, null)
})
