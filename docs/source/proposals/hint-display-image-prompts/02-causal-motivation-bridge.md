# Causal / Motivation Bridge Prompt

## Goal

Visualize a hint that answers "Why is this happening now?" or "Why did this character act this way?"

This should look like a small bridge from an earlier event to the current sentence.

## Image Prompt

Create a high-fidelity UI mockup of the Story-Visualization reader. The page shows novel prose with one sentence softly highlighted. A small anchor label near the highlighted sentence says "Why?".

Show the opened hint as a small side sheet or margin popover, not a full-height panel. The first visible line should be a single reader-facing answer such as "Because of what happened earlier, this action now makes sense." Use placeholder text lines rather than a long readable sentence.

Below that first answer, include a collapsed or secondary two-step bridge:

- "Earlier" block, warm amber accent
- "So now" block, soft sky or neutral accent

The two blocks should be visually connected by a tiny arrow or connector. Each block should contain only 1 short placeholder text line. At the bottom, include a collapsed "Check in text" or "Evidence" row, not expanded.

The design should communicate:

- the hint is opened only after the reader asks "Why?"
- the support gives one quick answer first, then optional earlier-now detail
- inference is controlled and grounded
- it is helpful but not a full explanation essay

Use calm typography, generous spacing, and a small temporary surface. The novel text should remain readable and dominant.

## Negative Prompt

No detective-board string map, no dramatic mystery graphic, no full timeline, no essay text, no full-height right panel, no full-screen overlay, no bright warning colors.

## Success Criteria

- The "Earlier -> So now" structure is immediately visible.
- The causal hint feels grounded and concise.
- The UI does not interrupt the reading flow.

