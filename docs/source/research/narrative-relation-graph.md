# Narrative Relation Graph Proposal

## 1. Position

The proposed direction is mostly right.

The project should not treat the next step as:

- better image prompts
- one more reader card
- a larger final summary

The stronger direction is:

`validated extraction -> evidence-grounded narrative relation graph -> multiple reader-support artifacts`

The reason is simple: Resume Card, Shift Bridge, Situation Snapshot, Timeline, Relation View, Spatial Map, Scene Image, and Interaction Button all need the same underlying information.

They all ask:

- who is present?
- where and when is this happening?
- what changed from the previous scene?
- what goal, conflict, or question is active?
- what earlier event or thread explains the current moment?
- what can be shown without spoiling unread text?

So the missing layer is not one specific artifact. The missing layer is a stable narrative data layer.

Recommended name:

- `Narrative Relation Graph`

Alternative implementation name:

- `Reader-position-aware Narrative Graph`

The second name is more precise because every node and edge must know when it is safe to reveal.

## 2. How This Fits Current Documents

Existing documents already point in this direction:

- `../support/reader-support-design.md` identifies the support forms.
- `../support/roadmap.md` says the project needs document-level memory.
- `../support/memory-schema.md` proposes memory collections.
- `../support/pipeline-plan.md` proposes a `SUP.*` branch.

This document sharpens that direction:

`support memory` should not be only a set of scene summaries. It should become an evidence-linked graph of state, threads, and relations.

The graph should feed the `SUP.*` branch rather than replace it.

## 3. Main Recommendation

Build a graph-shaped intermediate representation before building more final UI artifacts.

High-level flow:

```text
TextUnit DB
  -> Raw Mention / State / Boundary / Scene Artifacts
  -> Canonical Entity + Scope Normalization
  -> Scene State Ledger
  -> Narrative Thread Ledger
  -> Scene Relation Graph
  -> Chapter Relation Graph
  -> Reader-facing Artifacts
     -> Resume Card
     -> Shift Bridge
     -> Situation Snapshot
     -> Timeline
     -> Relation Delta
     -> Spatial Map
     -> Scene Image
     -> Interaction Buttons
```

The important shift is:

`generate final support directly from scene output`

should become:

`derive final support from a shared relation graph`

## 4. Why a Graph Is Needed

The existing pipeline can produce useful scene-local information, but reader support often needs cross-scene and cross-chapter retrieval.

Examples:

- Timeline needs event order and temporal links.
- Relation View needs character-pair state changes across scenes.
- Shift Bridge needs previous-vs-current scene deltas.
- Resume Card needs the latest important unresolved changes before the current reader position.
- Spatial Map needs place continuity and movement edges.
- Cause-Effect Chip needs causal, enabling, blocking, or resolving edges.
- Scene Image needs current place, cast, objects, mood, and action, but it should also know which visual claims are safe.

These are not separate data problems. They are different projections of the same narrative graph.

## 5. Recommended Data Layers

The story still has a hierarchy:

```text
Book
  -> Chapter
     -> Scene
        -> Beat / Subscene
           -> TextUnit
```

But support requires graph edges across that hierarchy:

```text
Scene 3 -> causes -> Scene 7
Scene 4 -> place_shift -> Scene 5
Scene 6 -> relationship_delta -> Scene 8
Chapter 1 -> resolves_setup -> Chapter 4
Object clue -> callback -> later discovery
Mystery thread -> reframe -> later reveal
```

So the DB should be both:

- hierarchical for text location and ordering
- graph-like for narrative relations

## 6. Core Records

## 6.1 NarrativeNode

Use nodes for more than characters and places.

Recommended node types:

- `chapter`
- `scene`
- `beat`
- `event`
- `character`
- `place`
- `object`
- `relationship`
- `goal`
- `conflict`
- `mystery`
- `theme`
- `question`

Important fields:

- `id`
- `bookId`
- `type`
- `label`
- `summary`
- `startTextUnitId`
- `endTextUnitId`
- `firstMentionTextUnitId`
- `revealAtTextUnitId`
- `confidence`
- `evidenceTextUnitIds`
- `metadata`

The key design decision is to represent goal, conflict, mystery, and question as first-class nodes.

Reason:

- many chapter-to-chapter relationships are not "same character appears"
- they are "the same unresolved goal/conflict/mystery continues"

## 6.2 NarrativeThread

Threads are the most useful bridge between scenes and chapters.

Recommended thread types:

- `goal`
- `conflict`
- `mystery`
- `relationship`
- `object_clue`
- `background_knowledge`
- `theme`

Important fields:

- `id`
- `bookId`
- `type`
- `title`
- `description`
- `status`
- `ownerEntityIds`
- `introducedAtSceneId`
- `resolvedAtSceneId`
- `revealAtTextUnitId`
- `spoilerRisk`
- `evidenceTextUnitIds`

Recommended thread statuses:

- `opened`
- `progressing`
- `complicated`
- `partially_resolved`
- `resolved`
- `abandoned`
- `uncertain`

## 6.3 ThreadEvent

Thread events record how a thread behaves inside a scene.

Recommended roles:

- `introduce`
- `continue`
- `escalate`
- `block`
- `reveal`
- `reframe`
- `resolve`

This makes chapter-level bridges much more stable.

Example:

```text
Thread: "the suspicious phone call"
  Chapter 1 Scene 2: introduce
  Chapter 2 Scene 4: escalate
  Chapter 4 Scene 1: reveal
  Chapter 4 Scene 2: resolve
```

Then a Resume Card can say:

`The current scene returns to the suspicious-call thread opened in Chapter 1.`

without asking an LLM to infer the whole structure from scratch.

## 6.4 SceneState

Every scene should have entry and exit state.

```text
SceneState
  sceneId
  entryState
  exitState
  stateDelta[]
```

`SituationState` should include:

- active characters
- current location
- current time
- current POV
- current goals
- current conflicts
- open questions
- important objects
- relationship states
- mood
- tension
- evidence
- confidence

This is critical because many relation edges can be generated from state diffs.

Examples:

- entry/exit location changed -> `place_shift`
- active cast changed -> `cast_shift`
- goal changed -> `goal_shift`
- open question resolved -> `resolves`
- relationship state changed -> `relationship_delta`

## 6.5 SceneEdge

Scene edges should be reader-support claims, not just links.

Recommended edge types:

- `sequence`
- `time_shift`
- `place_shift`
- `cast_shift`
- `pov_shift`
- `goal_shift`
- `causal`
- `enables`
- `blocks`
- `resolves`
- `reveals`
- `callback`
- `parallel`
- `contrast`
- `relationship_delta`
- `object_transfer`
- `clue_progression`
- `emotional_shift`
- `theme_recurrence`

Important fields:

- `id`
- `sourceSceneId`
- `targetSceneId`
- `type`
- `claim`
- `before`
- `after`
- `relatedEntityIds`
- `relatedThreadIds`
- `evidenceTextUnitIds`
- `confidence`
- `importance`
- `revealAtTextUnitId`
- `spoilerRisk`
- `generatedFromRunId`

The `claim` field matters because UI artifacts can reuse it directly after compression.

## 6.6 ChapterEdge

Chapter edges should be aggregated from scene edges and thread events.

Do not ask the LLM for abstract chapter relations first. Build scene-level links first, then aggregate.

Recommended chapter edge types:

- `continues_thread`
- `resolves_setup`
- `callback`
- `parallel_structure`
- `contrast`
- `same_location_return`
- `relationship_progression`
- `pov_reframe`
- `time_jump`
- `arc_transition`

Important fields:

- `id`
- `sourceChapterId`
- `targetChapterId`
- `type`
- `summary`
- `supportingSceneEdgeIds`
- `relatedThreadIds`
- `relatedEntityIds`
- `evidenceTextUnitIds`
- `confidence`
- `importance`
- `revealAtTextUnitId`

## 7. Narrative Scope

This is a high-priority reliability requirement.

Every mention, event, place, and relation claim should carry narrative scope when relevant.

Recommended scope values:

- `actual_storyworld`
- `memory`
- `imagination`
- `hypothetical`
- `metaphor`
- `dialogue_claim`
- `unreliable_claim`

Recommended fields:

- `realityStatus`
- `scopeOwnerEntityId`
- `scopeStartTextUnitId`
- `scopeEndTextUnitId`
- `affectsCurrentSceneState`

Why this matters:

- imagined places should not become actual locations
- memories should not always update present-time state
- dialogue claims should not become facts unless validated
- unreliable or hypothetical statements should not create hard graph edges

Example:

```json
{
  "surfaceText": "New Zealand",
  "type": "place",
  "scope": {
    "realityStatus": "imagination",
    "scopeOwnerEntityId": "char_alice"
  },
  "affectsCurrentSceneState": false
}
```

This prevents false `place_shift` edges.

## 8. Evidence and Spoiler Policy

Every graph record must be evidence-linked.

Required fields:

- `evidenceTextUnitIds`
- `confidence`
- `revealAtTextUnitId`
- `spoilerRisk`
- `generatedFromRunId`

Rules:

- A support claim cannot be shown before its `revealAtTextUnitId`.
- High spoiler-risk edges should be excluded from normal reader support.
- Claims without evidence should stay in a correction queue, not the canonical graph.
- Evidence must point to actual text units or validated upstream artifacts.

This is the main difference between a useful support graph and a hallucinated knowledge graph.

## 9. Generation Strategy

Do not ask an LLM to "find all relations."

Use a three-step process.

## Step 1. Candidate Edge Generation

Generate candidates with deterministic rules.

Examples:

- adjacent scene pair -> `sequence`
- location changes -> `place_shift`
- time changes -> `time_shift`
- active cast changes -> `cast_shift`
- active thread changes -> `goal_shift` or `thread_continuation`
- recurring object appears -> `object_continuity`
- relation state changes -> `relationship_delta`

## Step 2. LLM Relation Classifier

Give the LLM one candidate at a time.

The task should be narrow:

- is this relation real?
- what relation type is best?
- what is the reader-facing claim?
- what evidence supports it?
- when is it safe to reveal?
- does narrative scope block this edge?

## Step 3. Correction Loop

Before writing the edge, validate:

1. evidence exists in the text
2. claim does not contradict evidence
3. imagined/hypothetical/memory scopes are not treated as actual events
4. reader-position safety is respected
5. entity IDs are canonical, not duplicated
6. edge is not a duplicate of an existing edge
7. confidence and importance are calibrated

This structure is better than prompt-only iteration because failures become inspectable.

## 10. Importance Score

Every edge should have an importance score.

Suggested components:

- `narrativeImpact`
- `readerRelevance`
- `recurrenceStrength`
- `unresolvedThreadWeight`
- `boundaryStrength`
- `evidenceConfidence`

Use importance to keep UI selective.

Examples:

- Resume Card uses high-importance recent edges.
- Timeline uses temporal, causal, and resolve edges.
- Relation View uses relationship deltas.
- Spatial Map uses place-shift edges.
- Scene Image uses current state plus spatially relevant edges.

## 11. Artifact Mapping

| Artifact | Required graph data |
|---|---|
| Resume Card | current scene state, latest important edge, open threads |
| Shift Bridge | state delta, time/place/cast/pov/goal shift edges |
| Situation Snapshot | active cast, location, time, goal, conflict, why-it-matters |
| Timeline | event nodes, temporal edges, causal edges |
| Relation View | character nodes, relationship states, relationship-delta edges |
| Chapter Relation Map | chapter edges, shared threads, callbacks, resolutions |
| Spatial Map | place nodes, movement edges, scene-location mapping |
| Scene Image / Stage | scene state, place, cast, objects, mood, action |
| Cause-Effect Chip | causal, enables, blocks, resolves edges |
| Mystery Hook | open mystery threads and unresolved questions |
| Object Focus | object nodes and clue-progression edges |
| Q&A Button | graph query plus evidence spans |

This is the main reason the graph is worth building: one data layer can generate many support forms.

## 12. Minimal Viable Graph

Do not build the whole graph first.

MVP relation types:

1. `sequence`
2. state delta edges:
   - `time_shift`
   - `place_shift`
   - `cast_shift`
   - `goal_shift`
3. causal edges:
   - `causal`
   - `enables`
   - `blocks`
   - `resolves`
4. `thread_continuation`
5. `relationship_delta`

MVP records:

- scene state entry/exit
- state delta
- narrative thread
- thread event
- scene edge
- chapter edge aggregation

MVP generated artifacts:

- Resume Card
- Shift Bridge
- Situation Snapshot
- simple Timeline
- Relation Delta
- Goal/Mystery Hook

This is enough to demonstrate that the project can generate several reader supports from one shared graph.

## 13. Implementation Plan

## Phase 1. Scene State Ledger

Inputs:

- `STATE.2`
- `STATE.3`
- `SCENE.1`
- `SCENE.3`
- `SUB.2`
- `SUB.3`

Outputs:

- scene entry state
- scene exit state
- active cast/place/time/goals/questions
- evidence refs
- scope flags

## Phase 2. State Delta Builder

Compute deltas between adjacent scenes.

Outputs:

- location delta
- time delta
- cast delta
- goal/thread delta
- relationship delta candidates

## Phase 3. Narrative Thread Ledger

Start with conservative thread types:

- goal
- conflict
- mystery
- relationship
- object clue

Outputs:

- thread records
- thread events per scene
- open/resolved status

## Phase 4. Scene Edge Candidate Builder

Generate candidate edges from:

- state deltas
- thread events
- recurring entities
- recurring objects
- relation state changes

## Phase 5. Relation Classifier and Correction Loop

Use an LLM only for:

- relation confirmation
- claim wording
- evidence selection if deterministic evidence is insufficient

Then validate before saving.

## Phase 6. Chapter Edge Aggregator

Aggregate from:

- scene edges
- thread events
- repeated entities/objects/places

Do not create chapter edges independently from raw chapter summaries.

## Phase 7. First Artifact Generators

Build:

- Resume Card
- Shift Bridge
- Situation Snapshot
- Timeline
- Relation Delta

Only after these work should image-specific improvements become the focus again.

## 14. Relationship to `SUP.*`

This graph should live inside the support branch.

Recommended mapping:

- `SUP.0` Support Memory Build
  - scene state ledger
  - thread ledger
  - graph node/edge write
- `SUP.1` Shared Support Representation
  - retrieve graph records for current scene/subscene
  - rank relevant edges and threads
- `SUP.2+` Support Artifact Generators
  - generate snapshots, chips, bridges, cards, recap
- `SUP.7` Support Policy Selection
  - decide which graph-derived supports to show

Avoid adding a separate top-level branch unless the implementation becomes too large.

## 15. Practical Storage Recommendation

The MVP does not need Neo4j.

Firestore, PostgreSQL, or SQLite are enough if the schema keeps nodes, edges, evidence, and metadata separate.

Minimum tables or collections:

- `nodes`
- `edges`
- `node_evidence`
- `edge_evidence`
- `scene_states`
- `state_deltas`
- `threads`
- `thread_events`
- `chapter_edges`

The DB choice is less important than the invariant:

`every graph claim must have evidence and reveal timing`

## 16. Main Risks

## Risk 1. Graph bloat

If every weak relation is stored, the graph becomes noise.

Mitigation:

- start sparse
- require evidence
- rank by importance
- keep low-confidence claims in review/candidate state

## Risk 2. False certainty

LLM-generated claims may sound more certain than the text allows.

Mitigation:

- separate explicit, strong inference, and weak inference
- expose confidence internally
- avoid reader-facing claims from weak inference

## Risk 3. Spoilers

Cross-chapter edges can accidentally reveal future information.

Mitigation:

- mandatory `revealAtTextUnitId`
- reader-position filter before any display
- chapter-edge aggregation must respect reveal timing

## Risk 4. Scope errors

Imagined, remembered, hypothetical, or unreliable content can corrupt scene state.

Mitigation:

- add NarrativeScope early
- block actual state updates from non-actual scopes unless explicitly intended

## Risk 5. Overbuilding before demo value

A full graph system can become too large before producing visible results.

Mitigation:

- build only scene state, thread, and five edge types first
- show multiple artifacts generated from one chapter graph

## 17. Recommended Demo for Next Meeting

Use one chapter and show:

1. scene list
2. each scene's entry and exit state
3. detected state deltas
4. open and resolved narrative threads
5. scene relation edges
6. chapter-level bridge summary if multiple chapters are available
7. generated Resume Card
8. generated Shift Bridge
9. generated Timeline or Relation Delta

The goal is to show:

`one relation graph -> multiple reader supports`

This is more persuasive than showing another image generation run.

## 18. Final Recommendation

Adopt the Narrative Relation Graph as the next core architecture layer, but keep the first version conservative.

Build first:

- scene entry/exit state
- narrative scope
- state deltas
- thread ledger
- scene edges for five relation families
- chapter-edge aggregation from scene edges
- Resume Card / Shift Bridge / Situation Snapshot demo

Defer:

- full global graph UI
- dense dashboard
- graph database migration
- complex personalization
- image-first redesign

Research framing:

`The system is not primarily an LLM scene-image generator. It is an evidence-grounded narrative relation graph builder that produces selective reader supports for situation-model recovery.`
