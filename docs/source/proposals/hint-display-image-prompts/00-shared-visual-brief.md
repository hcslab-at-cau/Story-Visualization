# Shared Visual Brief

Use this shared brief for every prompt in this folder.

## Product Context

Create a high-fidelity product UI mockup for a long-form fiction reader called Story-Visualization. The app helps readers recover narrative context while reading. It should feel like a calm research-grade reading tool, not a marketing website.

## Base Layout

- Desktop viewport, 16:9, around 1440 x 900.
- Light theme.
- Main reading column on the left, with generous line height and quiet typography.
- Right side support surface, about 360-420 px wide, used only when a hint is active.
- Optional scene image panel may appear only when the prompt asks for visual grounding.
- Body text should mostly be placeholder grey lines, not long readable paragraphs.
- A selected phrase, sentence, or word in the reading text can have a subtle underline or pale highlight.

## Interaction Pattern

The visual should imply this flow:

1. Reader sees normal prose.
2. A subtle anchor indicates help is available.
3. The reader clicks or taps the anchor.
4. A small popover or side panel opens.
5. The support explains only the missing link.

## Style

- Calm, utilitarian, literary reading interface.
- White and warm off-white surfaces.
- Soft zinc/stone greys for structure.
- Use small accent colors sparingly:
  - current state: slate or zinc
  - causal bridge: amber
  - character: indigo
  - relation: rose or mauve, but very restrained
  - place/time: teal or sky
  - reference: violet or blue, restrained
  - re-entry: green
  - visual grounding: sky or teal
- Avoid dominant purple gradients, decorative blobs, bokeh, or hero-page composition.
- Cards should be compact, with 8-12 px radius at most.
- Do not create nested cards inside cards unless the inner block represents a specific bridge step.

## Text Rendering Guidance

Exact UI text is not critical because image models often distort text. Keep text short and label-like. If text is visible, use simple labels such as:

- "Now"
- "Why?"
- "Who?"
- "Place"
- "Relation"
- "Earlier"
- "So now"
- "Evidence"
- "Resume"

Avoid long readable prose. Use grey placeholder lines for novel text.

## Negative Prompt

Do not show a landing page, marketing hero, split hero layout, large decorative illustration, dense dashboard, data table, code editor, chat app, full-screen modal, neon colors, heavy gradients, floating orbs, cartoon mascots, or cluttered annotation overlays. Do not make the hints look like permanent study notes covering the novel.

