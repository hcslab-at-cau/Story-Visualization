# V3 Book-Scoped QA Retrieval and Entity Grouping Design

## Status

Approved in conversation on 2026-07-31.

## Goal

Improve V3 answer recall for details that are present in the source text but
absent from generated scene or event summaries, then extend the same grounded
answer path across every chapter the reader has reached.

The motivating failure is a chapter-one question about food or eating. The
chapter contains relevant source text, but the current retrieval index searches
generated scene, event, goal, and memory text first. When those abstractions
omit the detail, no hit span reaches the grounded-answer context and the system
returns `insufficient_evidence`.

The book-scoped path must also recognize conservatively grouped recurring
entities across chapters without using future identity information at an
earlier reader position.

## Scope

This design adds:

1. paragraph-level lexical and semantic retrieval backed by canonical source
   paragraphs;
2. a document-scoped `BOOK.1` QA corpus that references existing chapter runs
   instead of copying their artifacts;
3. query-time federation over the chapters allowed by the reader position;
4. conservative cross-chapter grouping of V3 `EVID.4` entity clusters;
5. chapter-qualified evidence and citations;
6. explicit readiness failures when an allowed chapter is not queryable.

The existing single-chapter QA endpoints remain compatible.

## Non-goals

- Do not create one physically merged vector database.
- Do not replace chapter-local `EVID.4` clustering.
- Do not add an LLM entity-resolution pass in this slice.
- Do not build a full cross-chapter knowledge graph or infer new relations.
- Do not add multi-turn conversation memory, streaming, or answer-style
  personalization.
- Do not expose records, aliases, entity links, or text after the reader
  position.

## Approaches Considered

### Query-time raw-text fallback

The server could search source paragraphs only after the existing retrieval
path returns no useful hit. This minimizes migration work, but creates two
ranking paths, makes latency depend on failure, and either limits the fallback
to weak lexical matching or embeds paragraphs repeatedly at question time.

### Physically merged book index

The system could copy every chapter document and vector into one book artifact.
Queries would be simple, but every chapter rerun would invalidate the merged
artifact, vectors would be duplicated, and the book artifact could become too
large for Firestore.

### Paragraph retrieval plus query-time federation

This is the selected approach. Chapter artifacts and vector blobs remain the
unit of storage. Each chapter index gains lightweight paragraph descriptors,
while source text continues to live in `PRE.1` and the canonical corpus.
`IDX.2` embeds the hydrated paragraph text once. At question time, the server
loads allowed chapter indexes, scores their records together, and applies one
global rank fusion.

## Reader Position

Book QA uses a chapter-qualified position:

```ts
interface V3BookReaderPosition {
  chapter_id: string
  pid: number
}
```

The `BOOK.1` corpus stores canonical chapter order. A record is readable when:

- its chapter precedes `reader_position.chapter_id`; or
- it belongs to the current chapter and its span ends at or before
  `reader_position.pid`.

Later chapters are removed before lexical scoring, semantic scoring, entity
expansion, graph expansion, context construction, and answer generation.
Unknown chapter order or an invalid PID fails closed.

PIDs remain chapter-local. All book-scoped spans and citations therefore use
`{ chapter_id, pid }`; the implementation must not invent a global numeric PID.

## Paragraph Retrieval

### Lightweight `IDX.1` descriptors

`V3RetrievalRecordType` gains `paragraph`. The `IDX.1` builder receives the
`PRE.1` prepared chapter and `PRE.2` content units and emits one structured
record per story paragraph:

```ts
interface V3ParagraphRetrievalRecord {
  record_id: string
  record_type: "paragraph"
  label: string
  source_paragraph_id?: string
  progress_start: number
  progress_end: number
  entity_refs: string[]
  evidence_refs: string[]
}
```

`record_id` uses the stable `paragraph_id` when canonical provenance is
available and otherwise falls back to a deterministic chapter-and-PID key.
The exact paragraph text is not copied into the Firestore `IDX.1` artifact.
This avoids duplicating a potentially large chapter and preserves the
canonical source as the text authority.

The `IDX.1` artifact version is bumped. Its source-stage contract includes
`PRE.1`, `PRE.2`, and `EVID.4` so paragraph story filtering, text hydration,
and entity references are reproducible.

### Hydrated `IDX.2` documents

The semantic-index builder hydrates paragraph descriptors from `PRE.1`, while
continuing to use existing `IDX.1.text_documents` for scene, event, goal, and
causal records. The source fingerprint covers both sets in deterministic
record-ID order. The `IDX.2` artifact version is bumped and its source-stage
contract includes both `IDX.1` and `PRE.1`.

At query time, the server reconstructs the same hydrated document set and
rejects stale `IDX.2` metadata or vectors. Paragraph vectors stay in the
existing chapter-scoped gzip vector blob; raw paragraph text does not.

Lexical search uses the hydrated paragraph text in memory. A paragraph hit has
an exact one-paragraph span, so it can enter the grounded answer context even
when no generated summary mentions the requested detail.

Existing older `IDX.1` artifacts remain valid for single-chapter compatibility,
but a `BOOK.1` corpus requires the paragraph-capable version.

## `BOOK.1` QA Corpus

`BOOK.1` is a document-scoped QA artifact, not a chapter pipeline stage. It is
stored separately from the legacy V2 `BOOK.0` snapshot:

```text
documents_v3/{docId}/qa_corpora/{qaCorpusId}
documents_v3/{docId}/qa_corpora/{qaCorpusId}/entity_groups/{globalEntityId}
```

The manifest contains:

- immutable `qa_corpus_id`, `doc_id`, and artifact version;
- server-authoritative ordered chapter IDs and titles, using the canonical
  revision manifest when present and the existing legacy chapter order
  otherwise;
- the selected external run ID for each chapter;
- resolved content-addressed artifact IDs for `PRE.1`, `PRE.2`, `EVID.3`,
  `EVID.4`, `MEM.0`, `MEM.1`, `EVENT.2`, `IDX.1`, and optional `IDX.2`;
- a deterministic fingerprint over ordered chapter and artifact references;
- readiness diagnostics for missing or incompatible artifacts.

The client may request a chapter-to-run mapping, but the server validates the
chapter IDs against canonical chapter order and resolves the actual artifact
references. `qa_corpus_id` is derived from those resolved references, not from
mutable run names alone.

The existing V2 `BOOK.0.chapterRunIds` pattern is not reused as storage because
it is based on `SUP.0` and `ENT.3`, reads the current namespace, and does not
pin V3 artifact revisions.

## Cross-Chapter Entity Grouping

### Inputs and grouping policy

`BOOK.1` groups chapter-local `EVID.4` clusters of type `cast`, `place`, and
`object`. `time` clusters are excluded because repeated labels such as
`morning` do not establish persistent identity.

Grouping is deterministic and conservative:

1. normalize canonical labels and aliases with Unicode normalization,
   case-folding, whitespace folding, and leading/trailing punctuation removal;
2. require the same entity type;
3. require an exact normalized canonical-label or alias intersection;
4. reject pronoun-only and generic-role-only keys through a fixed,
   code-owned denylist covered by tests;
5. reject a merge when the key identifies multiple candidate clusters in the
   same chapter;
6. keep uncertain candidates separate and record an unresolved diagnostic.

No model call guesses identity. This intentionally favors precision over
recall. A clear repeated name such as `Alice` groups across chapters; generic
labels such as `the man` do not group merely because their strings match.

Each group stores:

```ts
interface V3BookEntityGroup {
  global_entity_id: string
  entity_type: "cast" | "place" | "object"
  canonical_label: string
  members: Array<{
    chapter_id: string
    run_id: string
    local_cluster_id: string
    canonical_label: string
    aliases: Array<{
      value: string
      evidence_pids: number[]
      available_from_pid: number
    }>
    evidence_pids: number[]
    link_available_from_pid: number
  }>
}
```

`global_entity_id` is a deterministic hash of `qa_corpus_id`, entity type,
normalized identity key, and sorted member references. Chapter-local
cluster IDs are never rewritten. `EVID.3` candidates joined through the
`EVID.4.candidate_cluster_map` recover the paragraph in which each alias and
the identity key first became available. `link_available_from_pid` records the
first paragraph whose visible identity evidence justifies attaching that
member to the group.

### Progress-safe use

The full group may contain members from later chapters, but a query derives a
visible group view before matching:

- discard future chapter members;
- in the current chapter, discard members whose identity link is not yet
  available and aliases introduced after the reader PID;
- derive the visible label only from remaining aliases instead of exposing a
  future chapter-wide canonical label;
- match the question only against the remaining visible labels and aliases;
- expand only records whose local `entity_refs` belong to remaining members.

This prevents a future alias or identity reveal from connecting a question to
an earlier unnamed character. Opaque global IDs are never shown as narrative
facts.

Federated records and edges are namespaced as
`{chapterId}:{localRecordId}`. When the question names a visible entity group,
records associated with visible member clusters receive an `entity_group`
retrieval channel after the hard progress filter. This supplements lexical and
semantic retrieval; it does not create unsupported answer text.

## Federated Retrieval

The book retrieval service:

1. validates the corpus and reader position;
2. selects previous chapters plus the readable prefix of the current chapter;
3. loads the pinned chapter artifacts and vector payloads;
4. hydrates paragraph text from the pinned `PRE.1` artifacts;
5. creates one query embedding;
6. computes lexical and semantic rankings over all readable, namespaced
   records;
7. applies reciprocal-rank fusion once across the combined corpus;
8. applies progress-safe entity-group and existing graph-neighbor expansion;
9. returns a global top-K with chapter-qualified spans and diagnostics.

Mixed semantic readiness is not silently accepted for book QA. Every allowed
chapter must have a valid `IDX.2`, and all allowed indexes must use the same
embedding model and dimensions. Otherwise the API reports the missing, stale,
or incompatible chapter indexes. The existing single-chapter endpoint retains
its lexical fallback.

## Grounded Answer Contract

A new book answer endpoint keeps the single-chapter contract stable:

```text
POST /api/pipeline/v3-book-qa-answer
```

Its request includes `docId`, `qaCorpusId`, `question`, and
`readerPosition`. The server owns chapter/run/artifact resolution through the
manifest.

Book answer context paragraphs use:

```ts
interface V3BookQAContextParagraph {
  chapter_id: string
  chapter_title: string
  pid: number
  text: string
}
```

The model returns chapter-qualified citation references and evidence IDs. The
normalizer rejects the whole answer unless:

- every citation is a supplied readable paragraph;
- every evidence ID is supplied;
- every citation belongs to at least one selected evidence span;
- every selected evidence item supports at least one citation;
- the answer text is non-empty.

Unknown, future, or cross-associated citations downgrade to
`insufficient_evidence`, matching the current strict answer policy.

The Reading QA view displays citations as `Chapter title / Pn`. Current-chapter
citations scroll locally. Earlier-chapter citations navigate to that chapter
and preserve the selected corpus and reader position.

Book-scoped answer snapshots use a versioned history scope keyed by
`qa_corpus_id`. They store the reader position and chapter-qualified citations;
legacy chapter/run history remains readable and unchanged.

## Errors and Diagnostics

- Unknown corpus or fingerprint mismatch: `409`, rebuild the QA corpus.
- Reader chapter absent from the corpus or invalid PID: `400`.
- Allowed chapter missing required `PRE.1`, `PRE.2`, `EVID.3`, `EVID.4`,
  `IDX.1`, or `IDX.2`: `409` with chapter and stage diagnostics.
- Stale or corrupt vector payload: `409` with the affected chapter.
- Mixed embedding model or vector dimensions: `409` with the incompatible
  chapters.
- No matching readable evidence after a ready search:
  `insufficient_evidence`.
- Future-only matches are counted as blocked diagnostics but never returned.

Missing prerequisites must not be disguised as `insufficient_evidence`; that
status is reserved for a successfully executed, ready retrieval.

## Testing

Pure tests cover:

- a food/eating paragraph retrieved when scene and event summaries omit it;
- stable paragraph IDs and exact chapter-local spans;
- paragraph text excluded from the persisted `IDX.1` payload;
- combined semantic fingerprint validation;
- deterministic corpus IDs from pinned artifact references;
- global ranking across two or more chapters;
- previous chapters readable, current chapter PID-bounded, future chapters
  excluded;
- repeated `Alice` clusters grouped across chapters;
- aliases expanding only visible entity members;
- an alias introduced after the current PID not matching or exposing its
  chapter-wide canonical label;
- ambiguous generic entities remaining separate;
- future identity and alias links blocked before disclosure;
- chapter-qualified citation/evidence validation;
- explicit readiness errors for missing and stale chapter indexes;
- legacy single-chapter retrieval and history compatibility.

Integration verification runs sequentially:

1. focused tests while implementing each unit;
2. full `npm test`;
3. `npm run typecheck`;
4. `npm run lint`;
5. `npm run build`;
6. one browser flow for the motivating chapter-one question and one
   cross-chapter entity question.

Before the final PR, task-owned temporary files and generated build artifacts
are removed, the worktree diff is checked, and no task-owned Node process is
left running.

## Acceptance Criteria

The slice is complete when:

1. an explicit source paragraph can answer the motivating food question even
   when no generated event or scene summary contains the food term;
2. book QA searches all fully read previous chapters and only the readable
   prefix of the current chapter;
3. recurring high-confidence entities group across readable chapters and
   improve retrieval;
4. future text and future entity identity information never enter hits,
   context, citations, or visible grouping metadata;
5. every answer citation identifies its source chapter and PID;
6. missing chapter prerequisites produce actionable readiness errors rather
   than false evidence insufficiency;
7. existing single-chapter QA behavior remains compatible.
