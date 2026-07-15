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

const sceneTypes = loadTsModule("src/lib/pipeline/v3-scene-types.ts")
const grouping = loadTsModule("src/lib/pipeline/v3-scene-grouping.ts", {
  "@/lib/pipeline/v3-scene-types": sceneTypes,
  "@/lib/prompt-loader": {
    formatJsonParam: (value) => JSON.stringify(value),
  },
})

assert.equal(sceneTypes.V3_SCENE_GROUPING_STAGE_ID, "SCENE.0")

const events = [
  {
    event_id: "e1",
    sequence_index: 1,
    grouping_source: "llm",
    start_pid: 1,
    end_pid: 1,
    summary: "Alice follows the White Rabbit.",
    anchor_action_ids: ["a1"],
    evidence_ids: ["a1", "c1"],
    cast_ids: ["c1"],
    place_ids: ["p1"],
    time_ids: [],
    object_ids: [],
    goal_ids: ["g1"],
    causality_ids: [],
  },
  {
    event_id: "e2",
    sequence_index: 2,
    grouping_source: "llm",
    start_pid: 2,
    end_pid: 2,
    summary: "Alice enters the rabbit-hole.",
    anchor_action_ids: ["a2"],
    evidence_ids: ["a2", "c1", "p1"],
    cast_ids: ["c1"],
    place_ids: ["p1"],
    time_ids: [],
    object_ids: [],
    goal_ids: ["g1"],
    causality_ids: [],
  },
  {
    event_id: "e3",
    sequence_index: 3,
    grouping_source: "llm",
    start_pid: 4,
    end_pid: 4,
    summary: "Alice falls alone through the tunnel.",
    anchor_action_ids: ["a3"],
    evidence_ids: ["a3", "c1", "p2"],
    cast_ids: ["c1"],
    place_ids: ["p2"],
    time_ids: [],
    object_ids: [],
    goal_ids: [],
    causality_ids: ["k1"],
  },
]

const rawScenes = [
  {
    event_ids: ["e1", "missing", "e2"],
    summary: "Alice pursues the White Rabbit into the opening.",
    time_axis: { label: "continuous moment", evidence_event_ids: ["e1", "e2"] },
    place_axis: { label: "rabbit-hole entrance", evidence_event_ids: ["e1", "e2"] },
    action_focus_axis: { label: "pursuit becomes entry", evidence_event_ids: ["e1", "e2"] },
    cast_axis: { label: "Alice and the White Rabbit", evidence_event_ids: ["e1"] },
    boundary_basis: ["place", "action_focus", "score"],
    rationale: "The focus stays on pursuit and entry.",
  },
]

const scenes = grouping.finalizeV3SceneCandidates(rawScenes, events, "ch02")

assert.equal(JSON.stringify(
  scenes.map((scene) => scene.event_ids),
), JSON.stringify([["e1", "e2"], ["e3"]]))
assert.equal(JSON.stringify(
  scenes.map((scene) => scene.grouping_source),
), JSON.stringify(["llm", "fallback_event"]))
assert.equal(JSON.stringify(scenes[0].boundary_basis), JSON.stringify(["place", "action_focus"]))
assert.equal(scenes[0].scene_id, "ch02_scene0_0001")
assert.equal(scenes[0].start_pid, 1)
assert.equal(scenes[0].end_pid, 2)
assert.equal(scenes[1].summary, "Alice falls alone through the tunnel.")
assert.equal(JSON.stringify(scenes[1].boundary_basis), JSON.stringify([]))

console.log("v3 scene grouping checks passed")
