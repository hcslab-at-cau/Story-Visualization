# EPUB ingest normalization implementation

## 2026-05-08 update

EPUB upload now applies a rule-based normalization layer before saving `RawChapter` records.

Implemented behavior:

- Spine items that look like cover, navigation, table of contents, copyright, Project Gutenberg header, or Project Gutenberg footer are excluded before chapter creation.
- Existing saved documents are also filtered at `listChapters`, so `pg-header` / `pg-footer` style chapters stop appearing in the UI and in future BOOK.0 builds.
- Chapter titles are no longer taken blindly from manifest IDs such as `item4`.
- Display title selection order is TOC title, HTML heading, non-generic manifest title, first heading-like paragraph, then sequential fallback.
- Chapter selectors and Book Memory run selection display visible-list numbering such as `1. CHAPTER I...` instead of the raw EPUB/spine index such as `Chapter 3 - ...`.
- Saved `RawChapter.source` now keeps normalization metadata: `manifest_id`, `original_title`, `toc_title`, `heading_title`, `classification`, `classification_reason`, and `source_unit_ids`.

Current limits:

- This does not rewrite existing raw chapter documents in Firestore. Existing chapters are hidden or display-title corrected at read time.
- Existing downstream artifacts that were generated from old chapter IDs remain unchanged until rerun.
- The current splitter still treats one content spine item as one chapter, with long-chapter length splitting as fallback. TOC-anchor splitting is still future work.

Validation example:

For the current Alice document, `/api/chapters?docId=oWEaBmeurZmp5ezPw9JW` now returns only the real story chapters and hides `pg-header` / `pg-footer`. The visible titles are derived from chapter headings, for example `CHAPTER I. Down the Rabbit-Hole` instead of `item4`.
