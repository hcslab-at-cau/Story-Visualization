# Reference / Elaboration Repair Prompt

## Goal

Visualize a hint that answers "Who or what does this word refer to?" or "What does this expression mean here?"

This should look like a tiny contextual repair opened from a word or phrase.

## Image Prompt

Create a high-fidelity UI mockup of a long-form reader. In the text column, a short word, pronoun, or phrase is subtly underlined. The reader has clicked it, opening a small popover close to the text.

The popover should be the smallest hint surface in the system, with a concise label like "Who?" or "Meaning here". It should show:

- referent or local meaning
- one very short contextual note
- a tiny collapsed option to open evidence or more context

Do not open a large side panel unless needed. This is the smallest hint surface. Use a restrained blue or violet accent. The rest of the page should remain quiet.

The design should communicate:

- this is a direct tap/click repair
- it answers a local reference or elaboration problem
- it avoids dumping background information or opening a separate reading lane
- it is easy to dismiss and return to reading

Use only short visible labels and placeholder lines.

## Negative Prompt

No dictionary app, no encyclopedia panel, no chatbot bubble, no large glossary sidebar, no tooltip covering the paragraph, no full right panel.

## Success Criteria

- The popover feels local and lightweight.
- The selected word/phrase remains visually connected to the answer.
- The repair does not interrupt the reading layout.

