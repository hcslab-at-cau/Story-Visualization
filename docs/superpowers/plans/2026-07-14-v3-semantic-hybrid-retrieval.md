# V3 Semantic Hybrid Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `IDX.2` embedding stage and progress-safe hybrid semantic, lexical, and graph retrieval to V3 Reading QA.

**Architecture:** Keep `IDX.1` as the canonical document source, store compact `IDX.2` metadata in V3 Firestore, and store gzip-compressed vectors in V3 Firebase Storage. Embed each question at request time, hard-filter by reader progress, combine lexical and semantic ranks with Reciprocal Rank Fusion, then expand graph neighbors.

**Tech Stack:** Next.js 16 App Router route handlers, React 19 client UI, TypeScript, OpenAI SDK against OpenRouter's OpenAI-compatible embeddings endpoint, Firebase Admin Firestore and Storage, Node test runner.

---

### Task 1: Pure Semantic Index and Hybrid Ranking

**Files:**
- Create: `src/lib/pipeline/v3-semantic-index-types.ts`
- Create: `src/lib/pipeline/v3-semantic-index.ts`
- Modify: `src/lib/pipeline/v3-qa-retrieval.ts`
- Modify: `src/lib/pipeline/v3-qa-retrieval-types.ts`
- Test: `tests/v3-semantic-index.test.ts`
- Test: `tests/v3-qa-retrieval.test.ts`

- [ ] Write failing tests for deterministic source fingerprints, vector validation, cosine similarity, semantic-only retrieval, lexical fallback, progress filtering, and graph expansion.
- [ ] Run `node --experimental-strip-types --test tests/v3-semantic-index.test.ts tests/v3-qa-retrieval.test.ts` and confirm the new assertions fail.
- [ ] Add the minimal pure index and RRF ranking implementation.
- [ ] Re-run the focused tests and confirm they pass.

### Task 2: Embedding Provider and Vector Storage

**Files:**
- Create: `src/lib/embedding-client.ts`
- Modify: `src/lib/storage.ts`
- Create: `src/app/api/pipeline/v3-semantic-index/route.ts`

- [ ] Reuse the installed `openai` package with `baseURL=https://openrouter.ai/api/v1`, `OPENROUTER_API_KEY`, and default model `openai/text-embedding-3-small`.
- [ ] Add V3-scoped gzip vector upload/download helpers with content-hash verification.
- [ ] Build and save `IDX.2` metadata after embedding `IDX.1.text_documents`.
- [ ] Keep API keys and provider calls server-only.

### Task 3: Pipeline Registration and Workbench UI

**Files:**
- Modify: `src/types/schema.ts`
- Modify: `src/config/pipeline-graph.ts`
- Modify: `src/lib/firestore.ts`
- Modify: `src/lib/ui-strings.ts`
- Modify: `src/components/v3/pre-workbench-state.ts`
- Modify: `src/components/v3/PreMentionWorkbench.tsx`
- Modify: `src/components/v3/PreStageViews.tsx`
- Create: `src/components/v3/V3SemanticIndexStageView.tsx`

- [ ] Register `IDX.1 -> IDX.2` and require `IDX.1` before running the new stage.
- [ ] Load, invalidate, run, and render `IDX.2` using existing V3 stage patterns.
- [ ] Show model, dimensions, vector count, compressed size, and source fingerprint in the stage result.

### Task 4: Hybrid Reading QA

**Files:**
- Modify: `src/app/api/pipeline/v3-qa-retrieve/route.ts`
- Modify: `src/components/v3/V3ReadingQAView.tsx`
- Modify: `src/lib/client-data.ts`

- [ ] Load `IDX.2` and its vector blob when available, embed the question, and pass semantic similarities to the pure retriever.
- [ ] Preserve lexical fallback for older runs without `IDX.2`.
- [ ] Display retrieval mode and per-hit lexical, semantic, hybrid, or graph provenance.

### Task 5: Documentation and Verification

**Files:**
- Modify: `docs/source/implementation/v3-current-implementation.md`
- Modify: `docs/source/implementation/v3-next-roadmap.md`

- [ ] Document `IDX.2`, Storage placement, hybrid query order, and fallback behavior.
- [ ] Run `node --experimental-strip-types --test tests/v3-*.test.ts`.
- [ ] Run `npx tsc --noEmit --pretty false --allowImportingTsExtensions`.
- [ ] Run `npm run lint` and `npm run build`.
- [ ] Start or reuse the local server and visually verify `/v3?view=qa` plus the `IDX.2` pipeline result in the in-app browser with no console errors.
