# Character Feeling / Goal Repair Prompt

## Goal

Visualize a careful hint that answers "Why does this character feel or want this?"

This hint has higher hallucination risk, so the design should look cautious and evidence-aware.

## Image Prompt

Create a high-fidelity UI mockup of a long-form reader. In the text column, a sentence describing a character reaction is subtly highlighted. A small anchor label reads "Why?" or "Goal".

Open a small temporary bottom sheet or margin note connected to the highlighted sentence. The first visible answer should be a cautious one-line explanation of the character's likely goal or feeling. Under it, include three compact optional rows:

- observed reaction
- likely goal
- grounded trigger

Use soft indigo with a small amber evidence accent. Add a collapsed "Check in text" row and a small visual cue that this is a grounded interpretation, not a definitive psychological diagnosis.

The design should communicate:

- this hint is optional and expandable
- the system is careful about inferred feelings
- the support connects emotion/goal to a textual trigger
- it stays short and scene-local

Use grey placeholder lines for details. Keep the surface calm and compact. The reader should be able to dismiss it without moving attention away from the paragraph.

## Negative Prompt

No right-side psychology report, no emotion wheel, no psychological dashboard, no large facial expression analysis, no sentiment chart, no exaggerated colored mood UI.

## Success Criteria

- The hint feels cautious and evidence-grounded.
- It is visually subordinate to reading and character tracking.
- It does not imply unsupported mind-reading.

