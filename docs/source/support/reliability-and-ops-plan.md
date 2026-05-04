# Reliability and Operations Plan

## 1. Why This Matters

As the system moves from extraction to reader support, failures become more visible.

A wrong mention cluster is bad.
A wrong causal bridge shown to a reader is worse.

So the project needs an explicit quality and operations layer for:

- grounding
- debugging
- prompt/version tracking
- cost/latency awareness
- regression control

This document proposes that layer.

---

## 2. Reliability Targets

The system should aim for:

- support claims that can be traced back to evidence
- low hallucination in causal and relation supports
- controlled verbosity
- stable UI behavior across repeated runs
- explainable suppression when support is uncertain

The system does not need:

- perfect literary interpretation
- maximal inference depth at all times

The goal is reader recovery, not omniscient criticism.

---

## 3. Failure Taxonomy

Support-specific failures should be tracked explicitly.

## 3.1 Grounding failures

Examples:

- cites the wrong character
- cites a place that was only mentioned
- causal parent does not support current event

## 3.2 Overreach failures

Examples:

- adds motive not grounded in text
- claims strong relation shift from weak evidence
- infers future importance too strongly

## 3.3 Compression failures

Examples:

- support is too long
- support repeats what is already visible
- support does not emphasize the changed state

## 3.4 Retrieval failures

Examples:

- relevant earlier event not retrieved
- wrong earlier scene retrieved
- stale place or relation state selected

## 3.5 UI policy failures

Examples:

- too many supports shown at once
- important support hidden
- image shown when low-value

## 3.6 VIS-specific failures

Examples:

- image suggests wrong current place
- image is decorative but not useful
- overlay implies unsupported character presence

---

## 4. Validation Layers

The support system should validate at multiple layers.

## 4.1 Schema validation

Use:

- zod schemas for new support artifacts
- strict enums where possible

Check:

- required fields
- confidence range
- evidence references exist
- IDs resolve

## 4.2 Rule validation

Check:

- mentioned place is not used as current place
- causal bridges refer to linked events
- relation delta compares against previous state
- snapshot fields match available memory

## 4.3 Prompt-output validation

For LLM-generated supports:

- enforce short output shapes
- reject unsupported fields
- clamp or downgrade overconfident output

## 4.4 UI validation

Check:

- support bundle size
- priority ordering
- no duplicate support with same message

---

## 5. Prompt Governance

Prompting will become harder as support forms multiply.

The project should document prompt governance early.

## 5.1 Prompt versioning

Every support prompt should store:

- template name
- template version
- prompt role
- output schema version

## 5.2 Prompt categories

Separate prompts by purpose:

- extraction
- validation
- retrieval formatting
- support compression
- policy selection

## 5.3 Prompt principles

Support prompts should prefer:

- short outputs
- explicit evidence use
- local scope
- contrastive framing

Support prompts should avoid:

- whole-scene retelling
- literary commentary
- unsupported psychological explanation

---

## 6. Observability

The system should be inspectable at support level, not only pipeline level.

## 6.1 What to log

For each support artifact:

- source run ID
- memory retrieval inputs
- selected candidate records
- prompt template/version
- output
- validation warnings
- suppression decision

## 6.2 What to inspect in UI

Add support-oriented inspectors later for:

- retrieved memory nodes
- causal edge path
- place continuity chain
- support usefulness score
- suppression reason

Current `PipelineRunner` is strong for stage inspection.
Later, it should gain support-specific views.

---

## 7. Regression Strategy

The project should build a small regression set before scaling support generation.

## 7.1 Regression sample composition

Include scenes with:

- clear place shifts
- heavy dialogue and ambiguous references
- important causal linkage
- recurring locations
- relation changes
- re-entry difficulty

## 7.2 Expected outputs

Store human-checked expectations for:

- snapshot fields
- chips
- causal bridge presence/absence
- reference repairs
- VIS usefulness

## 7.3 Regression checks

On prompt or schema changes, check:

- output structure stability
- support length
- evidence integrity
- non-duplication

---

## 8. Cost and Latency Strategy

The support branch can become expensive if every support is LLM-generated.

Recommendation:

- deterministic retrieval and diff logic first
- LLM only for compact wording or ambiguous cases

Suggested budgeting:

- `SUP.0`, `SUP.1`, `SUP.3`, `SUP.7`: no LLM by default
- `SUP.2`, `SUP.5`, `SUP.6`: small models okay
- `SUP.4`: stronger model only when needed

Also:

- cache support memory
- avoid regenerating support artifacts unnecessarily when upstream content has not changed

---

## 9. Human Review Workflow

Before formal evaluation, internal review should be easy.

Suggested review dimensions:

- useful / not useful
- correct / partially correct / wrong
- too long / acceptable / too short
- redundant / distinct
- well-timed / poorly timed

Suggested review artifacts:

- scene text
- support output
- evidence refs
- source memory nodes

---

## 10. Reliability Gates Before User Study

Do not move to user study until these are true:

- support memory retrieval is stable
- first-wave supports have evidence links
- obvious grounding failures are rare
- support UI is not overloaded
- VIS usefulness suppression works at least coarsely

---

## 11. Final Recommendation

The project should treat reliability as a first-class design problem.

The most important principle is:

`If a support cannot be trusted enough to help, it should be shortened, downgraded, or hidden.`

That is better than showing a confident but unstable scaffold.
