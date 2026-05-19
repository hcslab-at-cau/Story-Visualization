# Hint Display Image Prompts

This folder contains image-generation prompts for visualizing how each reader-support hint should appear in the Story-Visualization Reader UI.

Use these files as a handoff packet for an image generation agent. The goal is not to generate final production UI assets. The goal is to create design mockups that make each hint type concrete enough to discuss layout, visibility, interruption level, and interaction flow.

Recommended order:

1. `00-shared-visual-brief.md`
2. `01-current-action-state-snapshot.md`
3. `02-causal-motivation-bridge.md`
4. `03-character-identity-role-focus.md`
5. `04-character-feeling-goal-repair.md`
6. `05-relation-social-delta.md`
7. `06-setting-spacetime-continuity.md`
8. `07-reference-elaboration-repair.md`
9. `08-outcome-thread-resolution.md`
10. `09-session-reentry-recap.md`
11. `10-visual-grounding.md`

Global intent:

- The Reader view is a quiet reading surface, not a dashboard.
- Hints are small recovery aids, not a second layer of exposition.
- Most hints should appear only after the reader interacts with a subtle text anchor.
- Default hint behavior should be progressive disclosure: tiny anchor, one-sentence help, optional collapsed evidence.
- Use different surfaces for different hint types. Local reference hints should stay near the word; causal and relation hints can use a small side sheet only after interaction; session re-entry can use a temporary card.
- The generated mockup should look like a reader-facing experience by default. Researcher-style panels may appear only as collapsed details or a secondary mode.
- The image should show hierarchy, spacing, and interaction state more than exact readable text.
- Avoid decorative hero-page styling, marketing composition, or colorful infographic overload.

