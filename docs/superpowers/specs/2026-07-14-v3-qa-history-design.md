# V3 Reading QA History Design

Date: 2026-07-14

## Goal

Persist successful V3 Reading QA interactions and show them in a fixed right sidebar. The current screen lists only the selected document, chapter, and run. The storage shape must allow a later book-wide history view without moving existing entries.

## Scope

Included:

- Automatically save both `answered` and `insufficient_evidence` results.
- Load the newest 20 entries for the current chapter and run.
- Load the next 20 entries when the user selects `Load more`.
- Restore the saved question, reader progress, answer, citations, and retrieval result without another LLM call.
- Delete one saved entry after native browser confirmation.
- Keep history failures non-blocking for the current answer.

Deferred:

- Book-wide history UI.
- Multi-turn conversational context and follow-up resolution.
- Editing, pinning, searching, or bulk deletion.
- Streaming answer tokens.

## Storage

History remains inside the V3 Firestore namespace and is not stored as a pipeline artifact.

Path:

```text
documents_v3/{docId}/qa_history/{scopeId}/entries/{entryId}
```

`scopeId` is a stable server-generated encoding of `[chapterId, runId]`. Each scope document records its `chapter_id` and `run_id`. Keeping entries under a scope allows a simple `created_at desc` query and cursor pagination without requiring a new composite index for the current view.

Each entry stores:

```text
schema_version
entry_id
doc_id
chapter_id
run_id
question
progress_end_pid
answer_snapshot
created_at
```

`answer_snapshot` is a normalized subset of `V3QAAnswerResult`: the grounded answer, retrieval statistics, and retrieval hits required by the current UI. It does not store graph edges, retrieval metadata, or future debug fields that the restore view does not use. Failed answer requests are not stored; both non-error statuses (`answered` and `insufficient_evidence`) are stored. A future book-wide view can enumerate the document's history scopes or use a collection-group query without changing existing entries.

The serialized entry must remain below 800 KiB, leaving headroom below Firestore's document limit. Oversized snapshots are rejected as a history-save error; the already rendered answer remains available in the current view.

On every successful write, the server upserts the scope document with `chapter_id`, `run_id`, and `updated_at`. `scopeId` is a SHA-256 digest of the length-delimited chapter and run IDs; the raw IDs remain available as scope metadata.

## API

Create one non-pipeline route:

```text
GET    /api/v3/qa-history
POST   /api/v3/qa-history
DELETE /api/v3/qa-history
```

All methods require `source: "v3"`, `docId`, `chapterId`, and `runId`.

- `GET /api/v3/qa-history?source=v3&docId=...&chapterId=...&runId=...&cursor=...` returns at most 20 entries ordered newest first, plus an opaque cursor and `has_more`.
- `POST` accepts `{ source: "v3", docId, chapterId, runId, question, progressEndPid, answerSnapshot }`, validates and stores one non-error QA result, then returns the normalized entry.
- `DELETE` accepts `{ source: "v3", docId, chapterId, runId, entryId }` and deletes one entry only after verifying that it belongs to the requested scope.

Entries are ordered by `created_at desc` and then document ID. The cursor is an opaque, URL-safe encoding of the last returned entry's creation time and ID. The next page uses those two values with `startAfter`, so pagination remains valid if a previously loaded entry is deleted.

## Client Flow

1. Mounting `V3ReadingQAView` requests the first 20 history entries.
2. A successful answer is rendered immediately.
3. The client sends a separate history `POST` request. Save failure shows a warning but does not remove the answer.
4. A saved entry is prepended and selected after the write succeeds.
5. Selecting an entry restores its question, progress, answer, citations, and retrieval cards without rerunning retrieval or the LLM.
6. Changing the question or progress clears the selected history state, matching the current stale-response protection.
7. `Load more` appends the next 20 entries and disappears when `has_more` is false.
8. Deleting the selected entry clears the restored result. Delete failure keeps the entry and shows an error.

## Layout

Use the approved fixed-sidebar layout.

- At `xl` and wider, the main Reading QA area uses the first flexible column and history uses a 320px right column.
- Below `xl`, history follows the main QA area as a full-width section.
- The sidebar shows count, status, progress P#, created time, and a short question preview.
- The selected entry uses a stronger border and background rather than adding a nested card.
- The sidebar has independent vertical scrolling so history length does not move the reading workspace.
- Empty, loading, loading-more, save-error, load-error, and delete-error states are explicit.

## Validation And Safety

- The API writes only to `documents_v3` and rejects current/legacy sources.
- Question text and IDs are trimmed and length-bounded.
- Only validated answer statuses and structurally valid citations/retrieval results are accepted.
- Saved history never bypasses the existing progress-safe result filters when restored.
- The server owns timestamps and entry IDs.
- Stored citations and retrieval hits must not exceed the entry's progress boundary.

## Testing

Add focused tests for:

- V3-only source enforcement.
- Scope ID stability and chapter/run isolation.
- History entry normalization.
- Oversized payload rejection and progress-boundary consistency checks.
- Newest-first 20-item pagination and cursor behavior.
- Save and delete behavior.
- `insufficient_evidence` save/list/restore/delete parity.
- Client restore behavior without an answer API call.
- `Load more` append behavior.
- Pagination after a previously loaded cursor entry is deleted.
- Canceling native delete confirmation without a request or state change.
- Stale request protection after selecting or leaving history.

Run the full V3 suite, TypeScript, lint, and production build. Verify the Alice run in a production browser at desktop and mobile widths, including sidebar scrolling, restore, delete, pagination, citations, no horizontal overflow, and zero console errors.
