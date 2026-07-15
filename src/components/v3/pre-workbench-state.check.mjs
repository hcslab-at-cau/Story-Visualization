import assert from "node:assert/strict"
import {
  chooseExistingRunId,
  chooseVisiblePreStage,
} from "./pre-workbench-state.ts"

assert.equal(
  chooseExistingRunId([
    { runId: "20260527204201", updatedAt: {} },
    { runId: "20260501090000", updatedAt: {} },
  ]),
  "20260527204201",
)
assert.equal(chooseExistingRunId([]), "")
assert.equal(chooseVisiblePreStage({ pre1: { chapterId: "ch01" } }), "PRE.1")
assert.equal(
  chooseVisiblePreStage({
    pre1: { chapterId: "ch01" },
    pre2: { units: [] },
  }),
  "PRE.2",
)
