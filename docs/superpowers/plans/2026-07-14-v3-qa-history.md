# V3 Reading QA History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist V3 Reading QA answers and expose the newest 20 entries in the approved right sidebar, with restore, delete, and 20-item `Load more` pagination.

**Architecture:** Keep history under `documents_v3/{docId}/qa_history/{scopeId}/entries`, separate from pipeline artifacts and V2 data. A server-only module validates compact answer snapshots and owns scope IDs/cursors, Firestore helpers own persistence, and the client restores only the answer/stat/hit fields used by the UI without another model request.

**Tech Stack:** Next.js 16 App Router Route Handlers, React 19, TypeScript, Firebase Admin Firestore, Zod 4, Node test runner, Tailwind CSS.

---

## File Structure

- Create `src/lib/v3-qa-history-types.ts`: shared history entry/page/request types and the 20-item page-size constant.
- Create `src/lib/server/v3-qa-history.ts`: V3-only source validation, scope hashing, snapshot validation, size checks, and opaque cursor encoding.
- Modify `src/lib/firestore.ts`: V3 history collection references plus save/list/delete operations.
- Create `src/app/api/v3/qa-history/route.ts`: GET, POST, and DELETE boundary validation and responses.
- Modify `src/lib/client-data.ts`: typed history API functions.
- Create `src/components/v3/V3QAHistoryPanel.tsx`: accessible loading, empty, entry, error, delete, and `Load more` presentation.
- Modify `src/components/v3/V3ReadingQAView.tsx`: history state, auto-save, restore, deletion, and responsive two-column layout.
- Create `tests/v3-qa-history.test.ts`: pure validation, scope, cursor, and pagination contract coverage.

### Task 1: History Contract And Server Validation

**Files:**
- Create: `src/lib/v3-qa-history-types.ts`
- Create: `src/lib/server/v3-qa-history.ts`
- Test: `tests/v3-qa-history.test.ts`

- [ ] **Step 1: Write failing contract tests**

Add tests that import the not-yet-created helpers and assert:

```ts
assert.equal(V3_QA_HISTORY_PAGE_SIZE, 20)
assert.equal(createV3QAHistoryScopeId("chapter-1", "run-1"), createV3QAHistoryScopeId("chapter-1", "run-1"))
assert.notEqual(createV3QAHistoryScopeId("chapter-1", "run-1"), createV3QAHistoryScopeId("chapter-2", "run-1"))
assert.deepEqual(decodeV3QAHistoryCursor(encodeV3QAHistoryCursor({ createdAtMs: 1234, entryId: "entry-1" })), { createdAtMs: 1234, entryId: "entry-1" })
assert.throws(() => normalizeV3QAHistoryCreateInput({ ...validInput, source: "current" }))
assert.throws(() => normalizeV3QAHistoryCreateInput({ ...validInput, progressEndPid: 3, answerSnapshot: snapshotWithHitAtProgress4 }))
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --experimental-strip-types --test tests/v3-qa-history.test.ts`

Expected: FAIL because the history modules do not exist.

- [ ] **Step 3: Implement the shared contract and validation**

Define:

```ts
export const V3_QA_HISTORY_PAGE_SIZE = 20
export const V3_QA_HISTORY_MAX_BYTES = 800 * 1024

export interface V3QAHistoryEntry {
  schema_version: "v3-qa-history-0.1"
  entry_id: string
  doc_id: string
  chapter_id: string
  run_id: string
  question: string
  progress_end_pid: number
  answer_snapshot: V3QAHistoryAnswerSnapshot
  created_at: string
}

export interface V3QAHistoryPage {
  entries: V3QAHistoryEntry[]
  next_cursor: string | null
  has_more: boolean
}
```

Use `createHash("sha256")` for a stable scope ID, Zod schemas for bounded IDs/question/snapshot fields, `Buffer.byteLength(JSON.stringify(...), "utf8")` for the 800 KiB gate, and base64url JSON for `{ createdAtMs, entryId }` cursors. Require `source === "v3"`; retain only `answer`, retrieval `stats`, and retrieval `hits`; reject malformed snapshots or citations/hits beyond the saved progress.

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run: `node --experimental-strip-types --test tests/v3-qa-history.test.ts`

Expected: all history contract tests pass.

### Task 2: Firestore Persistence And Route Handler

**Files:**
- Modify: `src/lib/firestore.ts`
- Create: `src/app/api/v3/qa-history/route.ts`
- Modify: `tests/v3-qa-history.test.ts`

- [ ] **Step 1: Add failing pagination boundary tests**

Test a pure page normalizer with 21 ordered records and assert that it returns 20 entries, `has_more: true`, and a cursor derived from item 20. Test 20 records as `has_more: false` with a null cursor.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --experimental-strip-types --test tests/v3-qa-history.test.ts`

Expected: FAIL because page normalization is not implemented.

- [ ] **Step 3: Add Firestore operations**

Implement these fixed-V3 operations:

```ts
saveV3QAHistoryEntry(input): Promise<V3QAHistoryEntry>
listV3QAHistoryEntries(input): Promise<V3QAHistoryPage>
deleteV3QAHistoryEntry(input): Promise<boolean>
```

Use `created_at desc` and document ID ordering, fetch 21 records, return 20, and use `startAfter(Timestamp.fromMillis(createdAtMs), entryId)`. Save the scope metadata (`chapter_id`, `run_id`, `updated_at`) and entry in one batch with server timestamps. Verify scope fields before deletion.

- [ ] **Step 4: Add the Route Handler**

Implement GET query parsing plus POST/DELETE JSON parsing. Route all validation failures to status 400, missing delete targets to 404, and unexpected failures to 500 using `errorResponse`; return normalized entries with `okResponse`. Do not export a cache directive because Next.js 16 Route Handlers are dynamic by default when request data and Firestore are read.

- [ ] **Step 5: Run tests and typecheck**

Run: `node --experimental-strip-types --test tests/v3-qa-history.test.ts`

Run: `npx tsc --noEmit`

Expected: both commands exit 0.

### Task 3: Client API And Right History Sidebar

**Files:**
- Modify: `src/lib/client-data.ts`
- Create: `src/components/v3/V3QAHistoryPanel.tsx`
- Modify: `src/components/v3/V3ReadingQAView.tsx`

- [ ] **Step 1: Add typed client operations**

Add:

```ts
listV3QAHistory(params): Promise<V3QAHistoryPage>
saveV3QAHistory(params): Promise<V3QAHistoryEntry>
deleteV3QAHistory(params): Promise<void>
```

GET uses URL query parameters; POST and DELETE use JSON bodies. Always pass the caller's `source`, allowing the route to reject anything except V3.

- [ ] **Step 2: Build the presentational history panel**

Render a 320px desktop sidebar with `aria-label="Question history"`, newest-first rows, status, `P#`, localized time, question preview, selected styling, individual `Delete`, and a full-width `Load more` button. Keep the list independently scrollable and expose explicit loading, empty, load-error, save-error, and delete-error states.

- [ ] **Step 3: Wire state and auto-save**

On mount, load the first page. After a successful answer, render it first and separately save a compact snapshot containing only the grounded answer, retrieval stats, and retrieval hits; prepend/select the saved entry only if the active request generation is unchanged. A save error must not clear the answer.

- [ ] **Step 4: Wire restore, pagination, and delete**

Selecting a row invalidates in-flight answer work and restores question, numeric progress, answer, citations, and retrieval cards without calling `/api/pipeline/v3-qa-answer`. `Load more` appends unique IDs. Delete uses `window.confirm`, removes only after success, and clears the restored result when the selected entry is deleted.

- [ ] **Step 5: Apply the approved responsive layout**

Use `xl:grid-cols-[minmax(0,1fr)_320px]`; below `xl`, place history after the main QA area. Make the sidebar sticky and viewport-bounded only at desktop widths, with no horizontal overflow.

### Task 4: Verification And Visual QA

**Files:**
- Modify only files needed for fixes found during verification.
- Output: `output/playwright/v3-qa-history-desktop.png`
- Output: `output/playwright/v3-qa-history-mobile.png`

- [ ] **Step 1: Run all automated verification**

Run:

```powershell
node --experimental-strip-types --test tests/*.test.ts
npx tsc --noEmit
npm run lint
npm run build
```

Expected: tests, typecheck, and build exit 0; lint has no new errors or warnings beyond the existing three `<img>` warnings.

- [ ] **Step 2: Restart the production server**

Stop only the existing Story-Visualization process bound to port 3001, then run `npm run start -- -p 3001` with hidden-window log redirection. Confirm `/v3` responds with HTTP 200.

- [ ] **Step 3: Verify the Alice desktop flow**

At 1440px width: open Reading QA, answer a question, confirm it appears in the sidebar, reload, restore it without a model request, verify citations and retrieval cards, delete a disposable entry, and inspect console/network errors. Capture `output/playwright/v3-qa-history-desktop.png`.

- [ ] **Step 4: Verify responsive behavior**

At 390px width: confirm the history section follows the QA workspace, all text/buttons fit, the page has no horizontal overflow, and `Load more`/delete remain usable. Capture `output/playwright/v3-qa-history-mobile.png`.

- [ ] **Step 5: Review the final diff against the spec**

Confirm the implementation writes only below `documents_v3`, initially fetches 20, never reruns the LLM for restore, keeps history errors non-blocking, and leaves deferred book-wide/multi-turn features unimplemented.
