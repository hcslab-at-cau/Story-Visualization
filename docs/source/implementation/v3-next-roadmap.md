# V3 Next Roadmap Notes

Last updated: 2026-07-15

이 문서는 V3 후속 설계를 보존한다. 2026-07-15 현재 `IDX.2` Semantic Vector Index, query-time hybrid retrieval, 원문 근거 답변, 서버 검증 인용, scope별 QA 기록 저장까지 구현됐다.

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
11. `QA.E1` Retrieval/Answer Evaluation Set
12. `QA.R2` Evidence Reranking, only if evaluation justifies it
13. `BOOK.1` Cross-chapter Progressive Retrieval

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

Structured and graph index remains the canonical source for retrieval documents and links.

### `IDX.2`

Implemented with OpenRouter embeddings and a V3-only Firebase Storage vector blob. Firestore keeps only compact metadata and integrity fields, and the write API rejects current/legacy sources. A dedicated vector database remains deferred until chapter-level linear cosine search becomes a measured bottleneck.

### `QA.R1`

Implemented as a query-time API and `Reading QA` tab, not a stored pipeline stage. Reader progress is mandatory; records beyond the cutoff or without a resolvable span fail closed. It fuses lexical and semantic ranks with RRF when `IDX.2` exists, and then expands graph neighbors only among progress-safe records. Runs without `IDX.2` use lexical fallback.

### `QA.A1`

Implemented as a query-time grounded-answer API. The LLM receives only PRE.1 source paragraphs covered by progress-safe retrieval hits; its evidence text is reconstructed from those paragraphs instead of reusing generated retrieval summaries. It must return paragraph PIDs and retrieval evidence IDs; the server rejects the entire answer if any ID is unknown or paragraph/evidence associations do not match. `insufficient_evidence` model text is discarded to avoid leaking unsupported future information. The Reading QA tab shows the answer first and keeps retrieval cards below it for inspection.

### `QA.H1`

Implemented as V3-only Firestore history scoped by document, chapter, and run. The UI loads the newest 20 entries first, paginates in 20-entry batches, restores compact answer snapshots without another LLM call, and supports deletion. This is persistence for independent questions, not multi-turn conversation memory.

## Deferred QA Direction

### `QA.E1`

Build a small question set with expected answerability, supporting paragraph spans, and spoiler boundaries. Measure retrieval recall separately from answer correctness so prompt changes do not hide index failures.

### `QA.R2`

Cross-encoder reranking remains deferred until `QA.E1` shows a concrete ranking failure. Do not add it only because it is a common RAG component.

### `BOOK.1`

Current retrieval is chapter/run scoped. Cross-chapter QA needs a book-level progress coordinate, chapter-aware source spans, and a policy for indexing only chapters the reader has reached.

Follow-up question resolution, multi-turn conversation context, and streaming remain deferred until single-turn answer quality is measured.
