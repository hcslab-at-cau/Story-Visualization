# V3 Reading QA Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a V3 reading QA screen that lets a reader ask a question and inspect progress-bounded retrieval evidence before answer generation.

**Architecture:** Keep `IDX.1` as the stored retrieval index and add a query-time retrieval API that reads `IDX.1`, `MEM.1`, `EVENT.2`, and `PRE.1/PRE.2`. The UI becomes a third V3 workbench tab, so it reuses the current document/chapter/run state without creating another page-level file picker.

**Tech Stack:** Next.js App Router route handler, React client component, TypeScript pure retrieval helpers, Node test runner.

---

### Task 1: Retrieval Contract

**Files:**
- Create: `src/lib/pipeline/v3-qa-retrieval-types.ts`
- Create: `src/lib/pipeline/v3-qa-retrieval.ts`
- Test: `tests/v3-qa-retrieval.test.ts`

- [x] Write a failing test that verifies lexical query matching, progress cutoff filtering, blocked-ahead counts, and graph-neighbor expansion.
- [x] Implement minimal token overlap retrieval using existing `IDX.1` text documents and structured records.
- [x] Derive progress spans from `MEM.1` scene cards and `EVENT.2` event-scene membership.
- [x] Return retrieval hits, linked graph edges, evidence refs, and summary stats. Do not generate answers yet.

### Task 2: API Route

**Files:**
- Create: `src/app/api/pipeline/v3-qa-retrieve/route.ts`
- Modify: `src/lib/client-data.ts`

- [x] Add `POST /api/pipeline/v3-qa-retrieve`.
- [x] Load required artifacts from V3 source-aware storage.
- [x] Return errors when `IDX.1` or upstream context is missing.
- [x] Add a typed client helper for the QA tab.

### Task 3: V3 Reading QA UI

**Files:**
- Create: `src/components/v3/V3ReadingQAView.tsx`
- Modify: `src/components/v3/PreMentionWorkbench.tsx`

- [x] Add a `Reading QA` tab beside `Pipeline` and `Timeline graph`.
- [x] Show the current chapter paragraphs with a progress cutoff selector.
- [x] Provide a question textarea and retrieval button.
- [x] Render retrieval hits with type, score, scene/event refs, progress status, and evidence refs.
- [x] Show blocked-ahead counts so reader-progress filtering is visible.

### Task 4: Verification

**Files:**
- Modify: `docs/source/implementation/v3-current-implementation.md`
- Modify: `docs/source/implementation/v3-next-roadmap.md`

- [x] Run `node --experimental-strip-types --test tests\v3-qa-retrieval.test.ts`.
- [x] Run `node --experimental-strip-types --test tests\v3-*.test.ts`.
- [x] Run `npx tsc --noEmit --pretty false --allowImportingTsExtensions`.
- [x] Run `npm run lint`.
- [x] Run `npm run build`.
- [x] Verify `/v3` in the in-app browser: QA tab visible, no console errors, layout usable.
