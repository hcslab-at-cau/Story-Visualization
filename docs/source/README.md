# Documentation Index

This directory is split by document role.

## Folder Structure

## `current/`

Documents that describe the current app surface and infrastructure.

- `current/ui.md`
  - current Upload / Pipeline / Reader UI behavior
  - run selection and favorite behavior
  - implemented stage inspection views

- `current/infra.md`
  - infrastructure and environment notes

## `pipeline/`

Documents that describe the implemented pipeline stages.

- `pipeline/pre-ent.md`
  - PRE and ENT stages

- `pipeline/state.md`
  - STATE stages

- `pipeline/scene.md`
  - SCENE stages

- `pipeline/sub.md`
  - SUB stages

- `pipeline/visual-current.md`
  - currently implemented VIS.1 to VIS.4 branch
  - this is current implementation documentation, not the long-term target architecture

- `pipeline/final.md`
  - FINAL.1 and FINAL.2 reader packaging behavior

## `support/`

Design and planning documents for the next reader-support architecture.

- `support/reader-support-design.md`
  - reader-support forms and design principles

- `support/roadmap.md`
  - support-system execution roadmap

- `support/memory-schema.md`
  - document-level support memory proposal

- `support/pipeline-plan.md`
  - proposed `SUP.*` branch

- `support/reliability-and-ops-plan.md`
  - validation, correction, prompt governance, and observability

- `support/visual-support-proposal.md`
  - VIS repositioning, usefulness scoring, continuity, fallback

## `research/`

Research framing, contribution, and evaluation documents.

- `research/narrative-relation-graph.md`
  - Narrative Relation Graph proposal
  - scene state, thread ledger, scene/chapter edge design
  - evidence, spoiler, scope, and correction-loop requirements

- `research/direction-roadmap.md`
  - research contribution framing beyond API orchestration
  - milestones from evidence index to graph-derived supports
  - baseline and evaluation plan for technical contribution

- `research/evaluation-plan.md`
  - offline evaluation, pilot study, logging, and success criteria

## `review/`

Documents that compare implementation, documentation, and future plans.

- `review/current-implementation-vs-docs.md`
  - current code behavior vs current/proposed documents
  - which documents are implemented, proposal-only, or transitional

- `review/implementation-alignment-review.md`
  - earlier implementation/document alignment notes

## Recommended Reading Order

For current implementation:

1. `current/ui.md`
2. `pipeline/pre-ent.md`
3. `pipeline/state.md`
4. `pipeline/scene.md`
5. `pipeline/sub.md`
6. `pipeline/visual-current.md`
7. `pipeline/final.md`
8. `review/current-implementation-vs-docs.md`

For the next architecture:

1. `support/reader-support-design.md`
2. `research/narrative-relation-graph.md`
3. `research/direction-roadmap.md`
4. `support/roadmap.md`
5. `support/memory-schema.md`
6. `support/pipeline-plan.md`
7. `support/reliability-and-ops-plan.md`

For research contribution discussion:

1. `research/direction-roadmap.md`
2. `research/narrative-relation-graph.md`
3. `research/evaluation-plan.md`
4. `review/current-implementation-vs-docs.md`

