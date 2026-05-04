# Current Implementation vs Documentation

## 1. Purpose

This document separates three things that are currently mixed in discussion:

1. what is implemented now
2. what current documentation accurately describes
3. what is a proposed next architecture

The main conclusion:

`PRE / ENT / STATE / SCENE / SUB / VIS / FINAL` are implemented as a staged LLM-and-rule pipeline, but `SUP`, Narrative Relation Graph, evidence/reveal indexing, narrative scope, and graph-derived reader supports are not implemented yet.

## 2. Current Implemented System

Current app views:

- Upload view
- Pipeline view
- Reader view

Current core files:

- `src/app/page.tsx`
- `src/components/PipelineRunner.tsx`
- `src/components/ReaderScreen.tsx`
- `src/types/ui.ts`
- `src/types/schema.ts`
- `src/lib/pipeline/*.ts`
- `src/app/api/pipeline/*/route.ts`

Current stage families registered in `src/types/ui.ts`:

- `PRE.1`, `PRE.2`
- `ENT.1`, `ENT.2`, `ENT.3`
- `STATE.1`, `STATE.2`, `STATE.3`
- `SCENE.1`, `SCENE.2`, `SCENE.3`
- `VIS.1`, `VIS.2`, `VIS.3`, `VIS.4`
- `SUB.1`, `SUB.2`, `SUB.3`, `SUB.4`
- `FINAL.1`, `FINAL.2`

## 3. Current Stage Dependency Reading

## 3.1 PRE / ENT

Implemented:

- `PRE.1` prepares raw chapter structure.
- `PRE.2` classifies content units.
- `ENT.1` extracts mention candidates.
- `ENT.2` validates mention candidates.
- `ENT.3` resolves canonical entities and unresolved mentions.

Graph relevance:

- `ENT.3` should be a primary graph input.
- `ENT.1` and `ENT.2` should usually not be graph inputs directly, except for debugging or correction analysis.
- `PRE.1` and `PRE.2` should feed the Evidence + Reveal Index rather than graph semantics directly.

## 3.2 STATE

Implemented:

- `STATE.1` creates rule-based state frames.
- `STATE.2` validates/refines state frames with LLM.
- `STATE.3` detects scene boundaries and scene titles.

Graph relevance:

- `STATE.2` is useful as frame-level evidence.
- `STATE.3` is useful for scene span and boundary reason.
- Neither should be the only graph state source because `SCENE.1` and `SCENE.3` already aggregate scene-level structure.

## 3.3 SCENE

Implemented:

- `SCENE.1` builds scene packets from boundaries, refined state, raw state, entities, and raw chapter.
- `SCENE.2` extracts scene index data.
- `SCENE.3` validates and grounds the scene index using scene packets, entity graph, and refined states.

Graph relevance:

- `SCENE.1` should be the primary scene span and scene packet input.
- `SCENE.3` should be the primary grounded scene fact input.
- `SCENE.2` should not normally feed the graph directly because `SCENE.3` is the validated version.

## 3.4 SUB

Implemented:

- `SUB.1` proposes subscenes from `SCENE.1` and `SCENE.3`.
- `SUB.2` extracts subscene-local state.
- `SUB.3` validates subscene structure and state.
- `SUB.4` packages local reader-facing interventions.

Graph relevance:

- `SUB.2` and `SUB.3` are useful graph inputs.
- `SUB.4` should not be a canonical graph input because it is already reader-facing packaging.
- `SUB.4` can remain a legacy/local input to `FINAL.1` until graph-derived supports replace it.

## 3.5 VIS

Implemented:

- `VIS.1` semantic clarification.
- `VIS.2` stage blueprint.
- `VIS.3` render package.
- `VIS.4` image generation and storage.

Current documentation status:

- `pipeline/visual-current.md` describes the implemented branch.

Target architecture status:

- VIS should not remain a standalone conceptual branch.
- It should become `Visual Support Spec -> Media Renderer`, after graph/support policy decides visual support is useful.

Graph relevance:

- Existing `VIS.1` contains useful place/ambiguity ideas, but long-term this belongs in Narrative Scope and place normalization.
- Existing `VIS.2` should become a visual-support artifact spec, not a primary narrative-understanding stage.
- Existing `VIS.3` and `VIS.4` should become rendering backend steps.

## 3.6 FINAL

Implemented:

- `FINAL.1` builds the reader package from `SCENE.3`, `SUB.3`, `SCENE.1`, `STATE.3`, raw chapter, and optional `VIS.2`, `SUB.4`, `VIS.4`.
- `FINAL.2` refines character overlay/layout using `FINAL.1`, optional `VIS.2`, and image/vision logic.
- `ReaderScreen` renders `FINAL.1` and optional `FINAL.2`.

Target architecture status:

- `FINAL.1` should eventually receive `SUP.7 Display Policy`.
- `FINAL.2` should become optional and run only when visual overlay/layout refinement is needed.

## 4. What Is Not Implemented Yet

The following are proposal-only:

- `SUP.0` Support Memory / Graph Build
- `SUP.1` Shared Support Unit
- `SUP.2` Current-State Snapshot
- `SUP.3` Delta Chips
- `SUP.4` Causal Bridge
- `SUP.5` Character / Relation Support
- `SUP.6` Re-entry / Reference Repair
- `SUP.7` Display Policy
- Narrative Relation Graph Store
- Evidence + Reveal Index
- Narrative Scope
- Scene Entry / Exit State ledger
- StateDelta builder
- NarrativeThread ledger
- SceneEdge candidate generation
- LLM relation verifier/classifier
- graph correction loop
- ChapterEdge aggregation
- graph-derived Resume Card / Shift Bridge / Situation Snapshot

## 5. Document Status Matrix

| Document | Status | Notes |
|---|---|---|
| `current/ui.md` | Current implementation | Describes actual UI behavior. |
| `current/infra.md` | Current/reference | Infrastructure notes. |
| `pipeline/pre-ent.md` | Current implementation | Should stay close to code. |
| `pipeline/state.md` | Current implementation | Should stay close to code. |
| `pipeline/scene.md` | Current implementation | Should stay close to code. |
| `pipeline/sub.md` | Current implementation | Should stay close to code. |
| `pipeline/visual-current.md` | Current but transitional | Describes implemented VIS branch, but not the desired long-term architecture. |
| `pipeline/final.md` | Current implementation | Should be updated when `SUP.7` is integrated. |
| `support/reader-support-design.md` | Proposal | Broad support form inventory. |
| `support/roadmap.md` | Proposal | Execution roadmap for support system. |
| `support/memory-schema.md` | Proposal | Memory schema, should be revised after graph MVP implementation. |
| `support/pipeline-plan.md` | Proposal | `SUP.*` branch plan. |
| `support/reliability-and-ops-plan.md` | Proposal | Validation and operations plan. |
| `support/visual-support-proposal.md` | Proposal | Recommended VIS repositioning. |
| `research/narrative-relation-graph.md` | Proposal | Main next architecture concept. |
| `research/direction-roadmap.md` | Proposal | Research contribution and milestone roadmap. |
| `research/evaluation-plan.md` | Proposal | Evaluation plan. |
| `review/implementation-alignment-review.md` | Review | Earlier comparison notes. |

## 6. Recommended Data Flow Corrections

The proposed future graph should not ingest every current artifact equally.

Primary graph inputs:

- `ENT.3`
- `SCENE.1`
- `SCENE.3`
- `SUB.2`
- `SUB.3`

Supporting graph/evidence inputs:

- `PRE.1`
- `PRE.2`
- `STATE.2`
- `STATE.3`

Avoid as direct graph inputs:

- `SCENE.2`
- `SUB.4`
- `VIS.3`
- `VIS.4`
- `FINAL.1`
- `FINAL.2`

Reason:

- `SCENE.2` is superseded by `SCENE.3`.
- `SUB.4`, `FINAL.1`, and `FINAL.2` are reader-facing packaging layers.
- `VIS.3` and `VIS.4` are render backend artifacts.

## 7. Recommended Target Flow

Recommended next architecture:

```text
Existing pipeline:
PRE -> ENT / STATE -> SCENE -> SUB

New graph/support branch:
SCENE.1 + SCENE.3 + SUB.2 + SUB.3 + ENT.3 + Evidence Index
  -> Graph Ingestion
  -> Narrative Scope
  -> Scene Entry / Exit State
  -> State Delta
  -> Thread Ledger
  -> Scene Relation Edges
  -> Chapter Relation Edges
  -> Shared Support Unit
  -> Display Policy
  -> FINAL.1

Visual output:
Display Policy -> Visual Support Spec -> Media Renderer -> optional FINAL.2
```

## 8. Immediate Alignment Tasks

Recommended next implementation tasks:

1. Add `EvidenceRef`, `TextUnitRef`, and reveal-position types.
2. Add `SceneState`, `SituationState`, and `StateDelta` types.
3. Build graph ingestion from `ENT.3`, `SCENE.1`, `SCENE.3`, `SUB.2`, `SUB.3`.
4. Add Narrative Scope MVP for actual/memory/imagination/hypothetical/dialogue claim.
5. Build deterministic adjacent-scene delta detection.
6. Add a minimal `NarrativeThread` and `ThreadEvent` ledger.
7. Generate MVP scene edge candidates.
8. Add one-edge-at-a-time LLM verification and correction.
9. Generate Snapshot, Shift Bridge, and Resume Card from graph queries.
10. Compare against direct LLM baseline.

## 9. Bottom Line

The current implementation is a functioning staged prototype.

The proposed documents describe a stronger research architecture that is not implemented yet.

The next implementation should avoid expanding direct LLM artifact generation and instead build:

`Evidence Index -> Scene State Ledger -> State Delta -> Narrative Scope -> Thread Ledger -> Scene Relation Graph -> Graph-derived Supports`

That is the path from the current prototype to a defensible technical contribution.

