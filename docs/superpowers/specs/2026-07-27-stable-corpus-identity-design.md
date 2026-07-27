# Stable Corpus Identity and Idempotent EPUB Import Design

**Date:** 2026-07-27
**Scope:** Study-1-independent P0 slice for new EPUB imports
**Target:** Byte-stable corpus revisions, book-wide paragraph coordinates, and retry-safe import without participant data or external model calls

## Context

The current upload path creates a random workspace document, writes the source EPUB, and only then parses and saves chapters. Retrying the same bytes therefore creates another document, another storage object, and another chapter tree. Paragraph `pid` values restart in every chapter, and normalization discards paragraph-level spine provenance while merging and splitting candidates.

The repository also has separate `documents_v2` and `documents_v3` workspaces. Making only those document IDs deterministic would still duplicate the same corpus across workbench namespaces. This slice therefore introduces one canonical corpus layer and lets existing workspace documents reference it.

## Goals

- Compute a SHA-256 identity from the complete EPUB bytes before any persistent write.
- Reuse one immutable corpus revision, chapter set, and source blob for byte-identical EPUB imports.
- Create a different immutable revision for changed bytes; never overwrite a prior revision.
- Preserve an explicit immutable `book_id` relationship without inferring it from title or author metadata.
- Preserve spine provenance through normalization and assign stable paragraph IDs plus zero-based, book-wide `global_ordinal` values.
- Keep existing chapter-local numeric `pid` and `chNN` chapter IDs for downstream compatibility.
- Verify the complete coordinator with an in-memory fake store and an in-memory synthetic EPUB. No Firebase, OpenRouter, commercial EPUB, or participant data is used.
- Keep incomplete revisions hidden and make failed imports safely retryable under the same identity.

## Non-goals

- Backfilling old random-ID documents or guessing book relationships from titles.
- Treating separately packaged but text-equivalent EPUB files as the same revision. Revision identity is byte-based in this slice.
- Replacing chapter-local `pid`, changing downstream artifact schemas, or building book-level retrieval.
- Participant/session ownership, exposure state, epistemic policy, QA lifecycle, or study event logging.
- A final UI for linking a changed EPUB to an existing book. The API accepts an explicit `bookId`; UI workflow is a later ticket.

## Approaches Considered

### 1. Deterministic IDs inside each existing document collection

This is the smallest code change, but the same bytes can still create separate chapter and storage trees in `documents_v2` and `documents_v3`. It also keeps `docId` overloaded as book, revision, workspace, and run owner.

### 2. A hash registry pointing to the existing random document

This can deduplicate sequential retries, but it adds a second identity that can diverge from the document and does not solve canonical chapter/storage ownership. Partial import repair also remains difficult.

### 3. Canonical corpus collections with workspace references

This is the selected approach. Canonical books, revisions, chapters, and source bytes are stored once. Current and V3 workspaces keep their existing run/artifact trees and reference the revision. Central Firestore helpers resolve canonical raw chapters when the reference exists and fall back to embedded legacy chapters otherwise.

## Identity Contract

All hashes use SHA-256 over UTF-8 identity components separated by a NUL byte. Hex digests are lowercase and untruncated.

- `source_sha256`: SHA-256 of the exact uploaded EPUB bytes.
- `corpus_revision_id`: `cr_v1_<source_sha256>`.
- `book_id`: a validated caller-provided ID, or `book_v1_<source_sha256>` for a first import without an explicit relationship. Titles never participate.
- `source_item_id`: `si_v1_<sha256(corpus_revision_id, spine_index, manifest_id, normalized_href)>`.
- `paragraph_id`: `p_v1_<sha256(corpus_revision_id, source_item_id, source_paragraph_ordinal)>`.
- `global_ordinal`: a zero-based integer assigned after chapter normalization across every retained paragraph in reading order.

Supplying a different `bookId` for an already known revision is a conflict and must not relink the revision. Changed bytes join an existing book only when the caller explicitly supplies that book's ID.

Caller-provided book IDs must match `^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`. This keeps them valid as Firestore document IDs and rejects path separators, whitespace, and empty identifiers.

## Canonical Data Model

```text
corpus_books/{bookId}
  schemaVersion: 1
  createdAt

corpus_revisions/{corpusRevisionId}
  schemaVersion: 1
  ingestSchemaVersion: 1
  bookId
  sourceSha256
  status: pending | complete | failed
  chapterIds
  chapterCount
  sourceFile
  claimToken
  claimExpiresAt
  createdAt / updatedAt / completedAt

corpus_revisions/{corpusRevisionId}/chapters/{chapterId}
  raw: RawChapter

Storage: corpus_revisions/{corpusRevisionId}/source.epub

documents_v2/{corpusRevisionId}, documents_v3/{corpusRevisionId}, or legacy documents/{corpusRevisionId}
  title
  bookId
  corpusRevisionId
  sourceFile
  createdAt / updatedAt
```

New workspace `docId` values equal `corpusRevisionId` so existing routes can continue passing a single `docId`. The existing `source` selector still chooses current, V3, or legacy workspace metadata and run trees, while all three reference the same canonical corpus. Code that needs book semantics must use `bookId`; it must not assume `docId === bookId`.

`RawChapter` gains additive `book_id` and `corpus_revision_id` fields. `ChapterSource` gains `source_item_ids`. Each `Paragraph` keeps `pid`, `start`, `end`, and `text`, and gains `paragraph_id`, `source_item_id`, `source_paragraph_ordinal`, and `global_ordinal`.

## Parser and Ordering Flow

Spine extraction produces provenance-bearing paragraph candidates rather than plain strings:

```ts
interface SourceParagraphCandidate {
  text: string
  sourceItemId: string
  sourceParagraphOrdinal: number
}
```

Short-chapter merge, long-chapter split, and duplicate suppression preserve these values. Duplicate content suppression may discard a candidate, but it never renumbers the source paragraph ordinal. After final normalization, chapter-local `pid`, character offsets, stable `paragraph_id`, and revision-wide `global_ordinal` are assigned in one deterministic pass.

## Import Lifecycle

1. Read the complete file into memory and derive the identity. No store or blob method is called before this point.
2. Read the canonical revision by ID. If it is complete, verify any explicit `bookId`, ensure the selected workspace reference exists, and return the stored manifest without parsing or rewriting the blob or chapters.
3. Parse and normalize the EPUB locally. Invalid EPUBs fail before any persistent write.
4. Transactionally claim the revision with a random claim token and explicit book association.
   - A missing revision becomes `pending`.
   - A complete revision returns the existing result.
   - An active pending revision returns an in-progress conflict instead of starting a second writer.
   - A failed revision or a pending claim older than five minutes is reclaimed under the same revision ID for retry.
5. Put the source at the fixed canonical storage path with create-only semantics. A retry may reuse the existing object for the same content identity but never replaces a different revision.
6. Write deterministic canonical chapter documents. The revision manifest's `chapterIds` is the authoritative set; incomplete rows are never listed.
7. Mark the revision `complete` last, including its exact chapter manifest and source-file metadata.
8. Upsert the source-specific workspace reference. If this final reference write fails, the canonical revision remains complete and a retry only repairs the missing reference.
9. On failure after a claim, mark the revision `failed` with the failed step and a bounded diagnostic. Failed revisions remain hidden and reuse the same identity on retry.

Completion and failure transitions compare the claim token transactionally. A timed-out writer cannot complete or fail a revision after a newer retry has reclaimed it. The coordinator receives its clock and token factory as dependencies so lease behavior remains deterministic in tests.

The coordinator owns this lifecycle behind narrow repository and blob interfaces. Firebase modules implement the production adapters; tests use maps and fault injection.

## Read Compatibility

- `listChapters` and `loadRawChapter` first inspect the workspace document. When it has `corpusRevisionId`, they read the canonical revision manifest and canonical chapter documents.
- Documents without a canonical reference continue using their embedded chapter subcollection exactly as before.
- `listDocuments` includes legacy documents and complete canonical workspace references, but excludes new references whose canonical revision is not complete.
- Existing random-ID documents are not rewritten, merged, or linked by title.

## Error and Concurrency Semantics

- Missing file or invalid `bookId`: `400`, no persistent write.
- Invalid EPUB: `500` with the existing route error shape, no persistent write.
- Explicit book conflict for a known revision: `409`, no relinking or write.
- Another active claim for the same revision: `409` with the revision ID; no second blob or chapter writer.
- Persistence failure after claim: revision becomes `failed`; it is not listable as complete.
- Retry after failure: same revision ID and book ID, fixed blob key, deterministic chapter IDs, and manifest-last completion.

## API Compatibility

`POST /api/epub` keeps accepting `file`, `title`, and `source`. It additionally accepts optional `bookId` and returns the existing `docId`, `chapters`, and `sourceFile` fields plus:

```json
{
  "bookId": "book_v1_...",
  "corpusRevisionId": "cr_v1_...",
  "reused": false
}
```

Existing upload clients remain valid. A later UI can submit a previously returned `bookId` when importing a changed edition.

## Verification Strategy

Permanent regression tests use `node:test` and a declared test-only ZIP builder dependency. They construct a minimal valid EPUB entirely in memory and do not commit a binary fixture.

Tests cover:

- byte-identical buffers and different filenames produce the same revision ID;
- a one-byte/content change produces a different revision;
- explicit book linking across changed revisions and conflict rejection;
- stable source-item and paragraph IDs across repeated parsing;
- unique, monotonic, book-wide ordinals across multiple chapters;
- first import creates exactly one canonical book, revision, blob, and chapter set;
- sequential and concurrent identical imports converge without duplicate writes;
- complete reimport short-circuits before parsing and writing;
- injected failures never expose a partial revision, and retry completes under the same ID;
- legacy document reads still use embedded chapters.

The final gate runs the standard test, typecheck, lint, and production build commands without Firebase or LLM credentials. Before the PR is created, generated EPUBs, debug probes, test output, `.next`, coverage, logs, and other temporary artifacts are removed or confirmed ignored. Permanent regression tests and their in-memory builder remain because they are part of the acceptance contract.

## Migration and Rollout

No destructive migration is included. Canonical identity applies to new imports after this change. Old documents retain their existing storage and chapter trees. A future opt-in migration must require an explicit book relationship; it must not infer one from title, author, filename, or chapter text.
