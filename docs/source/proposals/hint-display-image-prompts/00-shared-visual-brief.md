# Shared Visual Brief

Use this shared brief for every prompt in this folder.

## Product Context

Create a high-fidelity product UI mockup for a long-form fiction reader called Story-Visualization. The app helps readers recover narrative context while reading. It should feel like a calm, reader-first literary tool, not a research dashboard or marketing website.

## Base Layout

- Desktop viewport, 16:9, around 1440 x 900.
- Light theme.
- Main reading column on the left, with generous line height and quiet typography.
- Right side support surface is optional. Most Reader View hints should use a local popover, margin note, inline strip, or small bottom sheet instead of a permanent side panel.
- Optional scene image panel may appear only when the prompt asks for visual grounding.
- Body text should mostly be placeholder grey lines, not long readable paragraphs.
- A selected phrase, sentence, or word in the reading text can have a subtle underline or pale highlight.

## Reader-First Disclosure Model

Every prompt should prefer a three-level display hierarchy:

1. Level 0: a nearly invisible anchor in the prose, such as a tiny icon, dotted underline, small chip, or margin mark.
2. Level 1: one short helpful answer, close to the anchor. This is the primary Reader View surface.
3. Level 2: optional details such as evidence, earlier context, or a structured before/now view. These details should be collapsed or visually secondary.

The first visible answer should feel like a quick reading repair, not a report. It should answer one question in one sentence or one tiny cluster of labels. Evidence is important but should be hidden behind a small collapsed row unless the specific prompt asks to show it.

## Interaction Pattern

The visual should imply this flow:

1. Reader sees normal prose.
2. A subtle anchor indicates help is available.
3. The reader clicks or taps the anchor.
4. A small popover, margin note, inline strip, or bottom sheet opens.
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
- Cards should be compact, with 8 px radius at most.
- Avoid nested cards in Reader View. Use nested structure only in a clearly secondary detail state or Research View.
- Avoid persistent panel-heavy layouts unless the prompt is specifically about session re-entry or visual grounding.
- Use generous whitespace around prose. The hint should never visually compete with the paragraph being read.

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

Prefer reader-facing labels over analytic labels:

- Use "Why?" instead of "Causal Hint".
- Use "Right now" or "Now" instead of "Current state snapshot".
- Use "Who?" instead of "Character identity".
- Use "Relationship changed" or "Relation" instead of "Social delta".
- Use "From earlier" instead of "Grounded interpretation".
- Use "Check in text" instead of a prominent "Evidence" section.

Avoid long readable prose. Use grey placeholder lines for novel text.

## Reader View vs Research View

Reader View is the default for these image prompts. It should be quiet, temporary, and easy to dismiss.

Research View can be implied only as a small "more" affordance, tab, or collapsed detail. Do not make Research View the main image unless a prompt explicitly asks for it.

## Negative Prompt

Do not show a landing page, marketing hero, split hero layout, large decorative illustration, dense dashboard, data table, code editor, chat app, full-screen modal, neon colors, heavy gradients, floating orbs, cartoon mascots, or cluttered annotation overlays. Do not make the hints look like permanent study notes covering the novel. Do not make the right panel the default answer surface for every hint.

