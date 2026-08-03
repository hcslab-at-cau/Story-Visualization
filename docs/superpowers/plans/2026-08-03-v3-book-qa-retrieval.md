# V3 Book-Scoped QA Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make exact source-paragraph details such as chapter-one food/eating facts retrievable, then answer across every chapter the reader has reached while grouping recurring entities without leaking future identity information.

**Architecture:** Keep chapter artifacts and vector blobs immutable and chapter-scoped, add lightweight paragraph descriptors to `IDX.1`, hydrate canonical `PRE.1` text for `IDX.2` and query-time search, and pin resolved content-addressed chapter artifact references in a document-scoped `BOOK.1` manifest. A pure federated retriever applies reader-position filtering before one global lexical/semantic RRF pass, then performs bounded graph/entity-group expansion. Book answer, history, and navigation contracts stay separate from the existing single-chapter contracts.

**Tech Stack:** Next.js 16.2 App Router route handlers, React 19 client components, TypeScript, Node test runner with `tsx`, Firebase Admin Firestore and Storage, OpenRouter embeddings and grounded-answer calls through the existing OpenAI-compatible client.

---

## Compatibility and execution constraints

- Existing `IDX.1`/`IDX.2`, single-chapter QA, and `v3-qa-history-0.1` artifacts remain readable.
- New `BOOK.1` creation rejects legacy paragraph-less `IDX.1` and provenance-less `EVID.3` artifacts with readiness diagnostics; it never silently falls back to `BOOK.0`.
- Every book query filters future chapters and the unread suffix of the current chapter before lexical scoring, semantic scoring, graph expansion, entity matching, prompt construction, and citation validation.
- `source` is always explicitly `"v3"` for corpus creation, storage, retrieval, answer, and history routes.
- Run focused tests and commits sequentially. Do not start parallel test/build processes.
- Before UI edits, read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md` and `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-router.md`; route/server/client docs already inspected remain authoritative.

### Task 1: Preserve EVID.3 alias provenance needed by BOOK.1

**Files:**
- Modify: `src/lib/pipeline/v3-evidence-gate-types.ts`
- Modify: `src/lib/pipeline/v3-evidence-gate-core.ts`
- Test: `tests/v3-evidence-gate.test.ts`

- [ ] Add a failing test proving newly built EVID.3 candidates preserve `pid`, `span`, and `normalized`, and emit a version marker while the runtime guard still accepts old stored artifacts without those optional fields.

```ts
assert.deepEqual(
  result.gated_candidates.map(({ refined_candidate_id, pid, span, normalized }) => ({
    refined_candidate_id, pid, span, normalized,
  })),
  [{ refined_candidate_id: "REF_ALICE", pid: 7, span: "Alice", normalized: "Alice" }],
)
assert.equal(result.artifact_version, "v3-evidence-candidate-gate-0.2")
```

- [ ] Run `node --import tsx --test tests/v3-evidence-gate.test.ts` and confirm failure because the provenance fields and version do not exist.
- [ ] Add the compatible contract. Fields stay optional in the TypeScript interface because persisted pre-0.2 artifacts exist, but every new builder output populates them.

```ts
export const V3_EVIDENCE_GATE_VERSION = "v3-evidence-candidate-gate-0.2" as const

export interface V3GatedEvidenceCandidate {
  refined_candidate_id: string
  source_candidate_ids: string[]
  candidate_type: V3EvidenceCandidateType
  gate: V3EvidenceGate
  basis: V3EvidenceGateBasis
  pid?: number
  span?: string
  normalized?: string
  rationale?: string
}
```

- [ ] Copy provenance directly from each `V3RefinedEvidenceCandidate` in `buildV3EvidenceGateFromDecisions`; do not trust the model response for these fields.
- [ ] Re-run the focused test and confirm it passes.
- [ ] Commit: `git add src/lib/pipeline/v3-evidence-gate-types.ts src/lib/pipeline/v3-evidence-gate-core.ts tests/v3-evidence-gate.test.ts && git commit -m "feat: preserve v3 evidence provenance"`

### Task 2: Add paragraph descriptors and canonical hydration

**Files:**
- Create: `src/lib/pipeline/v3-retrieval-documents.ts`
- Modify: `src/lib/pipeline/v3-narrative-memory-types.ts`
- Test: `tests/v3-retrieval-documents.test.ts`

- [ ] Write failing tests for stable IDs, story-only filtering, exact one-PID spans, paragraph-to-entity references, absence of source text in `IDX.1`, exact PRE.1 hydration, deterministic ordering, and fail-closed behavior for missing or mismatched PRE.1 paragraphs.

```ts
const records = buildV3ParagraphRetrievalRecords({
  chapterId: "ch01",
  preparedChapter,
  contentUnits,
  evidenceClusters,
})
assert.deepEqual(records[0], {
  record_id: "PARAGRAPH_para_0007",
  record_type: "paragraph",
  label: "Paragraph P7",
  source_paragraph_id: "para_0007",
  entity_refs: ["CAST_ALICE"],
  evidence_refs: [],
  progress_start: 7,
  progress_end: 7,
})
assert.equal(JSON.stringify(records).includes("tea and cake"), false)
```

- [ ] Run `node --import tsx --test tests/v3-retrieval-documents.test.ts` and confirm module-not-found failure.
- [ ] Introduce compatible versions and descriptor fields.

```ts
export const V3_RETRIEVAL_INDEX_LEGACY_VERSION = "v3-retrieval-index-0.1" as const
export const V3_RETRIEVAL_INDEX_VERSION = "v3-retrieval-index-0.2" as const
export type V3RetrievalRecordType =
  | "paragraph" | "scene" | "event" | "character" | "place" | "object" | "goal" | "causal_edge"

export interface V3StructuredRetrievalRecord {
  record_id: string
  record_type: V3RetrievalRecordType
  label: string
  source_paragraph_id?: string
  entity_refs?: string[]
  scene_id?: string
  event_id?: string
  evidence_refs: string[]
  progress_start?: number
  progress_end?: number
}
```

- [ ] Implement these pure helpers. `paragraphRecordId` uses `paragraph.paragraph_id` when present and `PARAGRAPH_${chapterId}_${pid}` otherwise. Hydration requires every new-version paragraph descriptor to match both its canonical ID and PID.

```ts
export function buildV3ParagraphRetrievalRecords(params: {
  chapterId: string
  preparedChapter: PreparedChapter
  contentUnits: ContentUnits
  evidenceClusters: V3EvidenceClusteringArtifact
}): V3StructuredRetrievalRecord[]

export function hydrateV3RetrievalDocuments(params: {
  retrievalIndex: V3RetrievalIndexArtifact
  preparedChapter?: PreparedChapter | null
}): V3RetrievalTextDocument[]
```

- [ ] Return existing text documents plus hydrated paragraph documents sorted by `text_doc_id`; use `TEXT_${record.record_id}` so vector rows always map back to the descriptor ID.
- [ ] Re-run the focused test and confirm it passes.
- [ ] Commit: `git add src/lib/pipeline/v3-retrieval-documents.ts src/lib/pipeline/v3-narrative-memory-types.ts tests/v3-retrieval-documents.test.ts && git commit -m "feat: define paragraph retrieval documents"`

### Task 3: Build paragraph-capable IDX.1 and register its dependencies

**Files:**
- Modify: `src/lib/pipeline/v3-narrative-memory.ts`
- Modify: `src/app/api/pipeline/v3-retrieval-index/route.ts`
- Modify: `src/config/pipeline-graph.ts`
- Modify: `src/lib/firestore.ts`
- Modify: `src/components/v3/PreMentionWorkbench.tsx`
- Test: `tests/v3-narrative-memory.test.ts`
- Test: `tests/v3-semantic-stage-registration.test.ts`

- [ ] Add failing builder tests proving a food paragraph appears as a descriptor even when scene/event/goal text omits it, and proving descriptors carry only cluster IDs whose `evidence_pids` contain that paragraph PID.
- [ ] Add a failing stage-registration test for direct parents `PRE.1 -> IDX.1`, `PRE.2 -> IDX.1`, `EVID.4 -> IDX.1`, and `PRE.1 -> IDX.2`, including descendant invalidation of `IDX.2`.
- [ ] Run `node --import tsx --test tests/v3-narrative-memory.test.ts tests/v3-semantic-stage-registration.test.ts` and confirm the new assertions fail.
- [ ] Extend `BuildV3RetrievalIndexParams` and prepend paragraph descriptors without adding raw text.

```ts
export function buildV3RetrievalIndex({
  docId, chapterId, parents = {}, preparedChapter, contentUnits, evidenceClusters,
  sceneCards, eventFrames, groundedGoals, causalEdges, progressiveMemory,
}: BuildV3RetrievalIndexParams): V3RetrievalIndexArtifact {
  const structuredRecords = buildV3ParagraphRetrievalRecords({
    chapterId, preparedChapter, contentUnits, evidenceClusters,
  })
  // Existing scene/event/entity/goal/causal records follow.
}
```

- [ ] Load `PRE.1`, `PRE.2`, and `EVID.4` in the IDX.1 route and return a stage-specific 400 when any is absent.
- [ ] Emit the new source contract exactly as `['PRE.1','PRE.2','EVID.4','MEM.1','EVENT.2','GOAL.1','CAUS.1','MEM.2']`, and mirror it in Firestore dependency validation and pipeline edges.
- [ ] Update workbench IDX.1 readiness to require the three new inputs and preserve its current IDX.1/IDX.2 cascade deletion.
- [ ] Re-run both focused tests and confirm they pass.
- [ ] Commit: `git add src/lib/pipeline/v3-narrative-memory.ts src/app/api/pipeline/v3-retrieval-index/route.ts src/config/pipeline-graph.ts src/lib/firestore.ts src/components/v3/PreMentionWorkbench.tsx tests/v3-narrative-memory.test.ts tests/v3-semantic-stage-registration.test.ts && git commit -m "feat: index story paragraphs in idx1"`

### Task 4: Embed hydrated paragraphs in immutable IDX.2 blobs

**Files:**
- Modify: `src/lib/pipeline/v3-semantic-index-types.ts`
- Modify: `src/lib/pipeline/v3-semantic-index.ts`
- Modify: `src/app/api/pipeline/v3-semantic-index/route.ts`
- Modify: `src/lib/storage.ts`
- Modify: `src/lib/server/v3-qa-retrieval-service.ts`
- Test: `tests/v3-semantic-index.test.ts`
- Test: `tests/v3-semantic-vector-storage.test.ts`

- [ ] Add failing tests for the combined summary+paragraph fingerprint, `TEXT_PARAGRAPH_*` vector-to-record mapping, old 0.1 payload validation, and content-addressed storage paths that differ when compressed payload content differs.

```ts
const hydrated = hydrateV3RetrievalDocuments({ retrievalIndex, preparedChapter })
assert.equal(hydrated.some((doc) => doc.text === "Alice ate cake and drank tea."), true)
assert.equal(retrievalRecordIdForTextDocument(hydrated.at(-1)!), "PARAGRAPH_para_0007")
assert.notEqual(first.vector_blob.storage_path, second.vector_blob.storage_path)
```

- [ ] Run `node --import tsx --test tests/v3-semantic-index.test.ts tests/v3-semantic-vector-storage.test.ts` and confirm failure.
- [ ] Version `IDX.2` metadata and vector payload to 0.2, allow 0.1 reads for single-chapter compatibility, and set new `source_stage_ids` to `["IDX.1", "PRE.1"]`.
- [ ] Make `retrievalRecordIdForTextDocument` always strip `TEXT_` first; this prevents goal/causal documents from collapsing into their referenced event and handles paragraph documents consistently.
- [ ] In the IDX.2 route load pinned `PRE.1`, hydrate once, embed the combined list once, fingerprint that same list, and save parents for both sources.
- [ ] Compute the gzip buffer and SHA-256 before choosing the path, then write to `documents_v3/{docId}/chapters/{chapterId}/runs/{runId}/indexes/idx2/{contentHash}.vectors.json.gz`. Keep downloads of old stored paths unchanged.
- [ ] In single-chapter retrieval service, hydrate PRE.1 for new IDX.1, validate the combined fingerprint, and pass hydrated documents into the pure retriever; old IDX.1 continues using its embedded text documents.
- [ ] Re-run focused tests and confirm they pass.
- [ ] Commit: `git add src/lib/pipeline/v3-semantic-index-types.ts src/lib/pipeline/v3-semantic-index.ts src/app/api/pipeline/v3-semantic-index/route.ts src/lib/storage.ts src/lib/server/v3-qa-retrieval-service.ts tests/v3-semantic-index.test.ts tests/v3-semantic-vector-storage.test.ts && git commit -m "feat: embed hydrated paragraph documents"`

### Task 5: Reuse one ranking core and restore food-detail retrieval

**Files:**
- Create: `src/lib/pipeline/v3-qa-ranking.ts`
- Modify: `src/lib/pipeline/v3-qa-retrieval.ts`
- Modify: `src/lib/pipeline/v3-qa-retrieval-types.ts`
- Modify: `src/lib/server/v3-qa-history.ts`
- Test: `tests/v3-qa-retrieval.test.ts`
- Test: `tests/v3-qa-history.test.ts`

- [ ] Add a failing regression where summaries contain no food terms but hydrated P7 contains `cake` and `tea`; assert a paragraph hit at P7. Add a second assertion that the same hit is blocked at P6.

```ts
const result = retrieveV3QAEvidence({
  question: "What did Alice eat?",
  progressEndPid: 7,
  retrievalIndex,
  textDocuments: hydratedDocuments,
  sceneCards,
  eventFrames,
  memoryContract,
})
assert.equal(result.hits[0]?.record_type, "paragraph")
assert.deepEqual(result.hits[0]?.text_span, { start_pid: 7, end_pid: 7 })
```

- [ ] Run `node --import tsx --test tests/v3-qa-retrieval.test.ts tests/v3-qa-history.test.ts` and confirm the new assertions fail.
- [ ] Extract normalization, lexical scoring, deterministic sorting, and RRF into a generic pure core used by both single- and multi-chapter retrieval.

```ts
export function rankV3QARecords<T extends V3RankableQARecord>(params: {
  question: string
  records: readonly T[]
  semanticScores?: Readonly<Record<string, number>>
}): V3RankedQARecord<T>[]
```

- [ ] Add `textDocuments?: V3RetrievalTextDocument[]` to `retrieveV3QAEvidence`; default it to `retrievalIndex.text_documents` so callers and old tests retain current behavior.
- [ ] Add `"paragraph"` to retrieval/history validation enums. Do not change legacy history scope or schema version.
- [ ] Re-run focused tests and confirm both food recall and all existing graph/semantic/progress behavior pass.
- [ ] Commit: `git add src/lib/pipeline/v3-qa-ranking.ts src/lib/pipeline/v3-qa-retrieval.ts src/lib/pipeline/v3-qa-retrieval-types.ts src/lib/server/v3-qa-history.ts tests/v3-qa-retrieval.test.ts tests/v3-qa-history.test.ts && git commit -m "feat: retrieve grounded paragraph details"`

### Task 6: Define deterministic BOOK.1 manifests and entity groups

**Files:**
- Create: `src/lib/pipeline/v3-book-qa-types.ts`
- Create: `src/lib/pipeline/v3-book-qa-corpus.ts`
- Create: `src/lib/pipeline/v3-book-entity-grouping.ts`
- Test: `tests/v3-book-qa-corpus.test.ts`
- Test: `tests/v3-book-entity-grouping.test.ts`

- [ ] Write failing corpus tests for stable fingerprint/ID from ordered chapter and artifact refs, changed IDs after any pinned artifact changes, exact canonical order preservation, invalid reader chapters/PIDs, and readable-chapter selection.
- [ ] Write failing grouping tests for `Alice` across chapters, type separation, `time` exclusion, NFKC/case/whitespace/edge-punctuation normalization, pronoun/generic-role denial, direct and transitive same-chapter ambiguity, unresolved diagnostics, alias first PID, link first PID, and future/current-PID visible views.

```ts
assert.deepEqual(
  visibleV3BookEntityGroup(aliceGroup, { chapter_id: "ch02", pid: 4 })
    ?.members.map((member) => member.chapter_id),
  ["ch01", "ch02"],
)
assert.equal(
  visibleV3BookEntityGroup(aliceGroup, { chapter_id: "ch01", pid: 3 })
    ?.members.some((member) => member.chapter_id === "ch02"),
  false,
)
```

- [ ] Run `node --import tsx --test tests/v3-book-qa-corpus.test.ts tests/v3-book-entity-grouping.test.ts` and confirm module-not-found failures.
- [ ] Define the document-scoped types, including chapter-qualified spans/hits and explicit readiness diagnostics.

```ts
export interface V3BookReaderPosition { chapter_id: string; pid: number }
export interface V3BookQAChapterRef {
  chapter_id: string
  chapter_title: string
  chapter_index: number
  run_id: string
  artifact_ids: Partial<Record<V3BookQAPinnedStageId, string>>
}
export interface V3BookQACorpusManifest {
  stage_id: "BOOK.1"
  artifact_version: "v3-book-qa-corpus-0.1"
  qa_corpus_id: string
  doc_id: string
  ordered_chapter_ids: string[]
  chapters: V3BookQAChapterRef[]
  fingerprint: string
  readiness: V3BookQAReadinessDiagnostic[]
}
```

- [ ] Compute `fingerprint = sha256(stable ordered refs)` and `qa_corpus_id = BOOK1_${fingerprint.slice(0, 32)}`. Do not hash only run names.
- [ ] Build entity aliases by joining EVID.4 `candidate_cluster_map` to EVID.3 candidate provenance. Only `cast/place/object` participate.
- [ ] Normalize with NFKC, lower-case, whitespace folding, and leading/trailing punctuation removal. Reject fixed code-owned pronoun/generic keys.
- [ ] Before each union, reject a key or transitive component that would contain two clusters from one chapter. Record a deterministic unresolved diagnostic.
- [ ] Hash a group ID from corpus ID, entity type, the lexicographically smallest safe shared identity key, and sorted `${chapterId}:${clusterId}` members.
- [ ] Set each alias `available_from_pid` from its own candidate occurrences and `link_available_from_pid` from the first occurrence of the actual shared identity key, never from the chapter-wide minimum PID.
- [ ] Re-run focused tests and confirm they pass.
- [ ] Commit: `git add src/lib/pipeline/v3-book-qa-types.ts src/lib/pipeline/v3-book-qa-corpus.ts src/lib/pipeline/v3-book-entity-grouping.ts tests/v3-book-qa-corpus.test.ts tests/v3-book-entity-grouping.test.ts && git commit -m "feat: define book qa corpus and entity groups"`

### Task 7: Resolve and persist immutable BOOK.1 corpora

**Files:**
- Modify: `src/lib/firestore.ts`
- Create: `src/lib/server/v3-book-qa-corpus-store.ts`
- Create: `src/lib/server/v3-book-qa-corpus-service.ts`
- Create: `src/app/api/pipeline/v3-book-qa-corpus/route.ts`
- Modify: `src/lib/client-data.ts`
- Test: `tests/v3-book-qa-corpus-service.test.ts`
- Test: `tests/v3-book-qa-corpus-store.test.ts`

- [ ] Add failing dependency-injected service tests for canonical manifest order, legacy fallback order, requested run-map validation, favorite-then-latest deterministic selection, missing stage diagnostics, rejection of old IDX.1/EVID.3, and resolved content-addressed stage IDs.
- [ ] Add failing fake-store tests for manifest-last visibility, entity group subcollection writes, idempotent retry, and 409-equivalent fingerprint conflict.
- [ ] Run `node --import tsx --test tests/v3-book-qa-corpus-service.test.ts tests/v3-book-qa-corpus-store.test.ts` and confirm failure.
- [ ] Export narrow Firestore helpers instead of exposing private refs.

```ts
export async function resolveRunStageArtifactRefs(
  docId: string, chapterId: string, runId: string,
  options: FirestoreReadOptions = {},
): Promise<Record<string, string>>

export async function loadStageResultByArtifactId<T extends PipelineArtifact>(
  docId: string, chapterId: string, artifactId: string, expectedStageKey: string,
  options: FirestoreReadOptions = {},
): Promise<T | null>
```

- [ ] Require real `stageRefs` for BOOK.1 pinning; old inline/run-artifact fallbacks remain available only through existing single-chapter `loadStageResult`.
- [ ] Add a server-authoritative ordered-chapter helper that preserves canonical revision manifest order before applying the current non-story/duplicate filters; use existing numeric legacy ordering only when no canonical revision exists.
- [ ] Resolve every chapter to an explicitly requested run or, when omitted, the first favorite run then most recently updated run. Pin `PRE.1`, `PRE.2`, `EVID.3`, `EVID.4`, `MEM.0`, `MEM.1`, `EVENT.2`, `IDX.1`, and optional `IDX.2` artifact IDs.
- [ ] Keep manifest data compact; store groups under `documents_v3/{docId}/qa_corpora/{qaCorpusId}/entity_groups/{globalEntityId}` in bounded batches, then create the manifest last as the visibility barrier.
- [ ] Implement `GET ?docId=&qaCorpusId=` and `POST {source:"v3",docId,chapterRunIds?}`. Map validation errors to 400 and immutable/fingerprint/readiness conflicts to 409.
- [ ] Add typed `loadV3BookQACorpus` and `buildV3BookQACorpus` client functions.
- [ ] Re-run focused tests and confirm they pass.
- [ ] Commit: `git add src/lib/firestore.ts src/lib/server/v3-book-qa-corpus-store.ts src/lib/server/v3-book-qa-corpus-service.ts src/app/api/pipeline/v3-book-qa-corpus/route.ts src/lib/client-data.ts tests/v3-book-qa-corpus-service.test.ts tests/v3-book-qa-corpus-store.test.ts && git commit -m "feat: persist immutable book qa corpora"`

### Task 8: Federate retrieval across readable chapters

**Files:**
- Create: `src/lib/pipeline/v3-book-qa-retrieval.ts`
- Create: `src/lib/server/v3-book-qa-retrieval-service.ts`
- Test: `tests/v3-book-qa-retrieval.test.ts`
- Test: `tests/v3-book-qa-retrieval-service.test.ts`

- [ ] Add failing pure tests for previous-chapter/full-current-prefix filtering, future-chapter exclusion, namespaced records/edges, one global RRF order, bounded graph neighbors, visible entity-group matching/expansion, no future alias or canonical-label leakage, and food-paragraph retrieval from chapter one while reading chapter two.
- [ ] Add failing service tests for unknown corpus, fingerprint mismatch, missing required stage, paragraph-less IDX.1, missing/stale/corrupt IDX.2, mixed embedding models, mixed dimensions, and exactly one query embedding call.

```ts
const result = retrieveV3BookQAEvidence({
  corpus,
  chapters: [chapter1, chapter2],
  entityGroups: [aliceGroup],
  question: "What did Alice eat earlier?",
  readerPosition: { chapter_id: "ch02", pid: 4 },
  queryEmbedding: [1, 0, 0],
})
assert.equal(result.hits[0]?.record_id, "ch01:PARAGRAPH_para_0007")
assert.equal(result.hits.some((hit) => hit.chapter_id === "ch03"), false)
```

- [ ] Run `node --import tsx --test tests/v3-book-qa-retrieval.test.ts tests/v3-book-qa-retrieval-service.test.ts` and confirm failure.
- [ ] For each allowed pinned chapter, load artifacts by artifact ID, hydrate PRE.1, validate the current combined fingerprint against IDX.2, download/hash-check vectors, and require one common model/dimension pair.
- [ ] Namespace every record/edge as `${chapterId}:${localId}` before ranking. Attach chapter ID/title and chapter-local span to every returned hit.
- [ ] Hard-filter readable records first, then compute lexical and semantic rankings over the combined set and call the shared RRF core once.
- [ ] Match only visible group aliases/labels. Expand only readable records whose `entity_refs` contain visible member cluster IDs; mark them with `match_kind: "entity_group"` and keep expansion bounded by the request limit.
- [ ] Throw typed `V3BookQARequestError` values carrying HTTP status and chapter/stage diagnostics; never return `insufficient_evidence` for readiness failures.
- [ ] Re-run focused tests and confirm they pass.
- [ ] Commit: `git add src/lib/pipeline/v3-book-qa-retrieval.ts src/lib/server/v3-book-qa-retrieval-service.ts tests/v3-book-qa-retrieval.test.ts tests/v3-book-qa-retrieval-service.test.ts && git commit -m "feat: federate reader-safe book retrieval"`

### Task 9: Build and validate chapter-qualified grounded answers

**Files:**
- Create: `src/lib/pipeline/v3-book-qa-answer-types.ts`
- Create: `src/lib/pipeline/v3-book-qa-answer.ts`
- Create: `prompts/v3_book_qa_grounded_answer.txt`
- Modify: `src/lib/llm-client.ts`
- Create: `src/app/api/pipeline/v3-book-qa-answer/route.ts`
- Modify: `src/lib/client-data.ts`
- Test: `tests/v3-book-qa-answer.test.ts`

- [ ] Add failing tests for chapter-qualified context paragraphs, per-hit paragraph association, character budgets that keep whole paragraphs, valid cross-chapter citations, and downgrade on unknown/future/cross-associated citation or evidence IDs.

```ts
assert.deepEqual(answer.citations, [{
  chapter_id: "ch01",
  chapter_title: "Down the Rabbit-Hole",
  pid: 7,
  paragraph_text: "Alice ate cake and drank tea.",
}])
```

- [ ] Run `node --import tsx --test tests/v3-book-qa-answer.test.ts` and confirm module-not-found failure.
- [ ] Implement separate book types and pure context/normalizer functions. Citation identity is the tuple `(chapter_id,pid)`, never a bare PID.

```ts
export interface V3BookQAContextParagraph {
  chapter_id: string
  chapter_title: string
  pid: number
  text: string
}

export function normalizeV3BookQAGroundedAnswer(params: {
  raw: unknown
  context: V3BookQAAnswerContext
}): V3BookQAGroundedAnswer
```

- [ ] Add a separate prompt and `LLMClient.answerV3BookQuestion`; require JSON `citation_refs: [{chapter_id,pid}]` and `used_evidence_ids`.
- [ ] Implement POST `/api/pipeline/v3-book-qa-answer` body `{source:"v3",docId,qaCorpusId,question,readerPosition,limit?,model?}`. Retrieve first, load only the pinned readable paragraphs needed by hits, call the model only when context exists, and map typed readiness/validation errors to their 400/409 status.
- [ ] Only a successful ready search with no valid support returns a 200 `insufficient_evidence` answer.
- [ ] Add typed `answerV3BookQuestion` to `client-data.ts`.
- [ ] Re-run the focused test and confirm it passes.
- [ ] Commit: `git add src/lib/pipeline/v3-book-qa-answer-types.ts src/lib/pipeline/v3-book-qa-answer.ts prompts/v3_book_qa_grounded_answer.txt src/lib/llm-client.ts src/app/api/pipeline/v3-book-qa-answer/route.ts src/lib/client-data.ts tests/v3-book-qa-answer.test.ts && git commit -m "feat: answer with chapter-qualified evidence"`

### Task 10: Add isolated book-scoped QA history

**Files:**
- Create: `src/lib/v3-book-qa-history-types.ts`
- Create: `src/lib/server/v3-book-qa-history.ts`
- Create: `src/lib/server/v3-book-qa-history-store.ts`
- Create: `src/app/api/v3/book-qa-history/route.ts`
- Modify: `src/lib/client-data.ts`
- Test: `tests/v3-book-qa-history.test.ts`
- Test: `tests/v3-qa-history.test.ts`

- [ ] Add failing tests for `qa_corpus_id` scope identity, reader-position storage, chapter-qualified retrieval/citations, future citation rejection, cursor pagination, deletion, size limits, and unchanged parsing of a legacy chapter history fixture.
- [ ] Run `node --import tsx --test tests/v3-book-qa-history.test.ts tests/v3-qa-history.test.ts` and confirm only new book tests fail.
- [ ] Define `schema_version: "v3-book-qa-history-0.2"`, `reader_position`, and a book answer snapshot. Scope ID is `sha256(JSON.stringify(["book", qaCorpusId]))`.
- [ ] Store at `documents_v3/{docId}/book_qa_history/{scopeId}/entries/{entryId}` so no existing history document or validator changes meaning.
- [ ] Validate every hit/citation against manifest order and the saved reader position before writing; use the same 800 KiB budget and 20-entry page size as chapter history.
- [ ] Implement GET/POST/DELETE and typed client helpers.
- [ ] Re-run focused tests and confirm all pass.
- [ ] Commit: `git add src/lib/v3-book-qa-history-types.ts src/lib/server/v3-book-qa-history.ts src/lib/server/v3-book-qa-history-store.ts src/app/api/v3/book-qa-history/route.ts src/lib/client-data.ts tests/v3-book-qa-history.test.ts tests/v3-qa-history.test.ts && git commit -m "feat: store book scoped qa history"`

### Task 11: Wire book QA, citations, and reader position into the UI

**Files:**
- Modify: `src/components/v3/v3-navigation.ts`
- Modify: `src/app/v3/page.tsx`
- Modify: `src/components/v3/PreMentionWorkbench.tsx`
- Modify: `src/components/v3/V3ReadingQAView.tsx`
- Create: `src/components/v3/V3BookQAHistoryPanel.tsx`
- Test: `tests/v3-navigation.test.ts`
- Test: `tests/v3-book-qa-view-model.test.ts`

- [ ] Read the required local Next page and `useRouter` guides before editing these files.
- [ ] Add failing navigation tests proving `qaCorpusId`, pinned `runId`, `readerChapterId`, `readerPid`, displayed `chapterId`, `source=v3`, and `view=qa` round-trip without dropping unrelated required state.

```ts
assert.equal(createV3WorkbenchHref({
  docId: "doc", chapterId: "ch01", runId: "run-a", source: "v3", view: "qa",
  qaCorpusId: "BOOK1_abc", readerPosition: { chapter_id: "ch02", pid: 4 },
}), "/v3?docId=doc&chapterId=ch01&runId=run-a&source=v3&view=qa&qaCorpusId=BOOK1_abc&readerChapterId=ch02&readerPid=4")
```

- [ ] Add pure view-model tests for corpus readiness messaging, current-chapter scroll target, and earlier-chapter citation href using the manifest's pinned run.
- [ ] Run `node --import tsx --test tests/v3-navigation.test.ts tests/v3-book-qa-view-model.test.ts` and confirm failure.
- [ ] Parse the new search params in the async page and pass initial QA navigation state into the workbench. Honor a valid `initialRunId` when loading chapter runs.
- [ ] Keep corpus ID and original reader position lifted above the keyed chapter QA view or encoded in the URL so citation navigation cannot reset them.
- [ ] Add a book mode to the reading view: create/rebuild corpus, show readiness diagnostics, call book answer/history endpoints, and render citations as `Chapter title / Pn`.
- [ ] For same-chapter citations, scroll to a paragraph element with a deterministic DOM ID. For earlier chapters, construct `citationHref = createV3WorkbenchHref({ docId, chapterId: citation.chapter_id, runId: pinnedRunId, source: "v3", view: "qa", qaCorpusId, readerPosition })` and call `router.push(citationHref)`. Do not call `handleChapterChange`, which intentionally resets to pipeline.
- [ ] Keep the legacy single-chapter mode usable when no corpus is selected.
- [ ] Re-run focused tests and confirm they pass.
- [ ] Commit: `git add src/components/v3/v3-navigation.ts src/app/v3/page.tsx src/components/v3/PreMentionWorkbench.tsx src/components/v3/V3ReadingQAView.tsx src/components/v3/V3BookQAHistoryPanel.tsx tests/v3-navigation.test.ts tests/v3-book-qa-view-model.test.ts && git commit -m "feat: expose book scoped reading qa"`

### Task 12: Documentation, full verification, cleanup, review, and PR

**Files:**
- Modify: `docs/superpowers/specs/2026-07-31-v3-book-qa-retrieval-design.md`
- Modify: `docs/source/implementation/v3-current-implementation.md`
- Modify: `docs/source/implementation/v3-next-roadmap.md`
- Modify: `README.md` only if existing operator instructions name the QA routes or index prerequisites

- [ ] Amend the approved design's EVID.3 paragraph to record the discovered compatibility requirement: new EVID.3 preserves `pid/span/normalized`, while old artifacts remain single-chapter compatible and are not BOOK.1-ready.
- [ ] Document paragraph-capable IDX.1/IDX.2 versions, content-addressed vector paths, BOOK.1 storage, grouping precision policy, reader-position safety, readiness errors, endpoint contracts, and rebuild steps.
- [ ] Run focused book/paragraph tests sequentially:

```powershell
node --import tsx --test tests/v3-evidence-gate.test.ts tests/v3-retrieval-documents.test.ts tests/v3-narrative-memory.test.ts tests/v3-semantic-index.test.ts tests/v3-semantic-vector-storage.test.ts
node --import tsx --test tests/v3-qa-retrieval.test.ts tests/v3-book-qa-corpus.test.ts tests/v3-book-entity-grouping.test.ts tests/v3-book-qa-corpus-service.test.ts tests/v3-book-qa-corpus-store.test.ts
node --import tsx --test tests/v3-book-qa-retrieval.test.ts tests/v3-book-qa-retrieval-service.test.ts tests/v3-book-qa-answer.test.ts tests/v3-book-qa-history.test.ts tests/v3-navigation.test.ts tests/v3-book-qa-view-model.test.ts
```

- [ ] Run `npm test` and require all tests to pass.
- [ ] Run `npm run typecheck` and require exit code 0.
- [ ] Run `npm run lint` and require exit code 0 with no new warnings.
- [ ] Run `npm run build` and require a successful Next.js production build.
- [ ] Start one local development server only if none is already task-owned. In the in-app browser, verify `/v3?docId={docId}&chapterId={chapterId}&source=v3&view=qa` can build/load a BOOK.1 corpus, retrieve the chapter-one food paragraph from a later reader position, reject a future PID, show `Chapter / Pn`, navigate to an earlier citation while preserving corpus/reader params, and restore book history without console errors.
- [ ] Stop only the task-owned server. Check `git status --short`, `Get-Process node`, and the worktree for `.next`, coverage, screenshots, logs, generated fixtures, or temporary files created by this task. Remove task-owned artifacts; do not touch the user's Firebase login process or unrelated files.
- [ ] Run `git diff --check` and repeat the directly affected tests after cleanup.
- [ ] Commit documentation: `git add docs/superpowers/specs/2026-07-31-v3-book-qa-retrieval-design.md docs/source/implementation/v3-current-implementation.md docs/source/implementation/v3-next-roadmap.md README.md && git commit -m "docs: document book scoped qa retrieval"` (omit `README.md` from `git add` if unchanged).
- [ ] Invoke `superpowers:requesting-code-review`, address only verified actionable findings, and re-run the affected gates.
- [ ] Invoke `superpowers:verification-before-completion`, then `superpowers:finishing-a-development-branch`.
- [ ] Confirm the branch contains only intentional commits and is based on current `origin/main`; push `codex/v3-book-qa-retrieval` and open a ready PR targeting `main` with summary, test evidence, migration/rebuild note, and explicit statement that no future chapter/PID is searched.
