import assert from "node:assert/strict"
import test from "node:test"
import { chooseVisiblePreStage } from "../src/components/v3/pre-workbench-state.ts"
import { getDescendantStages, PIPELINE_STAGE_EDGES } from "../src/config/pipeline-graph.ts"
import { parseRequiredV3DataSource } from "../src/lib/data-source.ts"

test("IDX.2 is the latest visible V3 pipeline stage", () => {
  assert.equal(chooseVisiblePreStage({ idx1: {}, idx2: {} }), "IDX.2")
  assert.equal(chooseVisiblePreStage({ idx1: {} }), "IDX.1")
})

test("invalidating IDX.1 also invalidates IDX.2", () => {
  assert.deepEqual([...getDescendantStages("IDX.1")], ["IDX.2"])
})

test("paragraph index stages register every direct source dependency", () => {
  for (const expectedEdge of [
    { from: "PRE.1", to: "IDX.1" },
    { from: "PRE.2", to: "IDX.1" },
    { from: "EVID.4", to: "IDX.1" },
    { from: "PRE.1", to: "IDX.2" },
  ] as const) {
    assert.equal(
      PIPELINE_STAGE_EDGES.filter(
        (edge) => edge.from === expectedEdge.from && edge.to === expectedEdge.to,
      ).length,
      1,
      `${expectedEdge.from} -> ${expectedEdge.to} must be registered exactly once`,
    )
  }
})

test("paragraph source invalidation reaches IDX.1 and IDX.2 without duplicates", () => {
  for (const sourceStage of ["PRE.1", "PRE.2", "EVID.4"] as const) {
    const descendants = [...getDescendantStages(sourceStage)]

    assert.equal(new Set(descendants).size, descendants.length)
    assert.equal(descendants.filter((stage) => stage === "IDX.1").length, 1)
    assert.equal(descendants.filter((stage) => stage === "IDX.2").length, 1)
  }
})

test("IDX.2 write source accepts only the V3 namespace", () => {
  assert.equal(parseRequiredV3DataSource("v3"), "v3")
  assert.equal(parseRequiredV3DataSource("current"), null)
  assert.equal(parseRequiredV3DataSource("legacy"), null)
  assert.equal(parseRequiredV3DataSource(undefined), null)
})
