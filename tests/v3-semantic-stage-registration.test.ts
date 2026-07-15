import assert from "node:assert/strict"
import test from "node:test"
import { chooseVisiblePreStage } from "../src/components/v3/pre-workbench-state.ts"
import { getDescendantStages } from "../src/config/pipeline-graph.ts"
import { parseRequiredV3DataSource } from "../src/lib/data-source.ts"

test("IDX.2 is the latest visible V3 pipeline stage", () => {
  assert.equal(chooseVisiblePreStage({ idx1: {}, idx2: {} }), "IDX.2")
  assert.equal(chooseVisiblePreStage({ idx1: {} }), "IDX.1")
})

test("invalidating IDX.1 also invalidates IDX.2", () => {
  assert.deepEqual([...getDescendantStages("IDX.1")], ["IDX.2"])
})

test("IDX.2 write source accepts only the V3 namespace", () => {
  assert.equal(parseRequiredV3DataSource("v3"), "v3")
  assert.equal(parseRequiredV3DataSource("current"), null)
  assert.equal(parseRequiredV3DataSource("legacy"), null)
  assert.equal(parseRequiredV3DataSource(undefined), null)
})
