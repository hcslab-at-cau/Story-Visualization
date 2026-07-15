import test from "node:test"
import assert from "node:assert/strict"
import { buildBodySegments, type V3BodyHighlight } from "../src/components/v3/v3-body-result-utils.ts"

function highlight(
  id: string,
  startChar: number,
  endChar: number,
): V3BodyHighlight {
  return {
    id,
    pid: 1,
    startChar,
    endChar,
    label: id,
    tone: "cast",
  }
}

test("buildBodySegments keeps valid highlights in body order", () => {
  const segments = buildBodySegments("Alice follows rabbit", [
    highlight("alice", 0, 5),
    highlight("rabbit", 14, 20),
    highlight("invalid", 40, 45),
  ])

  assert.deepEqual(
    segments.map((segment) => [segment.kind, segment.text]),
    [
      ["highlight", "Alice"],
      ["text", " follows "],
      ["highlight", "rabbit"],
    ],
  )
})

test("buildBodySegments skips overlapping highlights and prefers the widest same-start span", () => {
  const segments = buildBodySegments("Alice", [
    highlight("short", 0, 3),
    highlight("wide", 0, 5),
    highlight("overlap", 1, 4),
  ])

  assert.deepEqual(
    segments.map((segment) => [segment.kind, segment.text, segment.kind === "highlight" ? segment.highlight.id : ""]),
    [["highlight", "Alice", "wide"]],
  )
})
