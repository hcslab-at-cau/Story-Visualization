/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const ts = require("typescript")

const sourcePath = path.join(process.cwd(), "src/lib/pipeline/v3-mention-normalization.ts")
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
  require,
}, { filename: sourcePath })

const {
  normalizeSceneMentionRole,
  normalizeV3SceneMention,
  countV3Mentions,
} = moduleStub.exports

const onStage = normalizeV3SceneMention(
  {
    mention_id: "m1",
    pid: 1,
    span: "Bomi",
    mention_type: "cast",
  },
  { scene_role: "active participant" },
)
assert.equal(onStage.scene_role, "on_stage")
assert.equal(onStage.boundary_relevance, "direct")
assert.equal(onStage.boundary_signal, true)
assert.equal(onStage.boundary_dimension, "character_constellation")

const objectPlace = normalizeV3SceneMention(
  {
    mention_id: "m2",
    pid: 1,
    span: "backpack",
    mention_type: "place",
  },
  { scene_role: "object", boundary_relevance: "direct" },
)
assert.equal(objectPlace.scene_role, "object_or_prop")
assert.equal(objectPlace.boundary_relevance, "excluded")
assert.equal(objectPlace.boundary_signal, false)

const contextualCast = normalizeV3SceneMention(
  {
    mention_id: "m3",
    pid: 2,
    span: "that person",
    mention_type: "cast",
  },
  { scene_role: "mentioned only" },
)
assert.equal(contextualCast.boundary_relevance, "contextual")
assert.equal(contextualCast.boundary_signal, false)

assert.equal(normalizeSceneMentionRole("time", "story time"), "story_time_frame")

const stats = countV3Mentions([onStage, contextualCast])
assert.equal(JSON.stringify(stats.by_type), JSON.stringify({ cast: 2, place: 0, time: 0 }))
assert.equal(stats.accepted_boundary_mentions, 1)
assert.equal(stats.contextual_mentions, 1)

console.log("v3 mention normalization checks passed")
