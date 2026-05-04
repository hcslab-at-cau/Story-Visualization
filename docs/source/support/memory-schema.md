# Support Memory Schema Proposal

## 1. Why Memory Needs to Change

Current storage is good for pipeline runs, but weak for reader support.

Current strength:

- preserves per-stage artifacts by chapter and run

Current weakness:

- reader support often needs document-level retrieval
- causal and relation supports require cross-scene linking
- re-entry support requires more than the current chapter artifact set

So the project needs a second storage layer:

- not raw extraction storage
- not UI-only storage
- but support memory

This layer should persist normalized story state that can be reused across support forms.

---

## 2. Design Goals

The memory schema should:

- work at document scope
- preserve provenance and evidence
- support append-only updates where possible
- separate normalized memory from run-specific artifacts
- allow rebuilding from artifacts if schema changes later

It should avoid:

- storing only final prose summaries
- mixing reader UI state with canonical narrative state
- storing unsupported inferences as if they were facts

---

## 3. Storage Philosophy

Use two layers:

## Layer A. Pipeline Artifacts

Already exists.

Purpose:

- preserve run-specific intermediate products
- debugging and reproducibility

Examples:

- `PRE.2`
- `SCENE.3`
- `SUB.4`
- `VIS.2`

## Layer B. Support Memory

Proposed.

Purpose:

- normalized story memory used by support generation

Examples:

- scene ledger
- event nodes
- causal edges
- place graph
- relation timeline

This second layer should be generated from stable artifacts, usually after `SCENE.3` and `SUB.3`.

---

## 4. Proposed Firestore Layout

Suggested root:

`documents/{docId}/memory/`

Suggested subcollections:

- `entities`
- `scenes`
- `subscenes`
- `events`
- `edges`
- `places`
- `relations`
- `evidence`
- `support_units`
- `reader_sessions`

---

## 5. Collection Specs

## 5.1 `entities`

Path:

`documents/{docId}/memory/entities/{entityId}`

Purpose:

- canonical reader-facing entity memory

Suggested fields:

- `entity_id`
- `canonical_name`
- `entity_type`
- `aliases`
- `first_seen`
- `latest_seen`
- `scene_ids`
- `chapter_ids`
- `salience_score`
- `relation_partner_ids`
- `place_associations`
- `open_questions`

Notes:

- this should not replace `ENT.3`
- it should summarize and extend it across scenes and chapters

---

## 5.2 `scenes`

Path:

`documents/{docId}/memory/scenes/{sceneId}`

Purpose:

- stable scene ledger for support retrieval

Suggested fields:

- `scene_id`
- `chapter_id`
- `scene_index_in_doc`
- `start_pid`
- `end_pid`
- `scene_title`
- `scene_summary`
- `current_place`
- `mentioned_places`
- `active_cast`
- `time_label`
- `goals`
- `main_actions`
- `key_relations`
- `previous_scene_id`
- `next_scene_id`
- `boundary_reason_summary`
- `evidence_refs`
- `source_run_id`

Notes:

- this is the main retrieval unit for re-entry and continuity

---

## 5.3 `subscenes`

Path:

`documents/{docId}/memory/subscenes/{subsceneId}`

Purpose:

- local progression memory inside scenes

Suggested fields:

- `subscene_id`
- `scene_id`
- `chapter_id`
- `start_pid`
- `end_pid`
- `headline`
- `label`
- `action_mode`
- `local_goal`
- `problem_state`
- `causal_input`
- `causal_result`
- `active_cast`
- `key_objects`
- `narrative_importance`
- `evidence_refs`
- `source_run_id`

Notes:

- this is where local reader support usually begins

---

## 5.4 `events`

Path:

`documents/{docId}/memory/events/{eventId}`

Purpose:

- normalized event nodes for causal retrieval

Suggested fields:

- `event_id`
- `scene_id`
- `subscene_id`
- `chapter_id`
- `event_type`
- `actors`
- `acted_on`
- `place`
- `action_summary`
- `goal_state`
- `problem_state`
- `result_state`
- `event_time`
- `importance`
- `evidence_refs`
- `derived_from`
- `source_run_id`

Event types can be coarse:

- `entry`
- `exit`
- `discovery`
- `attempt`
- `failure`
- `success`
- `decision`
- `revelation`
- `interaction_shift`
- `place_shift`
- `goal_shift`

Notes:

- event nodes should be compact and retrieval-friendly
- they should not be giant scene summaries

---

## 5.5 `edges`

Path:

`documents/{docId}/memory/edges/{edgeId}`

Purpose:

- connect events into causal and narrative structure

Suggested fields:

- `edge_id`
- `from_event_id`
- `to_event_id`
- `edge_type`
- `confidence`
- `support_level`
- `evidence_refs`
- `notes`
- `source_run_id`

Suggested `edge_type` vocabulary:

- `causes`
- `enables`
- `blocks`
- `triggers`
- `reveals`
- `escalates`
- `resolves`
- `follows_from`
- `reframes`

Suggested `support_level`:

- `explicit`
- `strong_inference`
- `weak_inference`

Notes:

- this is the critical structure for `Causal Bridge`

---

## 5.6 `places`

Path:

`documents/{docId}/memory/places/{placeKey}`

Purpose:

- normalize place identity and continuity

Suggested fields:

- `place_key`
- `canonical_name`
- `aliases`
- `environment_type`
- `place_archetype`
- `neighbor_place_keys`
- `scene_ids`
- `first_seen`
- `latest_seen`
- `visual_continuity_seed`
- `notes`

Notes:

- this collection supports:
  - spatial continuity
  - VIS continuity
  - mentioned-vs-current place disambiguation

---

## 5.7 `relations`

Path:

`documents/{docId}/memory/relations/{pairKey}`

Purpose:

- persistent character-pair relation memory

Suggested fields:

- `pair_key`
- `entity_ids`
- `labels`
- `timeline`
- `current_relation_state`
- `latest_change_type`
- `latest_change_scene_id`
- `evidence_refs`

Suggested timeline item:

- `scene_id`
- `subscene_id`
- `relation_label`
- `change_type`
- `confidence`
- `evidence_refs`

Notes:

- this collection supports relation delta cards

---

## 5.8 `evidence`

Path:

`documents/{docId}/memory/evidence/{evidenceId}`

Purpose:

- reusable text-grounding references

Suggested fields:

- `evidence_id`
- `chapter_id`
- `pid`
- `scene_id`
- `subscene_id`
- `text`
- `span_type`
- `source_stage`

Why useful:

- avoids duplicating quoted text everywhere
- helps explainability and UI traceability

---

## 5.9 `support_units`

Path:

`documents/{docId}/memory/support_units/{supportUnitId}`

Purpose:

- store shared support representation before rendering specific forms

Suggested fields:

- `support_unit_id`
- `scene_id`
- `subscene_id`
- `current_state`
- `delta_from_previous`
- `event_refs`
- `causal_parent_refs`
- `active_character_refs`
- `relation_refs`
- `place_transition`
- `ambiguity_flags`
- `support_candidates`
- `source_run_id`

Notes:

- this should be the direct input to support-generation stages

---

## 5.10 `reader_sessions`

Path:

`documents/{docId}/memory/reader_sessions/{sessionId}`

Purpose:

- optional reader-state memory for re-entry and adaptive support

Suggested fields:

- `session_id`
- `last_scene_id`
- `last_subscene_id`
- `last_active_at`
- `resume_scene_id`
- `reentry_type`
- `support_shown`
- `interaction_summary`

Notes:

- useful later
- not required for the first canonical support memory implementation

---

## 6. Update Policy

The schema should define not just what is stored, but how it is updated.

## 6.1 Canonical vs run-specific

Recommendation:

- artifacts remain run-specific
- support memory is canonicalized at document scope

This means:

- a chosen run can populate or refresh memory
- memory records should preserve `source_run_id`
- rebuilding memory should be possible

## 6.2 Append-first policy

Prefer append-only history for:

- relation timelines
- event records
- scene ledger sequence

Prefer replace/merge for:

- latest entity summary
- latest place summary
- latest support unit rebuild

## 6.3 Rebuildability

Every support memory record should be regenerable from artifacts.

Practical rule:

- never store a memory record that cannot be traced back to stage artifacts

---

## 7. Retrieval Patterns

The schema should support these common retrievals.

## 7.1 Current scene recovery

Query:

- current scene ledger
- current subscene
- latest support unit

## 7.2 Causal bridge retrieval

Query:

- current event nodes
- incoming causal edges
- nearest prior supporting event

## 7.3 Character focus retrieval

Query:

- active cast
- entity profile
- latest relevant event involving entity

## 7.4 Relation delta retrieval

Query:

- current pair relation
- previous pair relation state

## 7.5 Re-entry recap retrieval

Query:

- current scene
- previous 2 to 4 salient scenes
- unresolved tensions

---

## 8. Validation Rules

Support memory should not become a second hallucination layer.

Validation rules:

- every event must have evidence refs
- every edge must have confidence and support level
- place keys must distinguish current vs mentioned place
- relation timeline updates must reference the scene/subscene where change occurs
- inferred support fields must stay separable from explicit source fields

Suggested implementation:

- add zod schemas for memory collections
- add normalization and consistency checks before writes

---

## 9. Suggested Build Sequence

Build in this order:

1. `scenes`
2. `subscenes`
3. `events`
4. `edges`
5. `places`
6. `relations`
7. `support_units`
8. optional `reader_sessions`

Reason:

- scene and subscene ledgers are the easiest and highest-value base
- support units should come only after lower-level memory is stable

---

## 10. Open Questions

The project should eventually decide:

- what counts as the canonical run that writes support memory?
- should memory be refreshed only manually, or automatically after stable stages complete?
- should edges be conservative and sparse, or broader and ranked?
- how much low-confidence memory should be stored vs generated only on demand?

Recommendation:

- start sparse and conservative

---

## 11. Final Recommendation

The memory layer should be thought of as:

`a normalized, evidence-linked story state store for support generation`

not:

- a duplicate of existing artifacts
- a UI cache
- a free-form summary database

If this layer is built cleanly, most future support ideas become much easier to implement.
