# Stable Corpus Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store each byte-identical EPUB once as an immutable canonical revision with explicit book identity, stable paragraph coordinates, retry-safe import, and legacy workspace compatibility.

**Architecture:** Pure identity and orchestration modules own deterministic IDs and the import state machine behind repository/blob interfaces. A real EPUB parser preserves spine provenance, while Firestore and Firebase Storage adapters persist one canonical corpus and source-specific workspace references. Existing random-ID documents keep their embedded chapter fallback.

**Tech Stack:** Next.js 16.2.2 Route Handlers, TypeScript 5, Node.js 20.19+, `node:test`, `tsx`, JSZip test fixtures, `epub2`, Firebase Admin Firestore and Storage.

---

## File Structure

- Create `src/lib/corpus-identity.ts`: pure byte/content identity and validated ID derivation.
- Create `src/lib/corpus-import.ts`: credential-free import lifecycle, errors, and adapter contracts.
- Create `src/lib/server/firestore-corpus-import-store.ts`: Firestore implementation and canonical chapter reads.
- Create `tests/helpers/synthetic-epub.ts`: in-memory, rights-safe EPUB builder used only by permanent tests.
- Create `tests/corpus-identity.test.ts`: identity contract tests.
- Create `tests/epub-corpus-coordinates.test.ts`: real parser provenance and ordering tests.
- Create `tests/corpus-import.test.ts`: fake repository/blob integration and failure/concurrency tests.
- Modify `src/lib/epub.ts`: provenance-bearing paragraph normalization and stable coordinates.
- Modify `src/types/schema.ts`: additive corpus fields while preserving numeric `pid`.
- Modify `src/lib/firestore.ts`: canonical read fallback for new workspaces and legacy fallback.
- Modify `src/lib/storage.ts`: deterministic create-only canonical source path.
- Modify `src/app/api/epub/route.ts`: thin coordinator call and typed status mapping.
- Modify `src/types/ui.ts`: additive corpus metadata in document results.
- Modify `package.json`, `package-lock.json`, `tsconfig.json`: standard credential-free gates and declared test dependencies.
- Create `scripts/run-tests.mjs` and `.github/workflows/ci.yml`: cross-platform test discovery and read-only CI.
- Modify `docs/source/implementation/epub-ingest-normalization.md`: canonical identity, compatibility, and migration notes.

### Task 1: Reproducible test and CI baseline

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tsconfig.json`
- Create: `scripts/run-tests.mjs`
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Preserve the failing baseline evidence**

Run:

```powershell
npm test
npm run typecheck
npx tsc --noEmit --pretty false
```

Expected: the first two scripts are missing, and direct typecheck reports TS5097 for `.ts`-suffixed test imports.

- [ ] **Step 2: Install declared test-only dependencies**

Run:

```powershell
npm install --save-dev tsx@4.22.3 jszip@3.10.1
```

Expected: `package.json` and `package-lock.json` record both packages; no production dependency changes.

- [ ] **Step 3: Add standard scripts and the matching compiler option**

Add to `package.json`:

```json
{
  "scripts": {
    "test": "node scripts/run-tests.mjs",
    "typecheck": "tsc --noEmit"
  }
}
```

Add to `tsconfig.json` under `compilerOptions`:

```json
{
  "allowImportingTsExtensions": true
}
```

- [ ] **Step 4: Add the cross-platform test runner**

Create `scripts/run-tests.mjs`:

```js
import { spawnSync } from "node:child_process"
import { readdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const testsRoot = path.join(projectRoot, "tests")

async function findTestFiles(directory) {
  const files = []
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await findTestFiles(fullPath))
    else if (entry.isFile() && /\.test\.(?:[cm]?[jt]sx?)$/.test(entry.name)) {
      files.push(path.relative(projectRoot, fullPath))
    }
  }
  return files.sort((left, right) => left.localeCompare(right, "en"))
}

const testFiles = await findTestFiles(testsRoot)
if (testFiles.length === 0) throw new Error(`No test files found under ${testsRoot}`)
const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...testFiles], {
  cwd: projectRoot,
  stdio: "inherit",
})
if (result.error) throw result.error
if (result.signal) throw new Error(`Test runner terminated by signal ${result.signal}`)
process.exit(result.status ?? 1)
```

- [ ] **Step 5: Add credential-free CI**

Create `.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push:
  pull_request:
permissions:
  contents: read
concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
jobs:
  baseline:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    env:
      CI: true
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v6
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run build
```

- [ ] **Step 6: Verify and commit**

Run:

```powershell
npm test
npm run typecheck
git diff --check
git add package.json package-lock.json tsconfig.json scripts/run-tests.mjs .github/workflows/ci.yml
git diff --cached --check
git commit -m "chore: add reproducible TypeScript test baseline"
git push
```

Expected: the existing suite passes, typecheck exits zero, and only baseline files are committed.

### Task 2: Pure corpus identity primitives

**Files:**
- Create: `src/lib/corpus-identity.ts`
- Create: `tests/corpus-identity.test.ts`

- [ ] **Step 1: Write failing identity tests**

Create `tests/corpus-identity.test.ts` with tests that call:

```ts
import test from "node:test"
import assert from "node:assert/strict"
import {
  deriveCorpusIdentity,
  deriveParagraphId,
  deriveSourceItemId,
  validateBookId,
} from "../src/lib/corpus-identity.ts"

test("byte-identical EPUBs reuse one revision regardless of filename", () => {
  const first = deriveCorpusIdentity(Buffer.from("synthetic epub"))
  const second = deriveCorpusIdentity(Buffer.from("synthetic epub"))
  assert.deepEqual(second, first)
  assert.match(first.corpusRevisionId, /^cr_v1_[a-f0-9]{64}$/)
})

test("changed bytes create another revision and can explicitly reuse a book", () => {
  const first = deriveCorpusIdentity(Buffer.from("edition one"))
  const second = deriveCorpusIdentity(Buffer.from("edition two"), first.bookId)
  assert.notEqual(second.corpusRevisionId, first.corpusRevisionId)
  assert.equal(second.bookId, first.bookId)
})

test("book IDs reject path-like or whitespace values", () => {
  for (const value of ["", "book/id", "book id", "_book"]) {
    assert.throws(() => validateBookId(value), /bookId/)
  }
})

test("source and paragraph IDs are deterministic and provenance-sensitive", () => {
  const revision = deriveCorpusIdentity(Buffer.from("fixture"))
  const source = deriveSourceItemId(revision.corpusRevisionId, 0, "chapter-1", "text/ch1.xhtml")
  assert.equal(source, deriveSourceItemId(revision.corpusRevisionId, 0, "chapter-1", "text/ch1.xhtml"))
  assert.notEqual(source, deriveSourceItemId(revision.corpusRevisionId, 1, "chapter-1", "text/ch1.xhtml"))
  assert.notEqual(deriveParagraphId(revision.corpusRevisionId, source, 0), deriveParagraphId(revision.corpusRevisionId, source, 1))
})
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```powershell
node --import tsx --test tests/corpus-identity.test.ts
```

Expected: FAIL because `src/lib/corpus-identity.ts` does not exist.

- [ ] **Step 3: Implement the identity module**

Create `src/lib/corpus-identity.ts` with these exported contracts:

```ts
import { createHash } from "node:crypto"

export interface CorpusIdentity {
  sourceSha256: string
  corpusRevisionId: string
  bookId: string
}

const BOOK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const digest = (value: Buffer | string) => createHash("sha256").update(value).digest("hex")
const digestParts = (...parts: Array<string | number>) => digest(parts.join("\0"))

export function validateBookId(bookId: string): string {
  if (!BOOK_ID_PATTERN.test(bookId)) throw new Error("bookId must match ^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")
  return bookId
}

export function deriveCorpusIdentity(bytes: Buffer, requestedBookId?: string): CorpusIdentity {
  const sourceSha256 = digest(bytes)
  return {
    sourceSha256,
    corpusRevisionId: `cr_v1_${sourceSha256}`,
    bookId: requestedBookId ? validateBookId(requestedBookId) : `book_v1_${sourceSha256}`,
  }
}

export function deriveSourceItemId(revisionId: string, spineIndex: number, manifestId: string, normalizedHref: string): string {
  return `si_v1_${digestParts(revisionId, spineIndex, manifestId, normalizedHref)}`
}

export function deriveParagraphId(revisionId: string, sourceItemId: string, sourceParagraphOrdinal: number): string {
  return `p_v1_${digestParts(revisionId, sourceItemId, sourceParagraphOrdinal)}`
}
```

- [ ] **Step 4: Verify GREEN and commit**

Run:

```powershell
node --import tsx --test tests/corpus-identity.test.ts
npm run typecheck
git add src/lib/corpus-identity.ts tests/corpus-identity.test.ts
git diff --cached --check
git commit -m "feat: add stable corpus identity primitives"
git push
```

Expected: four focused tests pass and typecheck exits zero.

### Task 3: Preserve EPUB provenance and assign book-wide coordinates

**Files:**
- Modify: `src/types/schema.ts`
- Modify: `src/lib/epub.ts`
- Create: `tests/helpers/synthetic-epub.ts`
- Create: `tests/epub-corpus-coordinates.test.ts`

- [ ] **Step 1: Add an in-memory synthetic EPUB builder**

Create `tests/helpers/synthetic-epub.ts` exporting:

```ts
import JSZip from "jszip"

export async function buildSyntheticEpub(chapters = ["Alpha", "Beta"]): Promise<Buffer> {
  const zip = new JSZip()
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" })
  zip.file("META-INF/container.xml", `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`)
  const manifest = chapters.map((_, index) => `<item id="ch${index + 1}" href="ch${index + 1}.xhtml" media-type="application/xhtml+xml"/>`).join("")
  const spine = chapters.map((_, index) => `<itemref idref="ch${index + 1}"/>`).join("")
  zip.file("OEBPS/content.opf", `<?xml version="1.0"?><package version="2.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Synthetic Story</dc:title><dc:identifier id="id">synthetic</dc:identifier><dc:language>en</dc:language></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>${manifest}</manifest><spine toc="ncx">${spine}</spine></package>`)
  zip.file("OEBPS/toc.ncx", `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><head></head><docTitle><text>Synthetic Story</text></docTitle><navMap>${chapters.map((title, index) => `<navPoint id="nav${index + 1}" playOrder="${index + 1}"><navLabel><text>${title}</text></navLabel><content src="ch${index + 1}.xhtml"/></navPoint>`).join("")}</navMap></ncx>`)
  chapters.forEach((title, index) => {
    const paragraphs = Array.from({ length: 4 }, (_, paragraphIndex) => `<p>${title} paragraph ${paragraphIndex + 1} ${"synthetic ".repeat(40)}</p>`).join("")
    zip.file(`OEBPS/ch${index + 1}.xhtml`, `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>${title}</h1>${paragraphs}</body></html>`)
  })
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })
}
```

- [ ] **Step 2: Write failing parser-coordinate tests**

Create `tests/epub-corpus-coordinates.test.ts` that parses the same buffer twice with the same identity and asserts:

```ts
const first = await parseEpub(bytes, {
  docId: identity.corpusRevisionId,
  bookId: identity.bookId,
  corpusRevisionId: identity.corpusRevisionId,
})
const second = await parseEpub(Buffer.from(bytes), {
  docId: identity.corpusRevisionId,
  bookId: identity.bookId,
  corpusRevisionId: identity.corpusRevisionId,
})
const firstParagraphs = first.flatMap((chapter) => chapter.paragraphs)
const secondParagraphs = second.flatMap((chapter) => chapter.paragraphs)
assert.deepEqual(secondParagraphs.map((paragraph) => paragraph.paragraph_id), firstParagraphs.map((paragraph) => paragraph.paragraph_id))
assert.deepEqual(firstParagraphs.map((paragraph) => paragraph.global_ordinal), firstParagraphs.map((_, index) => index))
assert.ok(firstParagraphs.every((paragraph) => paragraph.source_item_id?.startsWith("si_v1_")))
assert.ok(first.every((chapter) => chapter.book_id === identity.bookId && chapter.corpus_revision_id === identity.corpusRevisionId))
```

- [ ] **Step 3: Run focused test and confirm RED**

Run:

```powershell
node --import tsx --test tests/epub-corpus-coordinates.test.ts
```

Expected: FAIL because `parseEpub` accepts only a string doc ID and paragraph fields are absent.

- [ ] **Step 4: Extend schemas additively**

Update `src/types/schema.ts`:

```ts
export interface Paragraph {
  pid: number
  start: number
  end: number
  text: string
  paragraph_id?: string
  source_item_id?: string
  source_paragraph_ordinal?: number
  global_ordinal?: number
}

export interface ChapterSource {
  // existing fields remain
  source_item_ids?: string[]
}

export interface RawChapter {
  // existing fields remain
  book_id?: string
  corpus_revision_id?: string
}
```

- [ ] **Step 5: Preserve provenance through normalization**

In `src/lib/epub.ts`, introduce:

```ts
interface SourceParagraphCandidate {
  text: string
  sourceItemId: string
  sourceParagraphOrdinal: number
}

export interface ParseEpubContext {
  docId: string
  bookId?: string
  corpusRevisionId?: string
}
```

Convert HTML strings to `SourceParagraphCandidate` immediately after deriving `sourceItemId`, keep these objects through merge/split/dedup, and derive final values with:

```ts
paragraphs.push({
  pid: index,
  start: position,
  end: position + candidate.text.length,
  text: candidate.text,
  paragraph_id: context.corpusRevisionId
    ? deriveParagraphId(context.corpusRevisionId, candidate.sourceItemId, candidate.sourceParagraphOrdinal)
    : undefined,
  source_item_id: candidate.sourceItemId,
  source_paragraph_ordinal: candidate.sourceParagraphOrdinal,
  global_ordinal: globalStartOrdinal + index,
})
```

Use `randomUUID()` instead of `Date.now()` for the temporary EPUB path and retain the existing `finally` unlink.

- [ ] **Step 6: Verify and commit**

Run:

```powershell
node --import tsx --test tests/epub-corpus-coordinates.test.ts
npm test
npm run typecheck
git add src/types/schema.ts src/lib/epub.ts tests/helpers/synthetic-epub.ts tests/epub-corpus-coordinates.test.ts
git diff --cached --check
git commit -m "feat: assign stable EPUB paragraph coordinates"
git push
```

Expected: all parser and existing tests pass; no generated `.epub` file remains in the worktree.

### Task 4: Credential-free idempotent import coordinator

**Files:**
- Create: `src/lib/corpus-import.ts`
- Create: `tests/corpus-import.test.ts`

- [ ] **Step 1: Write failing fake-store integration tests**

Create map-backed fakes implementing these contracts:

```ts
export interface CorpusImportRepository {
  getRevision(revisionId: string): Promise<CorpusRevisionRecord | null>
  claimRevision(input: ClaimRevisionInput): Promise<ClaimRevisionResult>
  saveChapters(revisionId: string, claimToken: string, chapters: RawChapter[]): Promise<void>
  completeRevision(input: CompleteRevisionInput): Promise<void>
  failRevision(input: FailRevisionInput): Promise<void>
  listChapters(revisionId: string): Promise<RawChapter[]>
  ensureWorkspace(input: EnsureWorkspaceInput): Promise<void>
}

export interface CorpusBlobStore {
  putIfAbsent(input: PutCorpusBlobInput): Promise<StoredSourceFile>
}
```

Cover first import, sequential reimport, concurrent active claim, changed bytes with explicit book linking, conflict, invalid-EPUB parser failure before any claim, failure-after-blob retry, and workspace failure after completion. Assert map sizes and write counters, not method-call order.

- [ ] **Step 2: Run focused test and confirm RED**

Run:

```powershell
node --import tsx --test tests/corpus-import.test.ts
```

Expected: FAIL because `src/lib/corpus-import.ts` does not exist.

- [ ] **Step 3: Implement the state machine and errors**

Create `src/lib/corpus-import.ts` exporting:

```ts
export class CorpusImportError extends Error {
  constructor(message: string, readonly statusCode: number, readonly code: string) {
    super(message)
  }
}

export const CORPUS_CLAIM_LEASE_MS = 5 * 60 * 1000

export async function importCorpusEpub(input: CorpusImportInput, dependencies: CorpusImportDependencies): Promise<CorpusImportResult> {
  let identity
  try {
    identity = deriveCorpusIdentity(input.buffer, input.bookId)
  } catch (error) {
    throw new CorpusImportError(error instanceof Error ? error.message : "invalid bookId", 400, "invalid_book_id")
  }
  const existing = await dependencies.repository.getRevision(identity.corpusRevisionId)
  if (existing?.status === "complete") {
    if (input.bookId && existing.bookId !== identity.bookId) throw new CorpusImportError("corpus revision belongs to another book", 409, "book_conflict")
    await dependencies.repository.ensureWorkspace({ ...identity, title: input.title, source: input.source, sourceFile: existing.sourceFile })
    return { ...identity, docId: identity.corpusRevisionId, chapters: await dependencies.repository.listChapters(identity.corpusRevisionId), sourceFile: existing.sourceFile, reused: true }
  }

  const chapters = await dependencies.parseEpub(input.buffer, {
    docId: identity.corpusRevisionId,
    bookId: identity.bookId,
    corpusRevisionId: identity.corpusRevisionId,
  })
  const nowMs = dependencies.now().getTime()
  const claimToken = dependencies.createClaimToken()
  const claim = await dependencies.repository.claimRevision({ ...identity, claimToken, nowMs, claimExpiresAtMs: nowMs + CORPUS_CLAIM_LEASE_MS })
  if (claim.outcome === "complete") {
    const completed = await dependencies.repository.getRevision(identity.corpusRevisionId)
    if (!completed || completed.status !== "complete") throw new CorpusImportError("completed corpus revision is unavailable", 409, "revision_unavailable")
    await dependencies.repository.ensureWorkspace({ ...identity, title: input.title, source: input.source, sourceFile: completed.sourceFile })
    return { ...identity, docId: identity.corpusRevisionId, chapters: await dependencies.repository.listChapters(identity.corpusRevisionId), sourceFile: completed.sourceFile, reused: true }
  }
  if (claim.outcome === "in_progress") throw new CorpusImportError("corpus import already in progress", 409, "import_in_progress")

  let completed = false
  let failedStep = "blob"
  try {
    const sourceFile = await dependencies.blobStore.putIfAbsent({ ...identity, fileName: input.fileName, contentType: input.contentType, buffer: input.buffer })
    failedStep = "chapters"
    await dependencies.repository.saveChapters(identity.corpusRevisionId, claimToken, chapters)
    failedStep = "complete"
    await dependencies.repository.completeRevision({ ...identity, claimToken, sourceFile, chapterIds: chapters.map((chapter) => chapter.chapter_id) })
    completed = true
    failedStep = "workspace"
    await dependencies.repository.ensureWorkspace({ ...identity, title: input.title, source: input.source, sourceFile })
    return { ...identity, docId: identity.corpusRevisionId, chapters, sourceFile, reused: false }
  } catch (error) {
    if (!completed) await dependencies.repository.failRevision({ corpusRevisionId: identity.corpusRevisionId, claimToken, failedStep, message: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) })
    throw error
  }
}
```

When `claimRevision` reports `complete`, load the stored manifest and return it directly. Do not recurse or parse the EPUB a second time; keep the public result shape unchanged.

- [ ] **Step 4: Verify and commit**

Run:

```powershell
node --import tsx --test tests/corpus-import.test.ts
npm test
npm run typecheck
git add src/lib/corpus-import.ts tests/corpus-import.test.ts
git diff --cached --check
git commit -m "feat: add idempotent corpus import coordinator"
git push
```

Expected: fake integration tests prove one revision/blob/chapter manifest for identical bytes and retry-safe failure behavior.

### Task 5: Firebase canonical corpus adapters

**Files:**
- Create: `src/lib/server/firestore-corpus-import-store.ts`
- Modify: `src/lib/storage.ts`

- [ ] **Step 1: Implement the Firestore repository**

Create `FirestoreCorpusImportRepository` implementing `CorpusImportRepository` with:

```ts
const CORPUS_BOOKS_COLLECTION = "corpus_books"
const CORPUS_REVISIONS_COLLECTION = "corpus_revisions"

const revisionRef = (revisionId: string) => getAdminDb().collection(CORPUS_REVISIONS_COLLECTION).doc(revisionId)
const bookRef = (bookId: string) => getAdminDb().collection(CORPUS_BOOKS_COLLECTION).doc(bookId)
```

`claimRevision` uses one Firestore transaction. It validates explicit `bookId` intent, preserves a stored explicit association for an omitted-book claimant that loses the first-import race, returns `complete` for complete records, returns `in_progress` when `claimExpiresAtMs > nowMs`, and otherwise creates/reclaims `pending` with the supplied token. `completeRevision` and `failRevision` transactionally compare `claimToken`; stale writers throw `CorpusImportError` with `409` and code `claim_lost`.

`saveChapters` uses deterministic chapter IDs and conservative Firestore transactions of at most 20 chapter writes and 3 MiB of estimated serialized payload. `listChapters` reads only the completed revision's ordered `chapterIds` manifest. `ensureWorkspace` merge-writes the source-selected `documents_v2` or `documents_v3` record with `bookId`, `corpusRevisionId`, title, and source file.

- [ ] **Step 2: Implement create-only canonical blob storage**

Add to `src/lib/storage.ts`:

```ts
export async function putCanonicalSourceEpub(input: {
  corpusRevisionId: string
  sourceSha256: string
  fileName: string
  buffer: Buffer
  contentType: string
}): Promise<StoredSourceFile> {
  const storagePath = `corpus_revisions/${input.corpusRevisionId}/source.epub`
  const file = getAdminStorageBucket().file(storagePath)
  try {
    await file.save(input.buffer, {
      resumable: false,
      metadata: { contentType: input.contentType, metadata: { sourceSha256: input.sourceSha256 } },
      preconditionOpts: { ifGenerationMatch: 0 },
    })
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && Number(error.code) === 412)) throw error
  }
  return { bucket: bucketName(), storagePath, gsUri: `gs://${bucketName()}/${storagePath}`, fileName: input.fileName, contentType: input.contentType, sizeBytes: input.buffer.byteLength }
}
```

Expose a small `FirebaseCorpusBlobStore` adapter that delegates to this function.

- [ ] **Step 3: Verify adapter contracts and commit**

Run:

```powershell
npm run typecheck
npm test
git add src/lib/server/firestore-corpus-import-store.ts src/lib/storage.ts
git diff --cached --check
git commit -m "feat: persist canonical corpus revisions"
git push
```

Expected: credential-free gates pass; no Firebase call is made by tests.

### Task 6: Route integration and legacy read compatibility

**Files:**
- Modify: `src/app/api/epub/route.ts`
- Modify: `src/lib/firestore.ts`
- Modify: `src/types/ui.ts`
- Modify: `docs/source/implementation/epub-ingest-normalization.md`
- Test: `tests/corpus-import.test.ts`

- [ ] **Step 1: Add route error/status tests at the coordinator boundary**

Extend `tests/corpus-import.test.ts` to verify `CorpusImportError.statusCode` and `code` for invalid book IDs, explicit book conflicts, and active imports. Expected statuses are `400`, `409`, and `409` respectively. Add a pure `workspaceCorpusRevisionId` helper to `src/lib/corpus-import.ts` and assert that `{ corpusRevisionId: "cr_v1_..." }` selects the canonical revision while `{}` returns `null` for the legacy embedded-chapter path.

- [ ] **Step 2: Replace the route's random-document workflow**

Update `POST /api/epub` to:

```ts
const formData = await request.formData()
const file = formData.get("file")
if (!(file instanceof File)) return Response.json({ error: "No file provided" }, { status: 400 })
const result = await importCorpusEpub({
  buffer: Buffer.from(await file.arrayBuffer()),
  fileName: file.name,
  contentType: file.type || "application/epub+zip",
  title: String(formData.get("title") ?? "Untitled"),
  bookId: typeof formData.get("bookId") === "string" ? String(formData.get("bookId")) : undefined,
  source: parseFirestoreDataSource(typeof formData.get("source") === "string" ? String(formData.get("source")) : undefined),
}, productionDependencies)
return Response.json(result)
```

Catch `CorpusImportError` and return its status/code; retain generic `500` handling without exposing credentials.

- [ ] **Step 3: Add canonical read fallback**

In `src/lib/firestore.ts`, extend `DocumentMeta` with `bookId` and `corpusRevisionId`. In `loadRawChapter` and `listChapters`, load the workspace metadata first. When `corpusRevisionId` exists, delegate to canonical helpers from `firestore-corpus-import-store.ts`; otherwise execute the current embedded chapter logic unchanged.

Add the same optional fields to `src/types/ui.ts` so existing clients remain source-compatible.

- [ ] **Step 4: Document compatibility and migration behavior**

Append to `docs/source/implementation/epub-ingest-normalization.md`:

```markdown
## 2026-07-27 canonical corpus identity

New imports use a byte-derived `corpus_revision_id`, an explicit or deterministic `book_id`, canonical source storage, stable paragraph IDs, and book-wide global ordinals. Byte-identical retries reuse the completed canonical revision. Changed bytes create a new immutable revision and join an existing book only when the caller supplies that book ID.

Existing random-ID documents remain readable from their embedded chapter trees. No title-, author-, filename-, or text-based backfill is performed.
```

- [ ] **Step 5: Verify and commit**

Run:

```powershell
npm test
npm run typecheck
npm run lint
npm run build
git add src/app/api/epub/route.ts src/lib/firestore.ts src/types/ui.ts tests/corpus-import.test.ts docs/source/implementation/epub-ingest-normalization.md
git diff --cached --check
git commit -m "feat: route EPUB uploads through canonical corpus import"
git push
```

Expected: all package gates pass without Firebase/OpenRouter credentials; existing API response fields remain present.

### Task 7: Final cleanup, review, and PR evidence

**Files:**
- Modify only files required to resolve verified review findings.

- [ ] **Step 1: Inspect the branch diff and untracked artifacts**

Run:

```powershell
git status --short
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
git diff --name-status origin/main...HEAD
git ls-files --others --exclude-standard
```

Delete only generated/debug artifacts created by this branch. Keep `tests/corpus-identity.test.ts`, `tests/epub-corpus-coordinates.test.ts`, `tests/corpus-import.test.ts`, and `tests/helpers/synthetic-epub.ts` because they are permanent regression assets. Do not delete or alter the user's original dirty `v3` worktree.

- [ ] **Step 2: Run the fresh final gate once**

Run:

```powershell
npm ci
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: all tests pass with exact counts reported, typecheck/build exit zero, and lint has no new errors. Record any pre-existing warnings separately.

- [ ] **Step 3: Request two-stage code review and fix only verified findings**

Review first for spec compliance, then for code quality/security/concurrency. Any behavioral fix starts with a failing regression test. Commit each verified fix separately and push it.

- [ ] **Step 4: Confirm clean PR scope and create the PR**

Run:

```powershell
git status --short --branch
git log --oneline origin/main..HEAD
git diff --check origin/main...HEAD
git push
```

Create a `main`-targeted PR summarizing schema/API changes, migration compatibility, exact verification commands and results, unresolved deployment risks, and the next smallest P0 ticket.
