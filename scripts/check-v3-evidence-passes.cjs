/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const ts = require("typescript")

const sourcePath = path.join(process.cwd(), "src/lib/pipeline/v3-evidence-types.ts")
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
  V3_EVIDENCE_PASSES,
  candidateKeyForEvidencePass,
  isV3EvidencePassId,
  normalizeEvidenceLabel,
} = moduleStub.exports

assert.equal(V3_EVIDENCE_PASSES.length, 4)
assert.deepEqual(
  Array.from(V3_EVIDENCE_PASSES, (pass) => pass.stageId),
  ["EVID.1A", "EVID.1B", "EVID.1C", "EVID.1D"],
)
assert.equal(candidateKeyForEvidencePass("EVID.1A"), "entity_candidates")
assert.equal(candidateKeyForEvidencePass("EVID.1B"), "action_candidates")
assert.equal(candidateKeyForEvidencePass("EVID.1C"), "goal_cues")
assert.equal(candidateKeyForEvidencePass("EVID.1D"), "causal_cues")
assert.equal(isV3EvidencePassId("EVID.1C"), true)
assert.equal(isV3EvidencePassId("ENT.1"), false)
assert.equal(normalizeEvidenceLabel("  physical action / resistance  "), "physical action / resistance")

console.log("v3 evidence pass checks passed")
