/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const ts = require("typescript")

function loadTsModule(relativePath, stubs = {}) {
  const sourcePath = path.join(process.cwd(), relativePath)
  const source = fs.readFileSync(sourcePath, "utf8")
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText
  const moduleStub = { exports: {} }
  vm.runInNewContext(compiled, {
    exports: moduleStub.exports,
    module: moduleStub,
    require: (id) => stubs[id] ?? require(id),
  }, { filename: sourcePath })
  return moduleStub.exports
}

const eventTypes = loadTsModule("src/lib/pipeline/v3-event-types.ts")
const eventAxisCore = loadTsModule("src/lib/pipeline/v3-event-axis-core.ts")
const grouping = loadTsModule("src/lib/pipeline/v3-event-grouping.ts", {
  "@/lib/pipeline/v3-event-types": eventTypes,
  "@/lib/pipeline/v3-event-axis-core": eventAxisCore,
  "@/lib/prompt-loader": {
    formatJsonParam: (value) => JSON.stringify(value),
    normalizePidKey: (value) => String(value),
  },
})

assert.equal(eventTypes.V3_EVENT_GROUPING_STAGE_ID, "EVENT.1")

const mergedEvidence = {
  refined_candidate_id: "ch02_evid2_0001",
  source_candidate_ids: ["ch02_evid1a_0001", "ch02_evid1a_0010"],
  candidate_type: "cast",
  status: "kept_core",
  actions: ["merged"],
  pid: 1,
  span: "Alice",
  start_char: 0,
  end_char: 5,
  original_candidates: [
    {
      candidate_id: "ch02_evid1a_0001",
      pid: 1,
      span: "Alice",
      start_char: 0,
      end_char: 5,
      candidate_type: "cast",
      source_pass: "EVID.1A",
    },
    {
      candidate_id: "ch02_evid1a_0010",
      pid: 3,
      span: "Alice",
      start_char: 54,
      end_char: 59,
      candidate_type: "cast",
      source_pass: "EVID.1A",
    },
  ],
}

const evidenceGate = {
  gated_candidates: [{
    refined_candidate_id: mergedEvidence.refined_candidate_id,
    gate: "core",
    basis: ["event_axis"],
  }],
}

const occurrences = grouping.expandRefinedEvidenceOccurrences([mergedEvidence], evidenceGate)
assert.equal(occurrences.length, 2)
assert.equal(JSON.stringify(
  occurrences.map((occurrence) => occurrence.source_candidate_id),
), JSON.stringify(["ch02_evid1a_0001", "ch02_evid1a_0010"]))
assert.equal(JSON.stringify(
  occurrences.map((occurrence) => occurrence.pid),
), JSON.stringify([1, 3]))
assert.equal(JSON.stringify(
  occurrences.map((occurrence) => occurrence.refined_candidate_id),
), JSON.stringify(["ch02_evid2_0001", "ch02_evid2_0001"]))

console.log("v3 event grouping checks passed")
