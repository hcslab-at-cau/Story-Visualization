/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const ts = require("typescript")

const sourcePath = path.join(process.cwd(), "src/lib/pipeline/v3-evidence-refinement-types.ts")
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
  V3_EVIDENCE_REFINEMENT_STAGE_ID,
  isObjectiveRejectionReason,
  normalizeRefinementStatus,
  normalizeRejectionReason,
} = moduleStub.exports

assert.equal(V3_EVIDENCE_REFINEMENT_STAGE_ID, "EVID.2")
assert.equal(normalizeRefinementStatus("core"), "kept_core")
assert.equal(normalizeRefinementStatus("context"), "kept_context")
assert.equal(normalizeRefinementStatus("corrected"), "corrected")
assert.equal(isObjectiveRejectionReason("span_not_in_text"), true)
assert.equal(isObjectiveRejectionReason("unimportant"), false)
assert.equal(normalizeRejectionReason("low importance"), "not_objective_rejection")

console.log("v3 evidence refinement checks passed")
