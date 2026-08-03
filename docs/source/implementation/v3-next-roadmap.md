# V3 Next Roadmap Notes

Last updated: 2026-08-03

이 문서는 V3 후속 설계를 보존한다. 2026-08-03 현재 paragraph-capable
`IDX.1`/`IDX.2`, `BOOK.1` corpus, reader-position-safe cross-chapter retrieval,
chapter-qualified grounded answer, book-scoped history와 UI navigation까지 구현됐다.

## Current Direction

V3의 장기 목표는 `EVENT.1`과 `SCENE.0` 결과를 reader-progress-safe QA가 사용할 수 있는 narrative memory와 retrieval index로 바꾸는 것이다.

추천 순서:

1. `MEM.0` Narrative Memory Contract
2. `MEM.1` Scene Situation Cards
3. `EVENT.2` Event Argument Frames
4. `GOAL.1` Goal Grounding
5. `CAUS.1` Causal Edge Candidates
6. `MEM.2` Progressive Narrative Memory
7. `IDX.1` Structured and Graph Retrieval Index
8. `IDX.2` Semantic Vector Index
9. `QA.R1` Progress-bounded Hybrid Evidence Retrieval
10. `QA.A1` Grounded Answer and Citation Validation
11. `BOOK.1` Cross-chapter Progressive Retrieval
12. `QA.E1` Retrieval/Answer Evaluation Set
13. `QA.R2` Evidence Reranking, only if evaluation justifies it

## Why `MEM.0` First

`EVENT.1` and `SCENE.0` already produce useful event and scene candidates, but the next stages need a stable contract:

- every event should map to one scene,
- every scene should point back to valid events,
- every event and scene should have recoverable paragraph spans,
- support/drop evidence should not become a core event axis,
- diagnostics should make bad or incomplete upstream results visible before more LLM calls are made.

This stage is rule-only and should not reinterpret the story.

## Implemented Memory/Index Notes

### Naming note

The external plan used `SCENE.1` for Scene Situation Cards, but this codebase already has a legacy `SCENE.1` stage. V3 uses `MEM.1` for Scene Situation Cards to avoid storage and graph confusion. The later progressive memory stage is therefore reserved as `MEM.2`.

### `MEM.1`

Build scene situation cards from `MEM.0` without a new LLM pass. Keep the card as a retrieval context block: time, place, cast, action focus, salient objects, and explicit goal/tension cues.

### `EVENT.2`

Normalize event candidates into predicate-argument frames. Keep the role set small:

- `actor`
- `speaker`
- `addressee`
- `experiencer_or_perceiver`
- `patient_or_affected`
- `target_object`
- `theme_object`
- `instrument`
- `location`
- `time_anchor`
- `mentioned_only`

Do not turn this into a full semantic role labeling system yet.

### `GOAL.1`

Ground each goal cue to a holder, event, and scene. Treat goal as an intentionality/situation-model element, not as a property that belongs only inside cast.

### `CAUS.1`

Create sparse directed event-event causal edges. Keep temporal order separate from causality.

### `MEM.2`

Create progressive memory views:

- character memory,
- place memory,
- object memory,
- goal memory,
- event timeline,
- causal graph.

### `IDX.1`

`v3-retrieval-index-0.2` adds source paragraph descriptors to the structured and
graph records without copying raw paragraph text into Firestore. `PRE.1`,
`PRE.2`, and `EVID.4` are now explicit inputs.

### `IDX.2`

`v3-semantic-vector-index-0.2` hydrates paragraph text from pinned `PRE.1`, fingerprints
the complete document set, and stores vectors in a content-addressed V3 Firebase
Storage blob. Firestore keeps only compact metadata and integrity fields, and
the write API rejects current/legacy sources. A dedicated vector database
remains deferred until linear cosine search becomes a measured bottleneck.

### `QA.R1`

Implemented as query-time single-chapter and federated book APIs, not stored
pipeline stages. Reader progress is mandatory; records beyond the cutoff or
without a resolvable span fail closed. The single-chapter path keeps lexical
fallback when `IDX.2` is absent. The book path requires compatible `IDX.2`
artifacts for every readable chapter, removes future chapter/PID data before
all ranking and expansion, and applies one global RRF.

### `QA.A1`

Implemented as query-time grounded-answer APIs. The LLM receives only `PRE.1`
source paragraphs covered by progress-safe retrieval hits; evidence text is
reconstructed instead of reusing generated summaries. Single-chapter answers
use PIDs, while book answers use `{ chapter_id, pid }`. The server rejects the
entire answer if any citation/evidence ID is unknown, future, or incorrectly
associated. `insufficient_evidence` model text is discarded.

### `QA.H1`

Two isolated V3 histories are implemented. Legacy single-chapter entries stay
scoped by document/chapter/run. Book entries use
`documents_v3/{docId}/book_qa_history/{scopeId}/entries/{entryId}`, where the
scope derives from `qa_corpus_id`, and persist the original reader position plus
chapter-qualified hits/citations. Both paginate newest-first in 20-entry pages,
restore snapshots without another LLM call, and support deletion.

## QA Evaluation and Follow-up Direction

### `QA.E1`

Build a small question set with expected answerability, supporting paragraph spans, and spoiler boundaries. Measure retrieval recall separately from answer correctness so prompt changes do not hide index failures.

### `QA.R2`

Cross-encoder reranking remains deferred until `QA.E1` shows a concrete ranking failure. Do not add it only because it is a common RAG component.

### `BOOK.1`

Shipped baseline: immutable corpus manifests pin canonical chapter order, run
and artifact revisions; conservative exact-alias grouping connects recurring
cast/place/object entities; reader position controls the searchable chapter
prefix; answers and history use chapter-qualified citations; the UI preserves
the corpus and original reader position across citation navigation.

Older `EVID.3`, paragraph-less `IDX.1`, and pre-0.2 `IDX.2` artifacts remain
single-chapter compatible but require a downstream rebuild before a corpus is
book-ready. Future `BOOK.1` work should be driven by evaluation: better
diagnostics for large corpora, measured performance thresholds, and only then a
dedicated vector store or reranker if needed.

Follow-up question resolution, multi-turn conversation context, and streaming remain deferred until single-turn answer quality is measured.
