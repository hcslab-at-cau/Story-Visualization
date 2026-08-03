import test from "node:test"
import assert from "node:assert/strict"
import {
  buildV3BookQAAnswerContext,
  normalizeV3BookQAGroundedAnswer,
} from "../src/lib/pipeline/v3-book-qa-answer.ts"
import { buildV3BookQACorpusManifest } from "../src/lib/pipeline/v3-book-qa-corpus.ts"
import type { V3BookQARetrievalHit } from "../src/lib/pipeline/v3-book-qa-retrieval.ts"
import { parseV3BookQAAnswerRequest } from "../src/app/api/pipeline/v3-book-qa-answer/route.ts"
import { V3BookQARequestError } from "../src/lib/server/v3-book-qa-retrieval-service.ts"

function manifest() {
  return buildV3BookQACorpusManifest({
    docId: "doc-one",
    chapters: [
      {
        chapter_id: "ch-one",
        chapter_title: "Chapter One",
        chapter_index: 1,
        run_id: "run-one",
        progress_end_pid: 2,
        artifact_ids: {},
      },
      {
        chapter_id: "ch-two",
        chapter_title: "Chapter Two",
        chapter_index: 2,
        run_id: "run-two",
        progress_end_pid: 3,
        artifact_ids: {},
      },
      {
        chapter_id: "ch-three",
        chapter_title: "Chapter Three",
        chapter_index: 3,
        run_id: "run-three",
        progress_end_pid: 1,
        artifact_ids: {},
      },
    ],
  })
}

function hit(params: {
  chapterId: string
  chapterTitle: string
  chapterIndex: number
  localId: string
  startPid: number
  endPid?: number
  label?: string
}): V3BookQARetrievalHit {
  return {
    record_id: `${params.chapterId}:${params.localId}`,
    local_record_id: params.localId,
    record_type: "paragraph",
    chapter_id: params.chapterId,
    chapter_title: params.chapterTitle,
    chapter_index: params.chapterIndex,
    label: params.label ?? params.localId,
    text: params.label ?? params.localId,
    score: 1,
    match_kind: "hybrid",
    text_span: {
      start_pid: params.startPid,
      end_pid: params.endPid ?? params.startPid,
    },
    ...(params.endPid === undefined ? { pid: params.startPid } : {}),
    progress_status: "available",
    evidence_refs: [],
    matched_terms: [],
  }
}

const chapterParagraphs = [
  {
    chapter_id: "ch-one",
    chapter_title: "Chapter One",
    paragraphs: [
      { pid: 0, text: "Alice ate cake." },
      { pid: 1, text: "She drank tea." },
      { pid: 2, text: "The door closed." },
    ],
  },
  {
    chapter_id: "ch-two",
    chapter_title: "Chapter Two",
    paragraphs: [
      { pid: 0, text: "Alice remembered breakfast." },
      { pid: 1, text: "Bob arrived." },
      { pid: 2, text: "A future sentence." },
      { pid: 3, text: "A later future sentence." },
    ],
  },
  {
    chapter_id: "ch-three",
    chapter_title: "Chapter Three",
    paragraphs: [{ pid: 0, text: "This whole chapter is in the future." }],
  },
]

test("associates each hit only with same-chapter paragraph tuples when PIDs repeat", () => {
  const context = buildV3BookQAAnswerContext({
    question: "What did Alice eat?",
    manifest: manifest(),
    readerPosition: { chapter_id: "ch-two", pid: 1 },
    chapterParagraphs,
    hits: [
      hit({ chapterId: "ch-one", chapterTitle: "Chapter One", chapterIndex: 1, localId: "P0", startPid: 0 }),
      hit({ chapterId: "ch-two", chapterTitle: "Chapter Two", chapterIndex: 2, localId: "P0", startPid: 0 }),
    ],
  })

  assert.deepEqual(context.paragraphs.map((paragraph) => [paragraph.chapter_id, paragraph.pid]), [
    ["ch-one", 0],
    ["ch-two", 0],
  ])
  assert.deepEqual(context.evidence.map((evidence) => evidence.paragraph_refs), [
    [{ chapter_id: "ch-one", pid: 0 }],
    [{ chapter_id: "ch-two", pid: 0 }],
  ])
  assert.deepEqual(context.evidence.map((evidence) => evidence.evidence_id), ["E1", "E2"])
})

test("drops future-chapter, current-suffix, and mismatched namespace hits before context creation", () => {
  const context = buildV3BookQAAnswerContext({
    question: "What is known?",
    manifest: manifest(),
    readerPosition: { chapter_id: "ch-two", pid: 1 },
    chapterParagraphs,
    hits: [
      hit({ chapterId: "ch-three", chapterTitle: "Chapter Three", chapterIndex: 3, localId: "future", startPid: 0 }),
      hit({ chapterId: "ch-two", chapterTitle: "Chapter Two", chapterIndex: 2, localId: "suffix", startPid: 2 }),
      { ...hit({ chapterId: "ch-one", chapterTitle: "Chapter One", chapterIndex: 1, localId: "bad", startPid: 0 }), record_id: "ch-two:bad" },
      hit({ chapterId: "ch-one", chapterTitle: "Wrong title", chapterIndex: 1, localId: "wrong-title", startPid: 0 }),
      hit({ chapterId: "ch-one", chapterTitle: "Chapter One", chapterIndex: 1, localId: "safe", startPid: 1 }),
    ],
  })

  assert.deepEqual(context.evidence.map((evidence) => evidence.record_id), ["ch-one:safe"])
  assert.deepEqual(context.paragraphs.map((paragraph) => [paragraph.chapter_id, paragraph.pid]), [["ch-one", 1]])
})

test("keeps only whole source paragraphs within deterministic context and evidence budgets", () => {
  const context = buildV3BookQAAnswerContext({
    question: "What happened?",
    manifest: manifest(),
    readerPosition: { chapter_id: "ch-one", pid: 2 },
    chapterParagraphs: [{
      chapter_id: "ch-one",
      chapter_title: "Chapter One",
      paragraphs: [
        { pid: 0, text: "12345" },
        { pid: 1, text: "abcdef" },
      ],
    }],
    hits: [hit({
      chapterId: "ch-one",
      chapterTitle: "Chapter One",
      chapterIndex: 1,
      localId: "span",
      startPid: 0,
      endPid: 1,
    })],
    maxParagraphChars: 5,
    maxEvidenceChars: 5,
  })

  assert.deepEqual(context.paragraphs.map((paragraph) => paragraph.text), ["12345"])
  assert.equal(context.evidence[0].text, "12345")
  assert.deepEqual(context.evidence[0].paragraph_refs, [{ chapter_id: "ch-one", pid: 0 }])
  assert.equal(context.evidence[0].text.includes("abcd"), false)
})

function answerContext() {
  return buildV3BookQAAnswerContext({
    question: "What connects the scenes?",
    manifest: manifest(),
    readerPosition: { chapter_id: "ch-two", pid: 1 },
    chapterParagraphs,
    hits: [
      hit({ chapterId: "ch-one", chapterTitle: "Chapter One", chapterIndex: 1, localId: "cake", startPid: 0 }),
      hit({ chapterId: "ch-two", chapterTitle: "Chapter Two", chapterIndex: 2, localId: "memory", startPid: 0 }),
    ],
  })
}

test("normalizes valid cross-chapter citations using chapter and PID identity", () => {
  const answer = normalizeV3BookQAGroundedAnswer({
    raw: {
      status: "answered",
      answer: "She ate cake and later remembered it.",
      citation_refs: [
        { chapter_id: "ch-one", pid: 0 },
        { chapter_id: "ch-two", pid: 0 },
        { chapter_id: "ch-one", pid: 0 },
      ],
      used_evidence_ids: ["E1", "E2", "E1"],
    },
    context: answerContext(),
  })

  assert.equal(answer.status, "answered")
  assert.deepEqual(answer.citations.map((citation) => [citation.chapter_id, citation.pid]), [
    ["ch-one", 0],
    ["ch-two", 0],
  ])
  assert.deepEqual(answer.used_evidence.map((evidence) => evidence.evidence_id), ["E1", "E2"])
})

test("downgrades the entire answer for unknown, future, cross-associated, or malformed support", async (t) => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["unknown tuple", {
      status: "answered",
      answer: "Unsupported",
      citation_refs: [{ chapter_id: "ch-one", pid: 99 }],
      used_evidence_ids: ["E1"],
    }],
    ["future tuple", {
      status: "answered",
      answer: "Future",
      citation_refs: [{ chapter_id: "ch-three", pid: 0 }],
      used_evidence_ids: ["E1"],
    }],
    ["cross-associated tuple", {
      status: "answered",
      answer: "Wrong chapter",
      citation_refs: [{ chapter_id: "ch-two", pid: 0 }],
      used_evidence_ids: ["E1"],
    }],
    ["unknown evidence", {
      status: "answered",
      answer: "Unknown evidence",
      citation_refs: [{ chapter_id: "ch-one", pid: 0 }],
      used_evidence_ids: ["E99"],
    }],
    ["selected evidence without citation support", {
      status: "answered",
      answer: "Extra evidence",
      citation_refs: [{ chapter_id: "ch-one", pid: 0 }],
      used_evidence_ids: ["E1", "E2"],
    }],
    ["malformed citation object", {
      status: "answered",
      answer: "Malformed",
      citation_refs: [{ chapter_id: "ch-one", pid: 0, extra: true }],
      used_evidence_ids: ["E1"],
    }],
  ]

  for (const [name, raw] of cases) {
    await t.test(name, () => {
      assert.deepEqual(normalizeV3BookQAGroundedAnswer({ raw, context: answerContext() }), {
        status: "insufficient_evidence",
        text: "",
        citations: [],
        used_evidence: [],
      })
    })
  }
})

test("accepts only the exact v3 book-answer request contract", () => {
  assert.deepEqual(parseV3BookQAAnswerRequest({
    source: "v3",
    docId: "doc-one",
    qaCorpusId: "BOOK1_abc",
    question: "What happened?",
    readerPosition: { chapter_id: "ch-two", pid: 1 },
    limit: 4,
    model: "openai/gpt-4o-mini",
  }), {
    source: "v3",
    docId: "doc-one",
    qaCorpusId: "BOOK1_abc",
    question: "What happened?",
    readerPosition: { chapter_id: "ch-two", pid: 1 },
    limit: 4,
    model: "openai/gpt-4o-mini",
  })

  for (const invalid of [
    { source: "current", docId: "doc-one", qaCorpusId: "BOOK1_abc", question: "Q", readerPosition: { chapter_id: "ch-two", pid: 1 } },
    { source: "v3", docId: "doc-one", qaCorpusId: "BOOK1_abc", question: "Q", readerPosition: { chapter_id: "ch-two", pid: 1 }, extra: true },
    { source: "v3", docId: "doc-one", qaCorpusId: "BOOK1_abc", question: "Q", readerPosition: { chapter_id: "ch-two", pid: 1, scene_id: "future" } },
    { source: "v3", docId: "doc-one", qaCorpusId: "BOOK1_abc", question: "Q", readerPosition: { chapter_id: "ch-two", pid: 1 }, limit: 0 },
  ]) {
    assert.throws(
      () => parseV3BookQAAnswerRequest(invalid),
      (error: unknown) => error instanceof V3BookQARequestError && error.status === 400,
    )
  }
})
