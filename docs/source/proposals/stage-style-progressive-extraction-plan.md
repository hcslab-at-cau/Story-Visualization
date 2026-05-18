# STAGE-Style Progressive Extraction Plan

This proposal revises the entity/state/scene front half of the pipeline. The
goal is to reduce token cost and improve downstream scene quality by replacing
the current all-at-once mention extraction path with small-window, multi-pass,
state-oriented extraction.

## Problem

The current pipeline is:

```text
PRE.2 -> ENT.1 -> ENT.2 -> ENT.3 -> STATE.1 -> STATE.2 -> STATE.3 -> SCENE.1
```

This worked as a first implementation, but it now has three structural limits.

1. `ENT.1` asks the model to extract all cast, place, and time mentions with
   exact offsets. This is a high-recall, high-volume task, and weak extraction
   in this stage damages every downstream stage.
2. `ENT.2` spends more tokens re-reading paragraphs and validating many mention
   candidates, including candidates that may not matter for state tracking or
   scene splitting.
3. `STATE.1` and `STATE.2` depend on a complete mention/entity inventory even
   though scene construction mostly needs a smaller set of facts: who is active,
   where the focal action is, when time shifts, and what state changed.

The issue is not only batch size. `ENT.1` already chunks the chapter, but each
chunk still asks for too many kinds of information at once. The better change is
to split both the text and the extraction objective.

## Principle

Adopt a STAGE-style extraction pattern:

```text
small text windows
  -> multiple narrow extraction passes
  -> local consolidation
  -> sequential state update
  -> selective audit/retry
  -> scene boundary detection
```

The model should not be asked to find every possible mention in one pass.
Instead, it should answer small, targeted questions over small windows, then the
pipeline should merge the results into state frames.

## Proposed Flow

```text
PRE.2
  -> OBS.0 Window Builder
  -> OBS.1a Cast/Focus Observation
  -> OBS.1b Place/Movement Observation
  -> OBS.1c Time/Sequence Observation
  -> OBS.1d Event/State-Change Observation
  -> OBS.2 Local Consolidation
  -> STATE.DIFF Sequential State Update
  -> STATE.AUDIT Selective Retry
  -> STATE.3 Boundary Detection
  -> SCENE.1 Scene Packet Builder
  -> ENT.3 Compatibility Entity Graph
```

The `OBS.*` stages are proposal names. During the first experiment, they can be
implemented behind existing routes or as an alternate branch so the current
reader path remains usable.

## Windowing

Use small narrative windows rather than chapter-sized prompts.

Suggested default:

```text
previous_summary: compact state summary before the window
previous_context: 1 paragraph before the window, if available
target_window: 2-4 narrative paragraphs
next_preview: 1 paragraph after the window, if available
```

The target window is the only text that produces new observations. Previous and
next context are used only to reduce boundary mistakes, pronoun ambiguity, and
movement timing errors.

Each output item must include `evidence_pids`, and evidence should point to the
target window unless explicitly marked as context-only.

## Extraction Passes

### Pass A: Cast And Focus

Purpose:

- Identify characters or groups that act, speak, are directly addressed, or are
  focalized in the target window.
- Track ambiguous references only when they matter for active cast state.

Output shape:

```json
{
  "observations": [
    {
      "pid": 12,
      "surface": "she",
      "canonical_guess": "Alice",
      "role": "actor|speaker|addressee|focal_character|mentioned_only",
      "evidence": "short exact phrase",
      "confidence": "high|medium|low",
      "needs_resolution": false
    }
  ]
}
```

This pass should not extract every pronoun. It should extract references that
change or support the active cast state.

### Pass B: Place And Movement

Purpose:

- Detect current-place evidence, mentioned places, entrances, exits, arrival,
  departure, containment, and failed/imagined movement.
- Separate "looked at the garden" from "entered the garden".

Output shape:

```json
{
  "observations": [
    {
      "pid": 14,
      "place_surface": "the garden",
      "canonical_guess": "garden",
      "relation": "current_place|mentioned_place|destination|origin|threshold|imagined",
      "movement_event": "entered|arrived|left|looked_toward|blocked|none",
      "evidence": "short exact phrase",
      "confidence": "high|medium|low"
    }
  ]
}
```

This pass is the most important replacement for mention validation, because
scene boundaries are often place-change boundaries.

### Pass C: Time And Sequence

Purpose:

- Detect temporal shifts, durations, flashbacks, memory, imagination,
  hypotheticals, and sequence markers.
- Preserve narrative scope so support artifacts do not treat imagined or
  remembered events as actual current state.

Output shape:

```json
{
  "observations": [
    {
      "pid": 18,
      "time_signal": "after a while",
      "kind": "duration|sequence|flashback|memory|imagination|hypothetical",
      "scope": "actual_storyworld|memory|imagination|hypothetical|dialogue_claim",
      "evidence": "short exact phrase",
      "confidence": "high|medium|low"
    }
  ]
}
```

### Pass D: Event And State Change

Purpose:

- Extract compact state-changing events, not full summaries.
- Identify candidate scene boundary reasons before final boundary scoring.

Output shape:

```json
{
  "observations": [
    {
      "pid": 21,
      "event": "Alice lands at the bottom of the fall",
      "participants": ["Alice"],
      "state_change": "movement_completed",
      "boundary_signal": "place_set|place_shift|cast_turnover|time_jump|goal_shift|none",
      "evidence": "short exact phrase",
      "confidence": "high|medium|low"
    }
  ]
}
```

## Consolidation

`OBS.2` merges the four observation streams for the same text window.

Responsibilities:

- Deduplicate near-identical canonical guesses.
- Convert low-value mentions into supporting evidence, not entities.
- Mark contradictions, such as two competing current places.
- Keep confidence and evidence attached to each merged observation.

Output should be a compact window record:

```json
{
  "window_id": "w0004",
  "target_pids": [12, 13, 14],
  "cast_observed": [],
  "place_observed": [],
  "time_observed": [],
  "events": [],
  "contradictions": [],
  "audit_questions": []
}
```

## Sequential State Update

`STATE.DIFF` becomes the central step.

Input:

```text
previous_validated_state
current_window_observations
target_window_text
```

Output:

```json
{
  "frames": [
    {
      "pid": 14,
      "validated_state": {
        "current_place": "garden",
        "mentioned_place": null,
        "active_cast": ["Alice"],
        "weak_exit_candidates": []
      },
      "state_delta": [
        {
          "field": "current_place",
          "from": null,
          "to": "garden",
          "reason": "movement_completed",
          "evidence_pids": [14],
          "confidence": "high"
        }
      ],
      "unresolved_questions": []
    }
  ]
}
```

This preserves the current `STATE.2` concept but changes its role. Instead of
validating an entity-derived rule proposal, it directly produces validated state
frames from observations plus prior state.

## Selective Audit And Retry

Do not validate every extracted item. Re-query only when a window matters and is
uncertain.

Audit triggers:

- Competing current places with medium or low confidence.
- Active cast changes without explicit evidence.
- Candidate scene boundary with weak evidence.
- Scope conflict, such as memory/imagination versus actual storyworld.
- Empty observation output for a window that contains substantial narrative
  action.

Audit prompt should ask one narrow question, for example:

```text
Given P12-P14 and the current state, did the focal character actually enter the
garden, or only look toward it?
```

This replaces broad mention validation with targeted adjudication.

## Compatibility With Current Code

The first implementation should avoid breaking downstream stages.

Recommended bridge:

1. Keep `STATE.3` and `SCENE.1` output contracts stable.
2. Generate a compatibility `ENT.3` artifact from validated state frames and
   observation evidence.
3. Mark compatibility entities with a source flag such as
   `source_file: "stage-style-progressive-extraction"` or a future explicit
   `source_method`.
4. Continue to allow the legacy `ENT.1 -> ENT.2 -> ENT.3` path for comparison
   runs.

In this bridge, `ENT.3` is no longer the source of truth. It is a projection
derived from state-oriented observations so existing graph and support views can
continue to load.

## Evaluation

Evaluate against the current pipeline with the same chapter/run setup.

Primary metrics:

- Token cost by stage and total run.
- JSON failure/retry rate.
- Current-place accuracy.
- Active-cast accuracy.
- Boundary quality with tolerance of one paragraph.
- Scene packet usefulness for `SCENE.2`, `SCENE.3`, `VIS`, `SUB`, and `SUP`.

Secondary metrics:

- Number of low-confidence windows.
- Number of targeted audit calls.
- Number of compatibility entities produced.
- Reader-facing quality of final scene cards and support artifacts.

Do not use mention F1 as the main metric. The new pipeline intentionally does
not try to recover every mention occurrence.

## Implementation Milestones

### Milestone 1: Instrument Legacy Cost

- Record prompt length, raw response length, parsed item counts, retry count,
  and elapsed time for `ENT.1`, `ENT.2`, `ENT.3`, `STATE.2`, `SCENE.2`, and
  `SCENE.3`.
- Save these metrics into stage debug metadata or run-level metadata.

### Milestone 2: Observation Prototype

- Add a window builder for narrative paragraphs.
- Add one experimental endpoint that runs Pass A-D for a chapter and saves a
  draft observation artifact.
- Keep this endpoint outside the default pipeline until it is compared.

### Milestone 3: State-Diff Prototype

- Produce `STATE.2`-compatible frames from observations and previous state.
- Run `STATE.3` and `SCENE.1` using the new state frames.
- Compare scene boundaries with the legacy path.

### Milestone 4: Compatibility Entity Graph

- Generate `ENT.3`-like entities from state observations.
- Verify graph projection, support memory, and reader output still load.

### Milestone 5: Selective Audit

- Add audit triggers.
- Re-run only low-confidence windows.
- Measure whether audit calls improve scene boundary and reader quality enough
  to justify their token cost.

## Open Questions

- Should the first prototype store `OBS.*` as new stage ids, or store it as
  debug metadata under an alternate `STATE.2` run?
- Should entity canonicalization be chapter-local first, then book-level through
  `BOOK.0`, or should the window extractor receive a book-level alias memory?
- How aggressive should the compatibility `ENT.3` projection be? A sparse graph
  may be more honest, but some current UI surfaces expect entity coverage.
- Which Korean-specific rules should be added for honorifics, kinship terms,
  role nouns, and omitted subjects?

## Expected Outcome

The expected improvement is not merely lower token usage. The stronger outcome
is that extraction becomes aligned with the actual downstream objective:

```text
recover reader-relevant narrative state
  -> explain state changes with evidence
  -> split scenes at meaningful state transitions
  -> derive support artifacts from validated state
```

This should make the pipeline less dependent on brittle all-mention extraction
while preserving the evidence-grounded structure needed for graph and reader
support work.
