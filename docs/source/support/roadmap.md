# Support System Roadmap

## 1. Purpose

This document turns the support-design discussion into an execution roadmap.

The goal is to help the project move from:

- a strong extraction pipeline

to:

- a document-aware reader-support system

with:

- stable data structures
- explicit implementation order
- decision gates
- evaluation milestones

This roadmap is intentionally practical.
It focuses on what should be built next, in what order, and why.

---

## 2. Strategic Direction

The next stage should not be:

- "add one more prompt"
- "make images prettier"
- "show more metadata"

The next stage should be:

1. build document-level memory
2. derive support-ready intermediate representations
3. generate a small number of high-value support forms
4. choose when to show them
5. evaluate whether they actually help reading recovery

In short:

`pipeline completion -> support architecture -> interface behavior -> evaluation`

---

## 3. Workstreams

The project can be split into six workstreams.

## 3.1 Workstream A: Data Foundation

Main question:

- can the system remember story state across scenes and chapters?

Includes:

- document-level memory schema
- event graph
- place graph
- relation timeline
- evidence indexing

## 3.2 Workstream B: Support Generation

Main question:

- can the system generate multiple useful support forms from shared structure?

Includes:

- shared support representation
- snapshot generation
- delta chips
- causal bridge
- character/relation cards
- re-entry support

## 3.3 Workstream C: VIS Repositioning

Main question:

- when is visual support actually helpful, and how should it behave?

Includes:

- usefulness scoring
- visual metadata
- continuity control
- schematic fallback

## 3.4 Workstream D: Reader UI Policy

Main question:

- which support should appear by default, on hover, on click, or only on trigger?

Includes:

- support exposure rules
- trigger definitions
- non-overwhelming UI composition
- integration into `FINAL.1` and `ReaderScreen`

## 3.5 Workstream E: Reliability and Operations

Main question:

- can the system stay grounded, debuggable, and stable enough for iteration?

Includes:

- prompt versioning
- artifact validation
- regression review
- latency/cost control
- observability

## 3.6 Workstream F: Research Evaluation

Main question:

- do the supports improve recovery, continuity, and re-entry?

Includes:

- offline evaluation
- annotation tasks
- prototype user study
- logging and analysis

---

## 4. Recommended Build Order

## Phase 0. Clarify decisions before implementation

Deliverables:

- freeze core support forms for first build
- freeze doc-level memory schema
- define support branch stage names

Must decide:

- which first support forms are in scope
- whether support artifacts are per-run or canonicalized across runs
- whether the reader UI should stay chapter-local initially

Recommendation:

- first support set:
  - current-state snapshot
  - boundary delta chips
  - causal bridge
  - character focus
  - re-entry recap

---

## Phase 1. Build document-level memory

Priority:

- highest

Why:

- almost every future support depends on retrieval from prior scenes/events

Tasks:

- add `documents/{docId}/memory/...` collections
- build scene ledger writer
- build event node writer
- build place graph writer
- build relation timeline writer
- build evidence index

Completion criteria:

- any scene can retrieve earlier:
  - place state
  - relevant event nodes
  - active character history
  - relation history

Main risk:

- overcomplicated schema before real usage

Mitigation:

- start with small normalized records and append-only history

---

## Phase 2. Build shared support representation

Priority:

- highest after memory

Why:

- support forms should not be generated independently from raw pipeline artifacts

Tasks:

- define `SharedSupportUnit`
- merge scene/subscene/memory retrieval into one support context
- attach evidence and confidence
- store per scene and subscene

Completion criteria:

- one scene/subscene can be converted into a stable support unit without UI-specific assumptions

Main risk:

- making the representation too presentation-specific

Mitigation:

- keep it content-first, not UI-first

---

## Phase 3. Build first-wave support artifacts

Priority:

- high

Tasks:

- `Current-State Snapshot`
- `Boundary Delta Chips`
- `Causal Bridge`
- `Character Focus`
- `Reference Repair`

Completion criteria:

- each support type can be generated as an artifact with evidence and confidence

Decision gate:

- if one support type is rarely useful or hard to ground, it should not be forced into the first release

---

## Phase 4. Integrate support policy into final reader assembly

Priority:

- high

Tasks:

- add support policy layer
- update `FINAL.1` builder
- update reader UI composition
- add trigger handling for:
  - boundary entry
  - re-entry
  - high ambiguity
  - high spatial shift

Completion criteria:

- the reader screen can show:
  - compact always-on supports
  - expandable supports
  - trigger-only supports

Main risk:

- turning the interface into a dashboard

Mitigation:

- strict display hierarchy and exposure rules

---

## Phase 5. Reposition VIS

Priority:

- medium

Tasks:

- add usefulness score
- add visual support metadata
- add place continuity memory
- add schematic fallback
- integrate VIS confidence into final display policy

Completion criteria:

- the system can justify why an image is shown
- the system can suppress low-value images

---

## Phase 6. Expand second-wave supports

Priority:

- medium

Tasks:

- relation delta card
- spatial continuity card
- goal-problem tracker
- evidence quote card
- optional retrospective tools

Completion criteria:

- support system can handle more than immediate state recovery

---

## Phase 7. Evaluation and study preparation

Priority:

- medium to high once first-wave supports are stable

Tasks:

- build offline evaluation datasets
- build inspection screens
- define study conditions
- add logging

Completion criteria:

- the system is ready for pilot study or internal reading sessions

---

## 5. Milestones

## Milestone M1: Support Memory Exists

Meaning:

- the system can retrieve story-relevant context from earlier scenes

Required:

- scene ledger
- event nodes
- causal edges
- place records

## Milestone M2: First Useful Supports Exist

Meaning:

- the project can produce more than image or local hint text

Required:

- snapshot
- chips
- causal bridge

## Milestone M3: Reader Policy Exists

Meaning:

- the system knows when and how to show each support

Required:

- support policy artifact
- final assembly integration

## Milestone M4: VIS Becomes Optional but Smarter

Meaning:

- image support is no longer assumed to be universally useful

Required:

- usefulness score
- continuity logic
- fallback mode

## Milestone M5: Evaluation Readiness

Meaning:

- the project can move from ideation to evidence

Required:

- evaluation set
- logging
- study protocol draft

---

## 6. Immediate Next Tasks

If implementation starts now, the best next tasks are:

1. create the doc-level memory schema and write path
2. define `SharedSupportUnit` in `schema.ts`
3. create a first support branch skeleton:
   - `SUP.0 memory builder`
   - `SUP.1 support representation`
   - `SUP.2 snapshot`
   - `SUP.3 delta chips`
4. update `FINAL.1` so it can receive support artifacts
5. postpone major VIS redesign until support branch basics are working

Reason:

- without memory and support representation, support forms will remain ad hoc

---

## 7. What to Document Next

The project should continue documentation in the following order:

1. memory schema and write/update policy
2. support branch stage specification
3. support policy and UI exposure rules
4. reliability and evaluation rules
5. annotation guide for causal and support usefulness judgments

---

## 8. What Not to Do Too Early

Avoid these early:

- large global graph UI
- complicated personalization logic
- too many support types at once
- deep VIS prompt over-optimization before support policy exists
- user study before artifact quality and reliability are stable

---

## 9. Final Recommendation

The best strategic move is:

`Treat support generation as a new branch of the pipeline, not as a thin extension of SUB or FINAL.`

That architectural decision will make later ideation, implementation, and evaluation much cleaner.
