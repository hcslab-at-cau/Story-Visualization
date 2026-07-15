import assert from "node:assert/strict"
import test from "node:test"
import {
  buildV3QAAnswerContext,
  filterV3QAProgressSafeHits,
  normalizeV3QAGroundedAnswer,
} from "../src/lib/pipeline/v3-qa-answer.ts"
import type { V3QARetrievalHit } from "../src/lib/pipeline/v3-qa-retrieval-types.ts"
import type { Paragraph } from "../src/types/schema.ts"

function hit(
  recordId: string,
  label: string,
  startPid?: number,
  endPid?: number,
): V3QARetrievalHit {
  return {
    record_id: recordId,
    record_type: "scene",
    label,
    text: `${label} retrieval summary`,
    score: 1,
    match_kind: "hybrid",
    ...(typeof startPid === "number" && typeof endPid === "number"
      ? { text_span: { start_pid: startPid, end_pid: endPid } }
      : {}),
    progress_status: "available",
    evidence_refs: [],
    matched_terms: [],
  }
}

const paragraphs: Paragraph[] = [
  { pid: 1, start: 0, end: 34, text: "Alice was bored beside her sister." },
  { pid: 2, start: 35, end: 68, text: "A White Rabbit ran close by her." },
  { pid: 3, start: 69, end: 113, text: "Curiosity made Alice run after the Rabbit." },
  { pid: 4, start: 114, end: 159, text: "Alice followed it down the rabbit-hole." },
  { pid: 5, start: 160, end: 184, text: "She landed in a hall." },
]

test("answer UI safety filter rejects missing and ahead-of-progress hit spans", () => {
  assert.deepEqual(
    filterV3QAProgressSafeHits([
      hit("SC_SAFE", "Safe", 1, 2),
      hit("SC_AHEAD", "Ahead", 2, 4),
      hit("SC_UNKNOWN", "Unknown"),
    ], 3).map((item) => item.record_id),
    ["SC_SAFE"],
  )
})

test("answer context includes only ranked-hit source paragraphs within reader progress", () => {
  const crossingHit = hit("SC_FOLLOW", "Following the Rabbit", 2, 4)
  crossingHit.text = "This generated summary includes an unread P4 detail."
  const context = buildV3QAAnswerContext({
    question: "Why did Alice follow the Rabbit?",
    progressEndPid: 3,
    paragraphs,
    hits: [
      crossingHit,
      hit("SC_HALL", "Landing in the hall", 5, 5),
      hit("CHAR_UNKNOWN", "Unknown character"),
    ],
  })

  assert.deepEqual(context.paragraphs.map((paragraph) => paragraph.pid), [2, 3])
  assert.deepEqual(context.evidence.map((evidence) => evidence.record_id), ["SC_FOLLOW"])
  assert.equal(context.evidence[0]?.evidence_id, "E1")
  assert.equal(context.evidence[0]?.paragraph_pids.join(","), "2,3")
  assert.equal(context.evidence[0]?.label, "scene evidence")
  assert.equal(context.evidence[0]?.text, `${paragraphs[1]!.text}\n${paragraphs[2]!.text}`)
  assert.equal(context.evidence[0]?.text.includes("unread P4"), false)
  assert.equal(context.paragraphs.some((paragraph) => paragraph.pid > 3), false)
})

test("answer context keeps whole paragraphs while enforcing its character budget", () => {
  const context = buildV3QAAnswerContext({
    question: "What happened?",
    progressEndPid: 4,
    paragraphs,
    hits: [hit("SC_FOLLOW", "Following the Rabbit", 1, 4)],
    maxParagraphChars: paragraphs[0]!.text.length + 1,
  })

  assert.deepEqual(context.paragraphs, [paragraphs[0]])
  assert.equal(context.paragraphs[0]?.text.endsWith("sister."), true)
})

test("answer normalization rejects a response containing fabricated support", () => {
  const context = buildV3QAAnswerContext({
    question: "Why did Alice follow the Rabbit?",
    progressEndPid: 3,
    paragraphs,
    hits: [hit("SC_FOLLOW", "Following the Rabbit", 2, 3)],
  })

  const answer = normalizeV3QAGroundedAnswer({
    raw: {
      status: "answered",
      answer: "Alice followed because she was curious.",
      citation_pids: [3, 99],
      used_evidence_ids: ["E1", "E99"],
    },
    context,
  })

  assert.equal(answer.status, "insufficient_evidence")
  assert.equal(answer.text, "")
  assert.deepEqual(answer.citations, [])
  assert.deepEqual(answer.used_evidence, [])
})

test("answer normalization keeps a fully valid paragraph and evidence citation", () => {
  const context = buildV3QAAnswerContext({
    question: "Why did Alice follow the Rabbit?",
    progressEndPid: 3,
    paragraphs,
    hits: [hit("SC_FOLLOW", "Following the Rabbit", 2, 3)],
  })

  const answer = normalizeV3QAGroundedAnswer({
    raw: {
      status: "answered",
      answer: "Alice followed because she was curious.",
      citation_pids: [3],
      used_evidence_ids: ["E1"],
    },
    context,
  })

  assert.equal(answer.status, "answered")
  assert.equal(answer.text, "Alice followed because she was curious.")
  assert.deepEqual(answer.citations.map((citation) => citation.pid), [3])
  assert.deepEqual(answer.used_evidence.map((evidence) => evidence.evidence_id), ["E1"])
})

test("answer normalization discards model text for insufficient evidence", () => {
  const context = buildV3QAAnswerContext({
    question: "Who is the Queen?",
    progressEndPid: 2,
    paragraphs,
    hits: [hit("SC_BANK", "River bank", 1, 2)],
  })

  const answer = normalizeV3QAGroundedAnswer({
    raw: {
      status: "insufficient_evidence",
      answer: "You have not reached the Queen's scene yet.",
      citation_pids: [],
      used_evidence_ids: [],
    },
    context,
  })

  assert.equal(answer.status, "insufficient_evidence")
  assert.equal(answer.text, "")
  assert.deepEqual(answer.citations, [])
  assert.deepEqual(answer.used_evidence, [])
})

test("answer normalization downgrades an answer with fabricated support", () => {
  const context = buildV3QAAnswerContext({
    question: "Who is the Queen?",
    progressEndPid: 2,
    paragraphs,
    hits: [hit("SC_BANK", "River bank", 1, 2)],
  })

  const answer = normalizeV3QAGroundedAnswer({
    raw: {
      status: "answered",
      answer: "The Queen rules Wonderland.",
      citation_pids: [20],
      used_evidence_ids: ["E20"],
    },
    context,
  })

  assert.equal(answer.status, "insufficient_evidence")
  assert.equal(answer.text, "")
  assert.deepEqual(answer.citations, [])
  assert.deepEqual(answer.used_evidence, [])
})

test("answer normalization requires cited paragraphs and evidence records to agree", () => {
  const context = buildV3QAAnswerContext({
    question: "What happened first?",
    progressEndPid: 3,
    paragraphs,
    hits: [
      hit("SC_RABBIT", "Rabbit appears", 2, 2),
      hit("SC_FOLLOW", "Alice follows", 3, 3),
    ],
  })

  const answer = normalizeV3QAGroundedAnswer({
    raw: {
      status: "answered",
      answer: "The Rabbit appeared first.",
      citation_pids: [2],
      used_evidence_ids: ["E2"],
    },
    context,
  })

  assert.equal(answer.status, "insufficient_evidence")
  assert.deepEqual(answer.citations, [])
  assert.deepEqual(answer.used_evidence, [])
})
