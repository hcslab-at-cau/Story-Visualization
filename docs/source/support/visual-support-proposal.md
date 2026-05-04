# VIS Improvement Proposal

## 1. Why Revisit VIS

VIS is now implemented in this repository:

- `src/lib/pipeline/vis1.ts`
- `src/lib/pipeline/vis2.ts`
- `src/lib/pipeline/vis3.ts`
- `src/lib/pipeline/vis4.ts`
- `src/app/api/pipeline/vis1/route.ts`
- `src/app/api/pipeline/vis2/route.ts`
- `src/app/api/pipeline/vis3/route.ts`
- `src/app/api/pipeline/vis4/route.ts`

That is good progress. But the current VIS branch is still optimized mainly for:

- generating a clean place image
- avoiding hallucinated layout errors
- keeping image prompts render-safe

This is necessary, but not sufficient for the research goal.

The research goal is not image generation itself.
It is reader state repair.

So VIS should be evaluated by:

`Does this visual help the reader recover the current scene state?`

---

## 2. Current VIS Strengths

## 2.1 Clear staged design

The current structure is good:

- `VIS.1` semantic clarification
- `VIS.2` blueprint extraction
- `VIS.3` render package compilation
- `VIS.4` image generation

This is much better than prompting image generation directly from raw scene text.

## 2.2 Strong anti-hallucination posture

The prompts already do useful things:

- distinguish current place from mentioned place
- keep layout and structure primary
- use `avoid`, `forbid`, and `must_not_show`
- avoid overfitting to decorative story props

## 2.3 Useful environment-first framing

The current VIS design correctly assumes that many scene images should be about:

- place structure
- navigable area
- boundaries
- composition constraints

not dramatic illustration.

---

## 3. Current VIS Weaknesses

## 3.1 VIS is treated as a support answer rather than a support component

Problem:

- the image is still easy to interpret as "the support"
- but image alone cannot reliably repair:
  - causality
  - relation change
  - local goal/problem
  - dialogue reference ambiguity

Required change:

- explicitly downgrade VIS from primary answer to one optional modality in a broader support bundle

## 3.2 Character support is weak by design

`VIS.2` explicitly removes character lists from the blueprint output.
This is reasonable for layout quality, but it creates a gap:

- the scene image knows the place
- the reader needs to know who matters in the place

Required change:

- keep layout-first image generation
- add a parallel `visual support metadata` layer that says:
  - which characters matter in this scene
  - which characters matter in this subscene
  - whether the image is suitable for character anchoring

## 3.3 No usefulness scoring

Some scenes benefit from image support a lot.
Some scenes do not.

Examples where VIS is strong:

- location shift
- entry into a new space
- chase, movement, navigation, concealment
- scenes where boundary layout matters

Examples where VIS is weak:

- introspection-heavy scenes
- social nuance without strong spatial change
- scenes where the key difficulty is causal, not spatial

Required change:

- compute a `visual_usefulness_score`
- suppress or down-rank images when usefulness is low

## 3.4 Weak scene-to-scene continuity

Even when the same place recurs, current VIS does not strongly enforce:

- viewpoint continuity
- palette continuity
- structural element persistence
- place identity continuity

Required change:

- store continuity anchors by `canonical_place_key`
- reuse them across later scene renders

## 3.5 No fallback visual mode besides normal image generation

When image generation is unstable, the current branch mostly falls back to "no image."

Required change:

- support a low-fidelity visual fallback:
  - simple place schematic
  - restrained spatial diagram
  - very low-detail support image

That is often better than a bad image.

---

## 4. Recommended VIS Direction

## 4.1 Reframe VIS as three visual support modes

Rather than treating VIS as one thing, it should conceptually support three modes.

### Mode A. Place Restoration Visual

Question answered:

- where are we?

Best for:

- spatial recovery
- boundary crossing
- re-entry into recurring place

Current system already approximates this mode well.

### Mode B. Interaction Anchor Visual

Question answered:

- who matters here and where should I attend?

Best for:

- scenes with small active cast and strong local interaction

Current system only partially supports this through overlay buttons.

### Mode C. Spatial Schematic

Question answered:

- how is this space organized?

Best for:

- confusing layout
- movement through multiple regions
- unstable realistic image generation

Current system does not explicitly support this mode yet.

Recommendation:

- build Mode A first
- treat Mode B as metadata + overlay support
- add Mode C as fallback

---

## 5. Concrete VIS Changes

## 5.1 Add `visual_usefulness_score`

### Purpose

- decide whether image support should be shown at all

### Suggested fields

- `visual_usefulness_score: number`
- `visual_usefulness_reason: string[]`
- `visual_primary_role: "place_restore" | "interaction_anchor" | "spatial_schematic" | "low_value"`

### Inputs

- `SCENE.3` place/environment/actions
- `SUB.2` action_mode/problem_state
- `STATE.3` boundary reasons
- `VIS.1` semantic clarification

### Heuristic examples

Increase score if:

- place shift exists
- environment is newly established
- scene has movement or pursuit
- scene has multiple meaningful zones

Decrease score if:

- scene is mostly reflection
- current place is already stable and familiar
- primary confusion is relational or causal only

### Implementation

Add a rule-based scorer in `vis1.ts` or a small post-processing file such as:

- `src/lib/pipeline/vis-support-score.ts`

---

## 5.2 Add continuity memory by place

### Purpose

- reduce visual drift across scenes in the same place

### Store by `canonical_place_key`

- preferred viewpoint family
- major boundaries
- recurring structural elements
- palette/light family
- scene archetype

### Implementation

Add doc-level memory records:

- `documents/{docId}/memory/place_visuals/{canonicalPlaceKey}`

Then when running `VIS.2` and `VIS.3`, inject continuity hints if:

- same `canonical_place_key`
- same or adjacent chapter recurrence

---

## 5.3 Add visual support metadata

### Purpose

- clarify what the image is supposed to help with

### Suggested fields

- `supports_place_repair: boolean`
- `supports_cast_orientation: boolean`
- `supports_motion_orientation: boolean`
- `supports_causal_repair: boolean`
- `not_reliable_for: string[]`

Example:

- reliable for:
  - current place
  - rough movement path
- not reliable for:
  - precise relation status
  - hidden motives

### Implementation

Either:

- extend `VisualGroundingPacket`

or:

- add a new small artifact `VIS.X SupportMetadata`

---

## 5.4 Add schematic fallback mode

### Purpose

- offer a safer visual when realistic image generation is too unstable or too interpretive

### Suggested output style

- low-detail, low-ornament
- no human figure
- emphasized zones and navigable structure
- visually calm, not dramatic

### Trigger

- low generation confidence
- repeated failure
- low blueprint validity
- low image usefulness but high spatial confusion

### Implementation path

Option 1:

- make `VIS.3` compile a second prompt variant for schematic mode

Option 2:

- add `VIS.3b schematic render package`

Recommendation:

- keep it simple and add a second prompt variant inside `VIS.3`

---

## 5.5 Improve integration with `FINAL.1`

Current `FINAL.1` already chooses image vs blueprint block.
It should also choose how strongly VIS participates in the support bundle.

### Suggested integration logic

If `visual_usefulness_score` is high:

- show image prominently
- pair it with small state snapshot

If medium:

- show image collapsed or secondary
- pair it with chips and one focused card

If low:

- suppress image by default
- rely on text-side supports first

### Implementation

Extend `VisualBlock` in `schema.ts` with:

- `visual_usefulness_score`
- `visual_primary_role`
- `not_reliable_for`

Then update `final1.ts` and `ReaderScreen.tsx`.

---

## 5.6 Make overlay refinement scene-correct before scene-empty

`FINAL.2` already prefers semantic plausibility over readability.
That is good.

But overlays would improve if they had extra input from support metadata:

- whether character placement actually matters in this scene
- whether characters should cluster
- whether the image is just a place restoration view

### Implementation

Pass extra fields into `refineOverlay()`:

- `visual_primary_role`
- `supports_cast_orientation`
- `supports_motion_orientation`

If the image is place-only:

- keep overlay conservative
- avoid pretending the image carries character evidence

---

## 6. Changes by File

## 6.1 Suggested schema updates

Update `src/types/schema.ts`.

### `VisualGroundingPacket`

Add:

- `visual_usefulness_score?: number`
- `visual_usefulness_reason?: string[]`
- `visual_primary_role?: string`

### `StageBlueprintPacket`

Add:

- `supports_place_repair?: boolean`
- `supports_cast_orientation?: boolean`
- `supports_motion_orientation?: boolean`
- `not_reliable_for?: string[]`

### `VisualBlock`

Add:

- `visual_usefulness_score?: number`
- `visual_primary_role?: string`
- `not_reliable_for?: string[]`

---

## 6.2 Suggested pipeline updates

### `vis1.ts`

Add:

- usefulness scoring
- primary role inference

### `vis2.ts`

Add:

- continuity hints from place memory
- support metadata inference

### `vis3.ts`

Add:

- dual prompt mode:
  - normal place render
  - schematic fallback render

### `vis4.ts`

Add:

- retry path using schematic prompt when normal generation fails or looks unstable

### `final1.ts`

Add:

- stronger support bundle logic using usefulness score

### `ReaderScreen.tsx`

Add:

- UI behavior based on usefulness score
- lower prominence when image is low-value

---

## 7. What Not to Do in VIS

These changes would likely hurt the project.

### Do not make VIS the main support surface

Image is too weak for:

- causality
- unresolved motives
- relation dynamics
- pronoun repair

### Do not push character illustration too hard

The current environment-first design is valuable.
Turning VIS into full narrative illustration will likely reduce reliability.

### Do not force an image for every scene

Some scenes should simply not use image as default support.

### Do not mix too many visual goals into one prompt

Keep prompts separated by role:

- place recovery
- schematic fallback
- overlay refinement

---

## 8. Recommended VIS Priority

### First

- add usefulness scoring
- add support metadata
- use those fields in `FINAL.1`

### Second

- add place continuity memory
- reuse continuity hints in `VIS.2 / VIS.3`

### Third

- add schematic fallback render mode

### Fourth

- refine overlay logic using visual role metadata

---

## 9. Final Recommendation

VIS should remain important, but narrower in scope.

Best role for VIS:

- help restore place
- sometimes help orient interaction
- never pretend to replace causal/relational/state repair

The best VIS change is not "make prettier images."
It is:

`make VIS self-aware about when it is useful, what it supports, and when it should step back.`
