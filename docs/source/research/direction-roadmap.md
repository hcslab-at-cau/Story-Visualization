# Research Direction and Milestone Roadmap

## 1. Current Reality

The current implementation is a useful prototype, but it is not yet a strong technical contribution.

Current system shape:

```text
EPUB parsing
  -> staged LLM calls
  -> JSON cleanup
  -> artifact storage
  -> inspection UI
  -> optional image generation
```

This is good engineering infrastructure, but weak as a research claim.

The next research step should not be:

- improve prompts only
- generate better scene images
- add more final reader cards directly from LLM output

The next research step should be:

`convert noisy LLM/stage outputs into a reliable, evidence-grounded, reader-position-aware narrative relation graph`

Then generate multiple reader supports as graph projections.

## 2. Proposed Research Thesis

Working thesis:

> We construct a reader-position-aware narrative relation graph from validated fiction-analysis artifacts. Instead of directly prompting LLMs to generate reader supports, the system first derives candidate narrative relations from scene-state differences, verifies them with evidence and narrative-scope constraints, and then generates multiple spoiler-safe reader-support artifacts from the graph.

Short version:

```text
validated scene artifacts
  -> state-diff relation candidates
  -> scope/evidence correction
  -> reader-position-aware narrative graph
  -> multiple support artifacts
```

This makes the contribution more than API orchestration.

## 3. Candidate Technical Contributions

## 3.1 Reader-position-aware Narrative Relation Graph

A graph where every node, edge, and support claim has:

- evidence references
- confidence
- reveal timing
- spoiler risk
- source run

This distinguishes the graph from a generic story knowledge graph.

## 3.2 State-diff Guided Relation Candidate Generation

Instead of asking an LLM to find all relations, the system derives candidate edges from structured state changes:

- place change -> `place_shift`
- time change -> `time_shift`
- cast turnover -> `cast_shift`
- goal/thread change -> `goal_shift` or `thread_continuation`
- relation change -> `relationship_delta`
- event/result link -> `causal`, `enables`, `blocks`, `resolves`

The LLM becomes a verifier/classifier, not the only generator.

## 3.3 Narrative Scope-aware Correction

The system separates:

- actual storyworld state
- memory
- imagination
- hypothetical statement
- metaphor
- dialogue claim
- unreliable claim

This directly targets observed errors such as imagined places being stored as actual locations.

## 3.4 Evidence-grounded Correction Loop

Before a graph claim is saved, the system checks:

- evidence exists
- evidence supports the claim
- claim does not violate scope
- claim is safe at the current reader position
- entity/place IDs are canonical
- duplicate edges are avoided

## 3.5 One Graph, Many Supports

The same graph should generate:

- Resume Card
- Shift Bridge
- Situation Snapshot
- Timeline
- Relation Delta
- Spatial Map
- Visual Support Spec
- Interaction Buttons

The research claim is not one support form. The claim is a reusable support-generation layer.

## 4. Research Questions

Recommended primary research questions:

1. Can state-diff guided relation extraction produce more stable narrative edges than direct LLM relation generation?
2. Can narrative-scope correction reduce false place/entity/state updates in fiction analysis?
3. Can evidence-grounded graph construction improve consistency across repeated LLM runs?
4. Can a single reader-position-aware graph generate multiple useful reader-support artifacts?
5. Do graph-derived supports improve reader situation-model recovery compared with direct summaries or direct LLM supports?

## 5. Baselines

The project needs baselines to make the technical contribution visible.

## 5.1 Direct LLM Support Baseline

Prompt an LLM directly:

- summarize current scene
- explain transition from previous scene
- generate timeline
- generate relation card

Compare against graph-derived supports.

## 5.2 Direct LLM Relation Baseline

Prompt an LLM:

- find all scene relations
- find causal links
- find chapter links

Compare against state-diff candidate + verifier pipeline.

## 5.3 No-scope-correction Baseline

Run graph construction without narrative scope handling.

Compare:

- false actual places
- false state updates
- unsupported edges

## 5.4 No-evidence-validation Baseline

Accept LLM claims without evidence checks.

Compare:

- evidence support rate
- contradiction rate
- duplicate edge rate

## 6. Evaluation Metrics

## 6.1 Graph Quality

- scene edge precision
- thread event precision
- chapter edge precision
- duplicate entity rate
- duplicate edge rate
- evidence support rate
- unsupported claim rate
- spoiler violation rate

## 6.2 Scope and Correction Quality

- imagined/hypothetical place false-positive rate
- memory vs present-state confusion rate
- dialogue-claim-as-fact error rate
- correction acceptance/rejection accuracy

## 6.3 Consistency

- trial-to-trial edge stability
- canonical entity stability
- thread status stability
- support text consistency for the same graph

## 6.4 Reader Support Quality

- usefulness rating
- correctness rating
- conciseness rating
- current-state recovery accuracy
- transition understanding accuracy
- time to recover context

## 7. Milestones

## M0. Research Framing Freeze

Goal:

- stop treating image generation as the main contribution
- define the contribution around graph construction and correction

Deliverables:

- final system diagram
- contribution statement
- baseline list
- first evaluation chapter selection

Exit criteria:

- the team can explain the project in one sentence without mentioning image generation first

## M1. Evidence + Reveal Index

Goal:

- create the grounding layer used by all later graph claims

Inputs:

- `PRE.1`
- `PRE.2`
- raw chapter text
- paragraph/text-unit IDs

Deliverables:

- text unit index
- story/non-story flags
- evidence reference format
- reveal-order model

Todo:

- define `EvidenceRef`
- define `TextUnitRef`
- define `revealAtTextUnitId`
- map paragraph IDs to scene/subscene IDs
- build retrieval helper for evidence spans

Exit criteria:

- every stage artifact can point back to stable text units

## M2. Scene State Ledger

Goal:

- convert existing scene and subscene artifacts into entry/exit state records

Primary inputs:

- `SCENE.1`
- `SCENE.3`
- `SUB.2`
- `SUB.3`

Supporting inputs:

- `STATE.2`
- `STATE.3`
- `ENT.3`
- Evidence + Reveal Index

Deliverables:

- `SceneState`
- `SituationState`
- `SceneEntryState`
- `SceneExitState`

Todo:

- define state schema
- build state extraction/merge function
- distinguish scene-level and subscene-level state
- attach evidence refs
- store confidence and source stage

Exit criteria:

- each scene has a compact, evidence-linked entry and exit state

## M3. State Delta Builder

Goal:

- compute deterministic relation candidates from adjacent scene states

Deliverables:

- `StateDelta`
- candidate edge generator
- delta scoring

Todo:

- implement place delta
- implement time delta
- implement cast delta
- implement goal/thread delta
- implement relation delta candidate
- rank deltas by salience

Exit criteria:

- adjacent scene pairs produce inspectable candidate edges without LLM generation

## M4. Narrative Scope Layer

Goal:

- prevent imagined, remembered, hypothetical, or dialogue-only claims from corrupting actual story state

Deliverables:

- `NarrativeScope`
- scope classifier
- scope-aware state update rules

Todo:

- define scope vocabulary
- detect actual vs memory vs imagination vs hypothetical vs dialogue claim
- mark whether a mention affects current scene state
- add correction rule for false place updates
- add correction rule for claim-as-fact errors

Exit criteria:

- known false-place cases can be caught or downgraded before graph writing

## M5. Thread Ledger

Goal:

- track narrative continuity through goal, conflict, mystery, relationship, and object-clue threads

Deliverables:

- `NarrativeThread`
- `ThreadEvent`
- open/resolved thread status

Todo:

- define thread type vocabulary
- create thread candidate generation from `SCENE.3` and `SUB.2`
- link thread events to scenes
- update thread status conservatively
- attach evidence and reveal timing

Exit criteria:

- the system can say which threads are open, continuing, blocked, reframed, or resolved at a scene

## M6. Scene Relation Graph MVP

Goal:

- build the first real technical contribution layer

MVP edge types:

- `sequence`
- `place_shift`
- `time_shift`
- `cast_shift`
- `goal_shift`
- `causal`
- `enables`
- `blocks`
- `resolves`
- `thread_continuation`
- `relationship_delta`

Deliverables:

- scene edge schema
- candidate edge generator
- LLM verifier/classifier
- correction loop
- graph store

Todo:

- generate candidate edges from M3/M5
- verify each edge one at a time
- require evidence before save
- reject scope violations
- deduplicate similar edges
- compute confidence and importance

Exit criteria:

- one chapter has a sparse, evidence-linked scene relation graph

## M7. Chapter Relation Aggregation

Goal:

- derive chapter-level relations from scene edges and thread events

Deliverables:

- `ChapterEdge`
- aggregation rules
- chapter bridge summary

Todo:

- aggregate repeated thread continuation
- aggregate setup/resolution links
- aggregate callbacks
- aggregate relation progression
- enforce reveal timing

Exit criteria:

- chapter-level links can be explained through supporting scene edges

## M8. First Graph-derived Supports

Goal:

- demonstrate that one graph can generate multiple supports

First support artifacts:

- Current-State Snapshot
- Shift Bridge
- Resume Card
- simple Timeline
- Relation Delta

Todo:

- define artifact schemas
- generate supports from graph queries
- keep generation short and evidence-linked
- compare with direct LLM baseline

Exit criteria:

- the same graph produces at least three useful supports for one chapter

## M9. Evaluation Pack

Goal:

- prepare evidence that the method is better than direct LLM generation

Deliverables:

- annotated evaluation set
- baseline outputs
- graph outputs
- scoring spreadsheet or evaluation UI

Todo:

- select 2 to 3 chapters
- annotate scene states
- annotate true/false relation edges
- annotate scope cases
- score baseline vs graph outputs
- measure trial consistency

Exit criteria:

- the project can report quantitative graph quality and qualitative support usefulness

## M10. Reader-facing Integration

Goal:

- integrate graph-derived supports into the existing reader without turning it into a dashboard

Deliverables:

- support display policy
- updated `FINAL.1`
- reader UI support slots
- optional visual support generator

Todo:

- define always-visible vs expandable vs trigger-only supports
- make visual support optional
- keep `SUB.4` as legacy/local support until replaced
- run UI checks on one chapter

Exit criteria:

- ReaderScreen displays graph-derived support artifacts selectively

## 8. Near-term Todo List

Do these first:

1. Freeze the revised architecture diagram without standalone VIS.
2. Define `EvidenceRef`, `TextUnitRef`, and `RevealPosition`.
3. Define `SceneState`, `SituationState`, and `StateDelta`.
4. Build a script/stage that converts current `SCENE.1`, `SCENE.3`, `SUB.2`, `SUB.3` into scene state records.
5. Implement deterministic adjacent-scene delta detection.
6. Add `NarrativeScope` fields and correction rules for imagined/hypothetical places.
7. Define `NarrativeThread` and `ThreadEvent`.
8. Generate MVP scene edge candidates from state deltas and threads.
9. Build a one-edge-at-a-time LLM verifier.
10. Create an inspection table for scene states, deltas, threads, and edges.
11. Generate three supports from the graph: Snapshot, Shift Bridge, Resume Card.
12. Compare against direct LLM outputs for the same scenes.

## 9. What to Avoid for Now

Avoid:

- optimizing image prompts
- building a full graph viewer
- adding many support forms at once
- moving to Neo4j early
- building personalization before graph quality is known
- using LLM direct generation as the main path for every support

These can come later, after the graph and correction layer works.

## 10. Recommended Paper Framing

Weak framing:

> We use LLMs to extract story structure and generate reader support.

Stronger framing:

> We propose a state-diff guided, scope-aware narrative relation graph construction method for fiction reader support. The method turns validated scene and subscene artifacts into evidence-grounded, spoiler-safe graph claims, then generates multiple reader-support artifacts as graph projections.

Potential title direction:

- `State-Diff Guided Narrative Relation Graphs for Fiction Reader Support`
- `Evidence-grounded Narrative Graph Construction for Situation-model Recovery`
- `Reader-position-aware Narrative Relation Graphs for Spoiler-safe Fiction Support`

## 11. Final Recommendation

The next research phase should focus on this sequence:

```text
Evidence Index
  -> Scene Entry/Exit State
  -> State Delta
  -> Narrative Scope
  -> Thread Ledger
  -> Scene Relation Graph
  -> Graph-derived Supports
  -> Baseline Comparison
```

This is the shortest path from the current prototype to a defensible technical contribution.

