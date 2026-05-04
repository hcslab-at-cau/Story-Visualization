# Reader Support Design Proposal

## 1. Problem Restatement

The next stage of this project is not "make a longer summary."

The real target is:

- repair the reader's current situation model
- help the reader recover when scene/state tracking collapses
- provide the minimum support that is useful right now
- preserve evidence and causal grounding so supports stay trustworthy

The April 13, 2026 meeting slides and the 2026 JCCI slides point in the same direction:

- scene segmentation and scene representation are the base
- support should be generated from a shared scene representation
- image is only one form among many
- causal linkage, state recovery, and re-entry support matter as much as image support

This document expands the support space beyond `SUM / IDX / CAU / VIS`, evaluates which forms are worth building, and proposes how to implement them in this repository.

---

## 2. Current System Reading

The current repository already has strong intermediate structure.

Available structured assets:

- chapter text and paragraph IDs
- mention/entity clustering
- per-paragraph state tracking and scene boundaries
- scene packets with cast/place/time aggregation
- grounded scene index with actions, goals, relations, objects, environment
- subscene-level local state and intervention packaging
- scene blueprint and image generation pipeline

Relevant code:

- `src/types/schema.ts`
- `src/lib/pipeline/scene1.ts`
- `src/lib/pipeline/scene3.ts`
- `src/lib/pipeline/sub2.ts`
- `src/lib/pipeline/sub4.ts`
- `src/lib/pipeline/final1.ts`
- `src/lib/pipeline/vis1.ts`
- `src/lib/pipeline/vis2.ts`
- `src/lib/firestore.ts`

Current limitation:

- storage is mostly `document -> chapter -> run -> artifact`
- most reasoning is still chapter-local
- there is no stable doc-level memory for events, recurring entities, causal edges, relation changes, or cross-scene retrieval
- final reader support is still biased toward `scene packet + local subscene hints + optional image`

So the next step should be:

1. build a doc-level support memory
2. generate multiple support forms from that memory
3. decide which form to show based on reader state and trigger timing

---

## 3. Design Principle

The support form should be judged by one question:

`Does this help the reader reconnect to the current story state faster than raw rereading?`

Useful forms tend to satisfy four conditions:

- local: tied to the current scene/subscene
- contrastive: emphasizes what changed
- grounded: can point to evidence span or source state
- selective: does not dump all metadata at once

Bad forms usually fail because they are:

- too global
- too decorative
- too inferential without evidence
- too dense for the reading moment

---

## 4. Expanded Support Inventory

### 4.1 Core Forms: strong candidates

These are the forms most aligned with the project goal and current pipeline.

#### A. Current-State Snapshot

Purpose:

- answer "where are we, who is here, what is going on now?"

Reader problem:

- loses current time/place/cast/goal alignment

Output shape:

- 3 to 5 short lines
- `place`
- `active cast`
- `immediate goal`
- `local problem`
- `why this moment matters`

Why it is strong:

- lowest cognitive load
- directly maps to situation-model recovery
- works for confusion and re-entry both

#### B. Boundary Delta Chips

Purpose:

- signal scene/subscene transition without forcing expansion

Reader problem:

- misses a shift in place/time/cast/goal

Output shape:

- short chips beside boundary or near current paragraph
- examples:
  - `Place shift`
  - `Rabbit exits`
  - `Goal changes`
  - `Flashback begins`

Why it is strong:

- fits the "just enough" philosophy
- can be always-on
- cheap to compute from existing state deltas

#### C. Causal Bridge

Purpose:

- answer "why did this happen now?"

Reader problem:

- current event feels unmotivated because earlier cause is forgotten

Output shape:

- 1 short causal sentence
- optional 2-step chain:
  - `Earlier: ...`
  - `So now: ...`

Why it is strong:

- directly addresses one of the most important failure modes in the slides
- uses subscene causal fields already present, but needs document-level linking

#### D. Character Focus Card

Purpose:

- answer "what is this character doing / wanting in this moment?"

Reader problem:

- many names, long dialogue, unclear role of each person

Output shape:

- one card per active character on demand
- `role in this beat`
- `current intention`
- `constraint`
- `recent change`

Why it is strong:

- builds on current `SUB.4 character_units`
- especially useful in dialogue-heavy scenes

#### E. Relation Delta Card

Purpose:

- answer "what changed between these two characters?"

Reader problem:

- social alignment shifts are easy to miss even when character names are remembered

Output shape:

- pair-level short card
- `before`
- `now`
- `change`
- `why it matters`

Why it is strong:

- relation change is often more important than plain cast listing
- current pipeline already has scene relations and pair-level hint slots

#### F. Spatial Continuity Card

Purpose:

- answer "how did we get here?" or "what space are we in now?"

Reader problem:

- movement across spaces, nested spaces, confusing described layouts

Output shape:

- compact place chain or mini spatial note
- `previous place -> current place`
- `current space cues`
- `mentioned but not current places`

Why it is strong:

- strongly supported by narrative comprehension literature on spatial updating
- more reliable and cheaper than a full map

#### G. Re-entry Recap

Purpose:

- help after pause or chapter return

Reader problem:

- reader returns after hours/days and no longer remembers scene momentum

Output shape:

- 3-part compact recall:
  - `current state`
  - `most recent turning points`
  - `unfinished tension`

Why it is strong:

- one of the clearest practical use cases
- differs from ordinary summary because it is anchored to the current re-entry point

#### H. Reference Repair

Purpose:

- resolve ambiguous mentions and dialogue references

Reader problem:

- "he", "she", titles, kinship labels, role labels become hard to resolve

Output shape:

- short alias resolution
- `he = Mr. X`
- `the girl = Alice`
- `the doctor = Dr. Y`

Why it is strong:

- cheap but high value
- especially useful in long dialogue sequences and multi-character scenes

---

### 4.2 Secondary Forms: useful but conditional

These can be good, but should not be treated as always-on core support.

#### I. Scene Image

Good when:

- place and cast configuration matter
- the scene has stable spatial structure
- the image is visually conservative and consistent

Not enough by itself because:

- image rarely captures causal linkage, shifting goals, or social nuance
- may mislead if over-interpreted

#### J. Evidence Quote Card

Purpose:

- show one or two decisive text spans behind a support claim

Good when:

- user distrust or explainability matters
- a support claim is slightly inferential

Risk:

- too much quoting breaks reading flow

#### K. Goal-Problem Tracker

Purpose:

- make local pursuit structure visible

Good when:

- the narrative is action/problem-solving heavy

Risk:

- less useful in reflective or atmospheric scenes

#### L. Prediction Prompt / Reflective Question

Purpose:

- encourage active reading rather than passive help

Good when:

- the project later studies learning/engagement outcomes

Risk:

- can interrupt reading
- feels pedagogical rather than restorative if overused

---

### 4.3 Overkill or weak forms

These are not wrong in theory, but likely too heavy for the current goal.

#### M. Full Story Graph Viewer

Why it is too much now:

- strong for retrospective analysis
- weak for immediate scene recovery
- high UI and data complexity

#### N. Always-visible global timeline

Why it is too much now:

- pushes the reader into meta-navigation too often
- may work for analysis mode, not default reading mode

#### O. Dense knowledge-panel dashboard

Why it is too much now:

- too many panels compete with the main reading task
- violates the minimal repair principle

#### P. Heavy image-first interface

Why it is too much now:

- turns support into illustration consumption
- weak for causal and relation repair

---

## 5. Recommended Form Portfolio

### Tier 1: build first

- Current-State Snapshot
- Boundary Delta Chips
- Causal Bridge
- Character Focus Card
- Re-entry Recap
- Reference Repair

### Tier 2: build next

- Relation Delta Card
- Spatial Continuity Card
- Scene Image
- Evidence Quote Card

### Tier 3: conditional / experimental

- Goal-Problem Tracker
- Prediction Prompt
- retrospective graph/timeline tools

---

## 6. Implementation Strategy Per Form

## 6.1 Current-State Snapshot

### Use current data

- `STATE.2` validated state
- `SCENE.3` validated scene index
- `SUB.2` local goal / problem / causal result
- `SUB.4` compact language if available

### Processing

1. retrieve active scene and active subscene
2. merge:
   - current place
   - active cast
   - local goal
   - local problem
   - one action summary
3. compress to 3 to 5 short fields with evidence pointers

### New artifact

- `SUP.1 CurrentStateSnapshot`

### New system need

- support artifact stage runner
- field-level evidence linking

---

## 6.2 Boundary Delta Chips

### Use current data

- `STATE.3` boundaries
- `SCENE.1` scene packet start/end states
- `SUB.3` validated subscenes

### Processing

1. compute previous vs current delta
2. map delta to chip vocabulary:
   - place shift
   - time shift
   - cast turnover
   - goal update
   - memory mode shift
3. rank chips by salience

### New artifact

- `SUP.2 BoundaryDelta`

### New system need

- delta scoring layer
- chip vocabulary and severity mapping

---

## 6.3 Causal Bridge

### Use current data

- `SUB.2 causal_input / causal_result`
- `SCENE.3 main_actions / goals / relations`
- previous scene packet end state

### Processing

1. create event nodes from subscenes
2. connect edges:
   - causes
   - enables
   - blocks
   - reveals
   - escalates
3. for the current subscene, retrieve the nearest earlier causal parent
4. ask LLM for one short bridge sentence grounded in both source and target evidence

### New artifact

- `SUP.3 CausalBridge`

### New system need

- document-level event graph
- edge extraction and validation
- retrieval for prior causally linked nodes

---

## 6.4 Character Focus Card

### Use current data

- `ENT.3`
- `SCENE.3 onstage_cast / goals / actions / relations`
- `SUB.2`
- `SUB.4 character_units`

### Processing

1. resolve character identity from current scene
2. collect local role, goal, problem, and recent changes
3. fill missing fields from scene-level evidence only when needed
4. generate one concise character repair card

### New artifact

- `SUP.4 CharacterFocus`

### New system need

- character memory profile across scenes
- alias handling for mentions and reader-facing names

---

## 6.5 Relation Delta Card

### Use current data

- `SCENE.3 relations`
- `SUB.4 pair_units`
- previous scene/subscene relation state

### Processing

1. normalize relation tuples
2. compare current relation tuple with prior relation tuple
3. detect:
   - alliance formed
   - trust dropped
   - tension rose
   - deception exposed
4. generate short pair delta explanation

### New artifact

- `SUP.5 RelationDelta`

### New system need

- relation timeline store
- pair-state diff logic

---

## 6.6 Spatial Continuity Card

### Use current data

- `STATE.2 current_place`
- `SCENE.1 current/mentioned_places`
- `SCENE.3 scene_place`
- `VIS.1` place clarification if available

### Processing

1. normalize current place identity
2. compare with previous place state
3. generate:
   - previous place
   - current place
   - transition cue
   - scene-specific spatial anchors

### New artifact

- `SUP.6 SpatialContinuity`

### New system need

- place graph
- place synonym normalization

---

## 6.7 Re-entry Recap

### Use current data

- all scene-level support memory

### Processing

1. detect re-entry event:
   - new session
   - user jumps into later chapter
   - long inactivity
2. gather:
   - current state snapshot
   - last 2 to 4 important turns linked to current scene
   - unresolved tension
3. compress into a recap anchored to the present reading point

### New artifact

- `SUP.7 ReentryRecap`

### New system need

- reader-state/session memory
- salience ranking for prior scenes/events

---

## 6.8 Reference Repair

### Use current data

- `ENT.3`
- paragraph-level text
- scene cast
- dialogue-local participants

### Processing

1. identify ambiguous local references
2. resolve candidate antecedents from onstage cast and recent mentions
3. return only high-confidence repairs

### New artifact

- `SUP.8 ReferenceRepair`

### New system need

- mention alias table
- confidence filter to avoid wrong repairs

---

## 6.9 Scene Image

### Use current data

- `VIS.1`
- `VIS.2`
- `VIS.3`
- `VIS.4`

### Processing

1. keep the image environment-first
2. use image as optional support, not default truth surface
3. fuse image with support metadata:
   - what changed
   - who matters
   - what not to infer from image

### New artifact

- existing `VIS.*`
- plus a small `VIS support metadata` layer

### New system need

- image-confidence/usefulness scoring
- consistency checks across adjacent scenes

---

## 7. Systems to Add

## 7.1 Document-Level Support Memory

This is the most important missing system.

### Proposed collections

`documents/{docId}/memory/entities/{entityId}`

- canonical name
- aliases
- type
- first_seen_scene
- latest_seen_scene
- relation partners

`documents/{docId}/memory/scenes/{sceneId}`

- chapter id
- scene index
- state summary
- active cast
- place
- time
- goal state
- evidence pointers

`documents/{docId}/memory/events/{eventId}`

- scene id
- subscene id
- actors
- place
- action summary
- local goal
- problem state
- causal input
- causal result
- evidence pids

`documents/{docId}/memory/edges/{edgeId}`

- from_event
- to_event
- edge_type
- confidence
- evidence

`documents/{docId}/memory/relations/{pairKey}`

- pair members
- timeline of relation states

`documents/{docId}/memory/places/{placeKey}`

- normalized place
- aliases
- neighboring places
- scenes used

### Why this is necessary

- support generation should retrieve prior causes, prior place states, prior relation states
- the current run/chapter artifact store is not enough for that job

---

## 7.2 Shared Support Representation

Instead of generating each support form directly from raw prior artifacts, create one stable intermediate layer.

### Proposed structure

`SharedSupportUnit`

- scene_id
- subscene_id
- support_target
- current_state
- delta_from_previous
- local_event
- causal_parent_candidates
- active_characters
- relation_candidates
- place_transition
- evidence_index
- retrieval_context

Then derive:

- snapshot
- chips
- causal bridge
- relation card
- re-entry recap
- image overlay metadata

This follows the direction already suggested in the JCCI slide.

---

## 7.3 Support Policy Layer

Different forms should not be shown the same way.

### Default exposure

- always visible:
  - Boundary Delta Chips
  - small Current-State Snapshot

### on click / on hover

- Character Focus Card
- Relation Delta Card
- Spatial Continuity Card
- Evidence Quote Card

### only on trigger

- Re-entry Recap
- Reference Repair
- Causal Bridge when confusion is likely

### trigger examples

- scene boundary entered
- large cast turnover
- large place shift
- inactivity resume
- dialogue density high
- pronoun ambiguity high

---

## 8. Proposed New Stage Layout

Current stage names can stay for the main extraction pipeline.

Add a support branch after `SCENE.3` and `SUB.4`.

### Suggested support stages

- `SUP.0` Document Memory Builder
- `SUP.1` Shared Support Representation Builder
- `SUP.2` Snapshot Generator
- `SUP.3` Delta Chip Generator
- `SUP.4` Causal Bridge Generator
- `SUP.5` Character/Relation Card Generator
- `SUP.6` Re-entry / Reference Repair Generator
- `SUP.7` Support Policy Selector

This branch should feed `FINAL.1` rather than being folded into `SUB.4`.

Reason:

- `SUB.4` is currently local and subscene-facing
- support generation should become a broader, document-aware branch

---

## 9. VIS: What Should Change

The VIS branch is no longer missing. It is implemented in this repository, but it should be repositioned.

Current VIS strengths:

- good separation of semantic clarification, blueprinting, render packaging, and image generation
- conservative environment-first prompts
- explicit forbid/avoid/must_not_show logic

Current VIS limitations:

- character support is intentionally removed from `VIS.2`
- image generation is environment-centric, so it is weak as a primary reading support
- there is little explicit linkage from VIS output back to causal, relational, and state-repair support
- no direct usefulness score for whether an image should be shown or suppressed
- continuity across adjacent scene images is not managed strongly

### Recommended VIS changes

#### VIS change 1. Split place image from support image intent

Keep one image type only for now, but conceptually distinguish:

- `place restoration image`: where are we
- `interaction cue image`: who matters and where

For now, build only the first one strongly.

#### VIS change 2. Add `visual usefulness score`

Each scene should be rated for whether image support is worth showing.

High usefulness:

- place is distinct
- spatial structure matters
- movement/entry/exit matters

Low usefulness:

- scene is mostly internal reflection
- scene is mainly verbal/social nuance
- image would add little beyond text

#### VIS change 3. Add continuity anchors across adjacent scenes

Store and reuse:

- canonical place key
- stable viewpoint family
- repeated structural elements
- palette/light family

This will reduce the feeling that every scene image is isolated.

#### VIS change 4. Add support-side metadata to VIS outputs

Each VIS result should expose:

- what spatial claim the image is meant to support
- what it should not be used to infer
- which support forms should accompany it

#### VIS change 5. Allow low-fidelity spatial diagrams as fallback

When image realism is unstable, allow a simpler spatial support mode:

- low-detail scene schematic
- no decorative illustration ambition

This is often better than a misleading image.

#### VIS change 6. Better integration with reader cards

Image should be paired with:

- current-state snapshot
- chips
- selected character focus or causal bridge

not shown alone as if it is self-sufficient.

---

## 10. Practical Build Order

### Phase 1

- add doc-level memory collections
- create `SharedSupportUnit`
- build Current-State Snapshot
- build Boundary Delta Chips

### Phase 2

- build Causal Bridge
- build Character Focus Card
- build Reference Repair
- add support policy layer

### Phase 3

- build Relation Delta Card
- build Spatial Continuity Card
- build Re-entry Recap
- connect support branch into `FINAL.1`

### Phase 4

- add VIS usefulness scoring
- add VIS continuity control
- add optional low-fidelity spatial fallback

---

## 11. Final Recommendation

If this project has to choose a small number of support forms that best fit the research goal, the best set is:

- Current-State Snapshot
- Boundary Delta Chips
- Causal Bridge
- Character Focus Card
- Re-entry Recap
- Scene Image as secondary support

The forms that look attractive but should not lead the design are:

- full story graph viewer
- always-open timeline dashboard
- image-first interface
- dense all-metadata side panels

The main architectural decision should be:

`Move from chapter-local artifact generation to document-level support memory plus selective support rendering.`

That is the change that will make the current pipeline feel like a real reader-support system rather than a well-structured extraction demo.

---

## 12. Reference Notes

The following works were especially useful for this proposal:

- Zehe et al., "Detecting Scenes in Fiction: A new Segmentation Task" (EACL 2021)
- Zehe et al., "Assessing the State of the Art in Scene Segmentation" (NAACL 2025)
- Zwaan and related event-indexing work on time/space/protagonist/causality/intentionality
- Rapp, Klug, and Taylor on spatial representation during narrative comprehension
- Trabasso and van den Broek on causal structure in narrative comprehension
- Cohn-Sheehy et al. on coherent narrative linkage and memory
- Paper Plain, ReaderQuizzer, CiteSee, Soliloquy, and The Semantic Reader Project as reading-interface precedents
