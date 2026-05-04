# Support Pipeline Plan

## 1. Purpose

This document proposes a new support-generation branch for the project.

Current pipeline:

- extracts and validates story structure well

Missing branch:

- transforms that structure into multiple reader-facing support artifacts

This document defines that branch.

---

## 2. Why a Separate Branch is Needed

Support generation should not live only inside:

- `SUB.4`
- `FINAL.1`

Reason:

- `SUB.4` is local and subscene-centered
- `FINAL.1` is packaging-oriented
- support generation needs its own retrieval, grounding, and ranking logic

Therefore a new branch is cleaner:

`SCENE.3 + SUB.3 + support memory -> support artifacts -> FINAL.1`

---

## 3. Proposed Support Branch

Suggested stage family:

- `SUP.0` Support Memory Build
- `SUP.1` Shared Support Representation
- `SUP.2` Current-State Snapshot
- `SUP.3` Boundary Delta Chips
- `SUP.4` Causal Bridge
- `SUP.5` Character / Relation Support
- `SUP.6` Re-entry / Reference Repair
- `SUP.7` Support Policy Selection

This branch can stay optional at first, but structurally it should be explicit.

---

## 4. Stage Specifications

## 4.1 `SUP.0` Support Memory Build

Purpose:

- materialize document-level support memory from validated artifacts

Inputs:

- `ENT.3`
- `STATE.2`
- `STATE.3`
- `SCENE.1`
- `SCENE.3`
- `SUB.2`
- `SUB.3`

Processing mode:

- mostly rule-based
- some light normalization prompts may be allowed later

Outputs:

- memory records written to doc-level storage

Main functions:

- scene ledger write
- subscene ledger write
- event node extraction
- place normalization
- relation timeline write

---

## 4.2 `SUP.1` Shared Support Representation

Purpose:

- create one stable support-ready unit per scene or subscene

Inputs:

- current scene/subscene artifacts
- retrieved memory records

Processing mode:

- mostly rule-based retrieval and merging
- optional light LLM cleanup if needed

Outputs:

- `SharedSupportUnit[]`

Suggested fields:

- `support_target_type`
- `support_target_id`
- `current_state`
- `delta_from_previous`
- `local_event`
- `causal_parent_candidates`
- `active_characters`
- `relation_candidates`
- `place_transition`
- `ambiguity_flags`
- `evidence_refs`

---

## 4.3 `SUP.2` Current-State Snapshot

Purpose:

- generate the most compact default support

Inputs:

- shared support units

Processing mode:

- rule templating first
- LLM compression second if needed

Outputs:

- one snapshot per scene/subscene

Suggested fields:

- `support_target_id`
- `summary_lines`
- `state_fields`
- `confidence`
- `evidence_refs`

---

## 4.4 `SUP.3` Boundary Delta Chips

Purpose:

- generate lightweight transition signals

Inputs:

- shared support units
- boundary reasons

Processing mode:

- deterministic

Outputs:

- ranked chip sets

Suggested fields:

- `support_target_id`
- `chips`
- `salience_score`

Chip categories:

- place
- time
- cast
- goal
- relation
- narrative mode

---

## 4.5 `SUP.4` Causal Bridge

Purpose:

- connect current subscene/state to earlier enabling or causing events

Inputs:

- shared support units
- event graph

Processing mode:

- retrieval + short LLM generation

Outputs:

- one or more ranked causal bridges

Suggested fields:

- `target_id`
- `bridge_text`
- `source_event_id`
- `target_event_id`
- `edge_path`
- `confidence`
- `evidence_refs`

Important rule:

- no long explanation chain
- prefer one bridge sentence

---

## 4.6 `SUP.5` Character / Relation Support

Purpose:

- create focused support for active characters and relevant pairs

Inputs:

- shared support units
- entity memory
- relation memory

Processing mode:

- retrieval + short LLM formatting

Outputs:

- character focus cards
- relation delta cards

Suggested split:

- `CharacterSupportArtifact`
- `RelationSupportArtifact`

---

## 4.7 `SUP.6` Re-entry / Reference Repair

Purpose:

- support pause-resume and ambiguity repair

Inputs:

- shared support units
- optional reader session memory
- local mention ambiguity signals

Processing mode:

- trigger-dependent

Outputs:

- re-entry recap
- reference repair list

Suggested rule:

- do not generate this constantly
- only generate on trigger or on demand

---

## 4.8 `SUP.7` Support Policy Selection

Purpose:

- decide which support to show, where, and with what priority

Inputs:

- all support artifacts
- optional VIS usefulness
- interface context
- trigger state

Processing mode:

- deterministic policy first
- optional learned personalization later

Outputs:

- `DisplaySupportPlan`

Suggested fields:

- `always_visible`
- `expandable`
- `on_trigger`
- `suppressed`
- `ui_priority_order`

---

## 5. Deterministic vs LLM Boundary

Not every support stage should be LLM-heavy.

Recommended split:

Mostly deterministic:

- `SUP.0`
- `SUP.1`
- `SUP.3`
- `SUP.7`

Mixed:

- `SUP.2`
- `SUP.5`
- `SUP.6`

Retrieval + LLM:

- `SUP.4`

Reason:

- the support branch should be controllable and auditable

---

## 6. Integration with Existing Branches

## 6.1 Relationship to `SUB`

`SUB` still matters.

Best interpretation:

- `SUB` finds local progression units and local support targets
- `SUP` turns them into reader-facing support forms using wider memory

## 6.2 Relationship to `VIS`

Best interpretation:

- `VIS` is one output modality
- `SUP` decides whether and when VIS should be part of the support bundle

## 6.3 Relationship to `FINAL`

Best interpretation:

- `FINAL.1` becomes the packager of text supports plus VIS plus UI policy

---

## 7. Suggested Artifact Types

The following new types are worth adding to `schema.ts` later.

- `SharedSupportUnit`
- `CurrentStateSnapshot`
- `BoundaryDeltaArtifact`
- `CausalBridgeArtifact`
- `CharacterSupportArtifact`
- `RelationSupportArtifact`
- `ReentryRecapArtifact`
- `ReferenceRepairArtifact`
- `DisplaySupportPlan`

These should remain support artifacts, not UI components.

---

## 8. Trigger Model

The support pipeline should be aware of reading conditions.

Suggested trigger types:

- `scene_entry`
- `subscene_entry`
- `reentry_after_pause`
- `large_place_shift`
- `large_cast_turnover`
- `high_reference_ambiguity`
- `low_visual_usefulness`
- `manual_request`

These triggers should feed into `SUP.7`.

---

## 9. Minimum Viable Support Branch

If the project wants the smallest useful first version, build only:

- `SUP.0`
- `SUP.1`
- `SUP.2`
- `SUP.3`
- `SUP.4`
- simple subset of `SUP.7`

This is enough to test the core idea:

- compact state recovery plus causal repair

---

## 10. Main Risks

## Risk 1. The branch duplicates SUB.4

Mitigation:

- keep `SUB.4` local, `SUP` retrieval-aware and document-aware

## Risk 2. Too many artifact types too early

Mitigation:

- implement only the first-wave artifacts first

## Risk 3. Too much LLM dependence

Mitigation:

- use deterministic retrieval and diff logic wherever possible

## Risk 4. Support outputs become repetitive

Mitigation:

- explicit deduplication and policy suppression rules

---

## 11. Final Recommendation

The support branch should be treated as:

`a transformation pipeline from structured narrative understanding to selective repair-oriented reader supports`

That framing will help future implementation decisions stay coherent.
