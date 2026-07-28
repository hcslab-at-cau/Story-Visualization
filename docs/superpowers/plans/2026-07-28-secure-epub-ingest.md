# Secure EPUB Ingest Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Protect `POST /api/epub` with a production-only fail-closed administrator boundary, exact request and EPUB resource budgets, a patched ZIP reader, and parser-output limits before canonical persistence.

**Architecture:** A focused server guard module owns bearer verification, bounded request streaming, ZIP/EPUB preflight, typed public failures, and a process-local concurrency slot. The Route Handler composes those guards before lazily constructing Firebase adapters, while `parseEpub` enforces domain-level spine and normalized-output limits for every caller. The exact validated bytes continue unchanged into the canonical SHA-256 import coordinator.

**Tech Stack:** Next.js 16.2.2 Route Handlers, TypeScript 5, Node.js 20.19 Web Request streams and crypto, `node:test`, `tsx`, `adm-zip@0.6.0`, `epub2@3.0.2`, JSZip synthetic fixtures.

---

## File Structure

- Create `src/lib/server/epub-ingest-guard.ts`: server-only authentication, request-byte reader, ZIP metadata preflight, typed errors, and process-local single-flight gate.
- Modify `src/app/api/epub/route.ts`: injectable handler composition, lazy Firebase initialization, exact rejection order, and stable public errors.
- Modify `src/lib/epub.ts`: typed spine/paragraph/chapter/text limits that cannot be swallowed by unreadable-item fallback.
- Modify `package.json` and `package-lock.json`: direct pin and `epub2` override for patched `adm-zip@0.6.0`.
- Create `tests/epub-ingest-guard.test.ts`: pure authentication, stream, archive, path, ratio, and concurrency tests.
- Modify `tests/epub-route.test.ts`: hostile-body ordering and no-Firebase route tests using an injected handler.
- Create `tests/epub-parser-limits.test.ts`: small-limit synthetic parser tests and typed limit propagation.
- Modify `tests/helpers/synthetic-epub.ts`: optional required-entry omission and extra-entry support without committing binaries.
- Modify `README.md`: server-only admin token and production upload behavior.
- Modify `docs/source/implementation/epub-ingest-normalization.md`: security pipeline, limits, and remaining deployment controls.

### Task 1: Pin the Patched ZIP Reader

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Record the vulnerable baseline**

Run:

```powershell
npm ls epub2 adm-zip
npm audit --json
```

Expected: `epub2@3.0.2` resolves `adm-zip@0.5.17`, and the audit reports
`GHSA-xcpc-8h2w-3j85` through `epub2`.

- [ ] **Step 2: Pin the direct dependency and transitive override**

Add the direct production dependency and the override:

```json
{
  "dependencies": {
    "adm-zip": "0.6.0"
  },
  "overrides": {
    "epub2": {
      "adm-zip": "0.6.0"
    }
  }
}
```

Keep the remaining dependency order and versions unchanged, then run:

```powershell
npm install --package-lock-only
npm ci
```

- [ ] **Step 3: Verify resolution and parser compatibility**

Run:

```powershell
npm ls epub2 adm-zip
node --import tsx --test tests/epub-corpus-coordinates.test.ts tests/corpus-import.test.ts
npm audit --json
```

Expected: every `epub2` path resolves `adm-zip@0.6.0`; the focused parser and
canonical import tests pass; `npm audit --json` may still exit 1 for unrelated
advisories, but `adm-zip` and `epub2` are absent from its vulnerability keys.

- [ ] **Step 4: Commit**

```powershell
git add -- package.json package-lock.json
git diff --cached --check
git commit -m "fix: pin patched EPUB zip reader"
```

### Task 2: Add Pure Ingest Authentication and Request Guards

**Files:**
- Create: `src/lib/server/epub-ingest-guard.ts`
- Create: `tests/epub-ingest-guard.test.ts`

- [ ] **Step 1: Write failing authentication and request-stream tests**

Create tests with small injected policies. The first group must exercise:

```ts
import assert from "node:assert/strict"
import test from "node:test"
import {
  EpubIngestGuardError,
  IngestConcurrencyGate,
  authorizeEpubIngestRequest,
  readBoundedRequestBody,
  validateDeclaredRequestSize,
  type EpubIngestPolicy,
} from "../src/lib/server/epub-ingest-guard.ts"

const SMALL_POLICY: EpubIngestPolicy = {
  maxRequestBytes: 12,
  maxEpubBytes: 8,
  maxZipEntries: 8,
  maxEntryUncompressedBytes: 64,
  maxTotalUncompressedBytes: 128,
  maxCompressionRatio: 4,
}

test("production without an admin token fails closed", () => {
  assert.throws(
    () => authorizeEpubIngestRequest(new Request("http://local/api/epub"), {
      production: true,
      adminToken: undefined,
    }),
    (error: unknown) => error instanceof EpubIngestGuardError &&
      error.statusCode === 503 && error.code === "ingest_not_configured",
  )
})

test("wrong bearer credentials are rejected", () => {
  const request = new Request("http://local/api/epub", {
    headers: { authorization: "Bearer wrong-value" },
  })
  assert.throws(
    () => authorizeEpubIngestRequest(request, {
      production: true,
      adminToken: "a".repeat(32),
    }),
    (error: unknown) => error instanceof EpubIngestGuardError &&
      error.statusCode === 401 && error.code === "unauthorized",
  )
})

test("bounded body reading rejects dishonest chunked requests", async () => {
  const request = new Request("http://local/api/epub", {
    method: "POST",
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(8))
        controller.enqueue(new Uint8Array(8))
        controller.close()
      },
    }),
    duplex: "half",
  } as RequestInit & { duplex: "half" })

  await assert.rejects(
    readBoundedRequestBody(request, SMALL_POLICY.maxRequestBytes),
    (error: unknown) => error instanceof EpubIngestGuardError &&
      error.code === "request_too_large",
  )
})
```

Also cover: valid 32-byte bearer, configured development bearer, a present
short token returning 503 in every environment, missing-token development
bypass, non-decimal or negative `Content-Length` returning
`400 invalid_content_length`, oversized `Content-Length`, exact stream boundary,
body cancellation on overflow, idempotent slot release, and rejection while the
single slot is held.

- [ ] **Step 2: Run the test to verify RED**

Run:

```powershell
node --import tsx --test tests/epub-ingest-guard.test.ts
```

Expected: FAIL because `src/lib/server/epub-ingest-guard.ts` does not exist.

- [ ] **Step 3: Implement typed errors, constant-time bearer verification, bounded streaming, and the gate**

Create the module with these public contracts:

```ts
import { createHash, timingSafeEqual } from "node:crypto"

export interface EpubIngestPolicy {
  maxRequestBytes: number
  maxEpubBytes: number
  maxZipEntries: number
  maxEntryUncompressedBytes: number
  maxTotalUncompressedBytes: number
  maxCompressionRatio: number
}

export const DEFAULT_EPUB_INGEST_POLICY: EpubIngestPolicy = {
  maxRequestBytes: 51 * 1024 * 1024,
  maxEpubBytes: 50 * 1024 * 1024,
  maxZipEntries: 5_000,
  maxEntryUncompressedBytes: 16 * 1024 * 1024,
  maxTotalUncompressedBytes: 256 * 1024 * 1024,
  maxCompressionRatio: 100,
}

export class EpubIngestGuardError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly headers: HeadersInit = {},
  ) {
    super(message)
    this.name = "EpubIngestGuardError"
  }
}

export function authorizeEpubIngestRequest(
  request: Request,
  config: { production: boolean; adminToken?: string },
): void

export function validateDeclaredRequestSize(
  request: Request,
  maxBytes: number,
): void

export async function readBoundedRequestBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array>

export class IngestConcurrencyGate {
  constructor(maxActive = 1)
  tryAcquire(): (() => void) | undefined
}
```

Bearer comparison must SHA-256 hash both UTF-8 values before
`timingSafeEqual`. `readBoundedRequestBody` must sum chunks before copying,
cancel its reader on overflow, and reject with `request_too_large`. The gate's
release closure must decrement only once.

- [ ] **Step 4: Run the focused tests to verify GREEN**

Run:

```powershell
node --import tsx --test tests/epub-ingest-guard.test.ts
```

Expected: all authentication, stream, and concurrency tests pass.

- [ ] **Step 5: Commit**

```powershell
git add -- src/lib/server/epub-ingest-guard.ts tests/epub-ingest-guard.test.ts
git diff --cached --check
git commit -m "feat: guard EPUB ingest requests"
```

### Task 3: Add ZIP and EPUB Container Preflight

**Files:**
- Modify: `src/lib/server/epub-ingest-guard.ts`
- Modify: `tests/epub-ingest-guard.test.ts`
- Modify: `tests/helpers/synthetic-epub.ts`

- [ ] **Step 1: Extend the synthetic builder and write failing archive tests**

Add builder options that remain in memory:

```ts
export interface SyntheticEpubExtraEntry {
  path: string
  content: string | Buffer
  compression?: "STORE" | "DEFLATE"
}

export interface SyntheticEpubOptions {
  editionLabel?: string
  chapters?: SyntheticEpubChapter[]
  spineIdRefs?: string[]
  omitMimetype?: boolean
  omitContainer?: boolean
  extraEntries?: SyntheticEpubExtraEntry[]
}
```

Conditionally add `mimetype` and `META-INF/container.xml`, then append extra
entries with their requested JSZip compression.

Add tests for a valid synthetic EPUB and each failure class:

```ts
test("archive preflight accepts the synthetic EPUB", async () => {
  const buffer = await buildSyntheticEpub()
  assert.doesNotThrow(() => validateEpubArchive(buffer, DEFAULT_EPUB_INGEST_POLICY))
})

test("archive preflight rejects excessive compression before entry extraction", async () => {
  const buffer = await buildSyntheticEpub({
    extraEntries: [{
      path: "OEBPS/repeated.txt",
      content: "x".repeat(4_096),
      compression: "DEFLATE",
    }],
  })
  assert.throws(
    () => validateEpubArchive(buffer, { ...DEFAULT_EPUB_INGEST_POLICY, maxCompressionRatio: 2 }),
    (error: unknown) => error instanceof EpubIngestGuardError &&
      error.statusCode === 413 && error.code === "epub_resource_limit",
  )
})
```

Cover non-ZIP bytes, omitted/duplicate required entries, invalid mimetype
content or compression, traversal/absolute/backslash/NUL paths, duplicate
normalized paths, encrypted flag, unsupported method, per-entry ZIP64 metadata,
mismatched STORE sizes, a nonzero DEFLATE payload declaring zero output, too
many entries, one oversized entry, and oversized aggregate declared output.

- [ ] **Step 2: Run the archive tests to verify RED**

Run:

```powershell
node --import tsx --test tests/epub-ingest-guard.test.ts
```

Expected: FAIL because `validateEpubArchive` is not exported.

- [ ] **Step 3: Implement metadata-first validation with patched `adm-zip`**

Extend the guard module:

```ts
import AdmZip from "adm-zip"

export interface EpubArchiveSummary {
  entryCount: number
  totalCompressedBytes: number
  totalUncompressedBytes: number
}

export function validateEpubArchive(
  buffer: Buffer,
  policy: EpubIngestPolicy = DEFAULT_EPUB_INGEST_POLICY,
): EpubArchiveSummary
```

Construct `AdmZip` inside a `try` boundary that maps malformed archives to
`422 invalid_epub`. Iterate metadata before any `getData()` call. Reject NUL or
backslash names rather than normalizing them; reject `/`, `//`, drive-prefixed,
empty-segment, `.`, and `..` paths. Permit one trailing empty segment only for a
directory entry. Build a case-sensitive duplicate key from `/`-joined segments
with the directory slash removed so file/directory aliases collide. Reject
encrypted flags, methods other than STORE/DEFLATE, per-entry ZIP64 metadata,
STORE entries whose declared compressed and uncompressed sizes differ, DEFLATE
entries with nonzero compressed bytes but zero declared output, and every policy
excess. The zero-output DEFLATE rule intentionally fails closed because the
selected reader disables its inflate output cap when the declared output is
zero; metadata alone cannot safely distinguish an empty stream from a bomb.
Only after confirming that the sole root `mimetype` entry uses STORE and
declares compressed and uncompressed sizes of exactly 20 bytes may the function
read it and compare the bytes exactly with ASCII `application/epub+zip`.

Map malformed/required-structure failures to `422 invalid_epub`; map all count,
size, or ratio excesses to `413 epub_resource_limit`. Never include archive
entry names or upstream exception messages in the public error message.

- [ ] **Step 4: Verify archive GREEN and canonical parser compatibility**

Run:

```powershell
node --import tsx --test tests/epub-ingest-guard.test.ts
node --import tsx --test tests/epub-corpus-coordinates.test.ts
```

Expected: all guard cases pass and all existing EPUB coordinate tests remain
green with `adm-zip@0.6.0`.

- [ ] **Step 5: Commit**

```powershell
git add -- src/lib/server/epub-ingest-guard.ts tests/epub-ingest-guard.test.ts tests/helpers/synthetic-epub.ts
git diff --cached --check
git commit -m "feat: validate EPUB archive budgets"
```

### Task 4: Enforce Parser Output Limits

**Files:**
- Modify: `src/lib/epub.ts`
- Create: `tests/epub-parser-limits.test.ts`
- Modify: `tests/corpus-import.test.ts`

- [ ] **Step 1: Write failing small-policy parser tests**

Import and exercise an optional third `limits` argument so fixtures stay tiny:

```ts
import assert from "node:assert/strict"
import test from "node:test"
import {
  DEFAULT_EPUB_PARSE_LIMITS,
  EpubParseLimitError,
  parseEpub,
} from "../src/lib/epub.ts"
import { buildSyntheticEpub } from "./helpers/synthetic-epub.ts"

test("parseEpub rejects excessive spine items with a typed limit error", async () => {
  const buffer = await buildSyntheticEpub({ spineIdRefs: ["chap-1", "chap-2"] })
  await assert.rejects(
    parseEpub(buffer, "doc-limit", {
      ...DEFAULT_EPUB_PARSE_LIMITS,
      maxSpineItems: 1,
    }),
    (error: unknown) => error instanceof EpubParseLimitError &&
      error.limit === "spine_items",
  )
})
```

Also cover maximum paragraphs per source item, one paragraph's UTF-8 bytes,
final normalized chapters, total paragraphs, and total text bytes. Include one
test where a limit error occurs inside the current per-spine `try/catch` and
assert that it propagates rather than silently skipping the item. Coordinator
coverage must assert that a new or incomplete revision performs no claim or
persistence write after a parser-limit failure; an initial revision metadata
read remains allowed so complete reimports retain their parser short-circuit.

- [ ] **Step 2: Run parser-limit tests to verify RED**

Run:

```powershell
node --import tsx --test tests/epub-parser-limits.test.ts
```

Expected: FAIL because the limit exports and third argument do not exist.

- [ ] **Step 3: Implement parser limits without changing normalized output**

Add:

```ts
export interface EpubParseLimits {
  maxSpineItems: number
  maxParagraphsPerSourceItem: number
  maxChapters: number
  maxParagraphs: number
  maxParagraphBytes: number
  maxTextBytes: number
}

export const DEFAULT_EPUB_PARSE_LIMITS: EpubParseLimits = {
  maxSpineItems: 1_000,
  maxParagraphsPerSourceItem: 10_000,
  maxChapters: 1_500,
  maxParagraphs: 100_000,
  maxParagraphBytes: 1024 * 1024,
  maxTextBytes: 64 * 1024 * 1024,
}

export class EpubParseLimitError extends Error {
  constructor(public readonly limit: string) {
    super("EPUB content exceeds the configured resource budget")
    this.name = "EpubParseLimitError"
  }
}
```

Extend `parseEpub(buffer, context, limits = DEFAULT_EPUB_PARSE_LIMITS)` and pass
the limits into extraction/materialization. Check spine count before the loop,
source paragraph counts and paragraph bytes after HTML summarization, and final
chapter/paragraph/text totals before returning. In the per-spine catch, rethrow
`EpubParseLimitError`; continue skipping only genuinely unreadable items.

- [ ] **Step 4: Verify parser GREEN and identity invariance**

Run:

```powershell
node --import tsx --test tests/epub-parser-limits.test.ts tests/epub-corpus-coordinates.test.ts tests/corpus-import.test.ts
```

Expected: new limit tests pass; existing deterministic IDs, merge/split, and
retry behavior remain unchanged.

- [ ] **Step 5: Commit**

```powershell
git add -- src/lib/epub.ts tests/epub-parser-limits.test.ts tests/corpus-import.test.ts
git diff --cached --check
git commit -m "feat: bound EPUB parser output"
```

### Task 5: Compose the Secure Route Boundary

**Files:**
- Modify: `src/app/api/epub/route.ts`
- Modify: `tests/epub-route.test.ts`

- [ ] **Step 1: Write failing route-order tests with dependency injection**

Define test helpers that create a handler with small policies and a fake import
function. Cover:

- production misconfiguration, missing bearer, and wrong bearer without pulling
  the hostile body stream;
- invalid content type before body read;
- oversized declared length before body read;
- dishonest streamed overflow before multipart parsing;
- missing/non-File value preserving the existing `No file provided` message;
- oversized `File.size` before `arrayBuffer` and import;
- invalid archive before `importDependencies()`;
- parser-limit error mapping to 413;
- first held import and second 429 response without second-body reads;
- valid authorized form preserving every existing and PR #6 response field.

Use this injected public factory:

```ts
const handler = createEpubPostHandler({
  runtimeConfig: () => ({ production: true, adminToken: "a".repeat(32) }),
  policy: SMALL_POLICY,
  importDependencies: () => {
    dependencyCalls++
    throw new Error("must not initialize")
  },
})
```

- [ ] **Step 2: Run route tests to verify RED**

Run:

```powershell
node --import tsx --test tests/epub-route.test.ts
```

Expected: FAIL because `createEpubPostHandler` is not exported and the current
`POST` reads multipart before authentication.

- [ ] **Step 3: Implement exact route composition**

Export Node runtime explicitly and create a handler factory:

```ts
export const runtime = "nodejs"
export const maxDuration = 120

interface EpubPostHandlerDependencies {
  runtimeConfig: () => { production: boolean; adminToken?: string }
  policy: EpubIngestPolicy
  gate: IngestConcurrencyGate
  parseMultipart: (body: Uint8Array, request: Request) => Promise<FormData>
  readFileBytes: (file: File) => Promise<Buffer>
  validateArchive: typeof validateEpubArchive
  importCorpus: typeof importCorpusEpub
  importDependencies: () => CorpusImportDependencies
}

export function createEpubPostHandler(
  overrides: Partial<EpubPostHandlerDependencies> = {},
): (request: Request) => Promise<Response>
```

The production defaults for `parseMultipart`, `readFileBytes`, and
`validateArchive` use native `Request.formData()`, `File.arrayBuffer()`, and the
real archive guard. Tests inject spies so rejection-before-copy/parser/Firebase
is directly observable.

The handler must execute in this order: authorize; validate multipart type;
validate declared size; acquire slot; bounded stream read; reconstruct a native
`Request` and call `.formData()`; validate `File`; validate `File.size`; copy
exact file bytes; `validateEpubArchive`; call canonical import; map response;
release in `finally`.

Create Firebase repository/blob adapters only inside the final import call.
Catch `EpubIngestGuardError`, `EpubParseLimitError`, and `CorpusImportError`
before the generic 500. Add `WWW-Authenticate` and `Retry-After` only on their
specified responses.

The production export uses:

```ts
export const POST = createEpubPostHandler({
  runtimeConfig: () => ({
    production: process.env.NODE_ENV === "production",
    adminToken: process.env.EPUB_INGEST_ADMIN_TOKEN,
  }),
})
```

- [ ] **Step 4: Verify route GREEN and no-regression suites**

Run:

```powershell
node --import tsx --test tests/epub-route.test.ts tests/epub-ingest-guard.test.ts tests/corpus-import.test.ts
```

Expected: route rejection order and successful fake response pass; canonical
import behavior remains green.

- [ ] **Step 5: Commit**

```powershell
git add -- src/app/api/epub/route.ts tests/epub-route.test.ts
git diff --cached --check
git commit -m "feat: secure the EPUB upload route"
```

### Task 6: Document Operations and Compatibility

**Files:**
- Modify: `README.md`
- Modify: `docs/source/implementation/epub-ingest-normalization.md`

- [ ] **Step 1: Document the server-only configuration**

Add this README environment entry without a sample secret:

```bash
# Server-only administrator credential for POST /api/epub.
# Use at least 32 random bytes. Never expose this through NEXT_PUBLIC_*.
EPUB_INGEST_ADMIN_TOKEN=
```

Document an authorized request using a shell variable rather than embedding a
secret in command history:

```powershell
$headers = @{ Authorization = "Bearer $env:EPUB_INGEST_ADMIN_TOKEN" }
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/epub -Headers $headers -Form @{ file = Get-Item .\book.epub }
```

State explicitly that production fails closed, local development without a
configured token is a non-deployable convenience, and the current browser
uploader does not embed the server secret.

- [ ] **Step 2: Document the security pipeline and residual controls**

In the ingest implementation guide, record the exact default limits, stable
error codes, patched ZIP version, unchanged SHA-256 bytes, and the remaining
need for HTTPS, host-level raw request/rate limits, slow-client protection, and
an authenticated researcher session/UI.

- [ ] **Step 3: Verify docs and commit**

Run:

```powershell
rg -n "EPUB_INGEST_ADMIN_TOKEN|51 MiB|adm-zip@0.6.0|host-level" README.md docs/source/implementation/epub-ingest-normalization.md
git diff --check
```

Then:

```powershell
git add -- README.md docs/source/implementation/epub-ingest-normalization.md
git diff --cached --check
git commit -m "docs: describe secure EPUB ingest"
```

### Task 7: Review, Verify, Clean, and Publish

**Files:**
- Review every file changed from `cda753e` through `HEAD`.

- [ ] **Step 1: Run focused security invariants**

```powershell
node --import tsx --test tests/epub-ingest-guard.test.ts tests/epub-route.test.ts tests/epub-parser-limits.test.ts tests/epub-corpus-coordinates.test.ts tests/corpus-import.test.ts tests/firestore-corpus-import-store.test.ts
npm ls epub2 adm-zip
```

Expected: all focused tests pass and only `adm-zip@0.6.0` is resolved.

- [ ] **Step 2: Request independent spec, correctness, and security reviews**

Give reviewers the design, this plan, base SHA `cda753e`, and current `HEAD`.
Fix every Critical or Important finding with a failing regression test and a
separate focused commit. Re-run the affected focused suite after each fix.

- [ ] **Step 3: Run the complete fresh gate**

```powershell
npm ci
npm test
npm run typecheck
npm run lint
npm run build
$auditJson = npm audit --json
$audit = ($auditJson -join "`n") | ConvertFrom-Json
if ($audit.vulnerabilities.'adm-zip' -or $audit.vulnerabilities.epub2) { exit 1 }
git diff --check cda753e...HEAD
git status --short
```

Expected: install, 149 baseline plus new tests, typecheck, lint, and build exit
zero. The raw audit command may exit 1 for explicitly reported unrelated
advisories, but the follow-up assertion confirms it no longer reports
`adm-zip`/`epub2`. Diff check is clean and only intentional tracked
source/test/doc changes exist.

- [ ] **Step 4: Remove or confirm exclusion of temporary artifacts**

Inspect for generated EPUBs, logs, coverage, debug files, `.next`, test-results,
and temporary probes. Delete only task-owned temporary artifacts after exact
path verification. Keep permanent synthetic tests and their in-memory builder.
Confirm ignored build outputs are absent from the PR.

- [ ] **Step 5: Push and create the PR**

Before publishing, re-check PR #6. If it has merged, fetch `origin/main` and,
while this branch is still unpublished, replay only the commits after
`cda753e` onto the resulting `main`. Re-run the complete gate on that exact
history. If PR #6 remains open, push this branch but stop before PR creation and
report the dependency: do not open a non-`main` PR and do not present its 26
unrelated commits in a `main` review diff.

```powershell
git push -u origin codex/secure-epub-ingest
```

Once the branch cleanly targets `main`, create a ready PR summarizing
authentication semantics, exact budgets, audit change, tests,
local-development compatibility, and remaining deployment controls. Wait for
GitHub Actions and preview checks; inspect and fix any failure before reporting
completion.
