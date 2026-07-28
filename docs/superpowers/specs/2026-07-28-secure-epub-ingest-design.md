# Secure EPUB Ingest Boundary Design

**Date:** 2026-07-28
**Scope:** Study-1-independent P0 hardening for `POST /api/epub`
**Base:** `codex/stable-corpus-identity@cda753e` (PR #6, still open)

## Context

The canonical corpus import added by PR #6 is deterministic and retry-safe, but
the HTTP boundary is still public. The route calls `request.formData()` before
any caller check or request-size limit, then materializes the complete file and
passes it to `epub2`. The installed `epub2@3.0.2` resolves
`adm-zip@0.5.17`, which is affected by CVE-2026-39244: a crafted ZIP header can
cause a multi-gigabyte allocation before useful validation.

The repository has no caller authentication, session library, Firebase Auth
login, middleware/proxy, distributed rate limiter, or admin-route convention.
Firebase Admin credentials authenticate the server to Firebase and must never
be reused as caller credentials.

This slice creates a narrow, auditable boundary for EPUB ingestion without
inventing participant identity or coupling the later participant/session model
to a temporary research-administration mechanism.

## Goals

- In production, require a server-only administrator bearer token before any
  request-body byte is consumed or Firebase adapter is initialized.
- Bound both declared and actually streamed multipart request bytes.
- Bound the extracted `File` bytes before copying them into another buffer.
- Reject malformed or resource-exhausting ZIP/EPUB containers before invoking
  `epub2` or any persistence method.
- Bound parser work and normalized chapter/paragraph output.
- Limit concurrent imports within one application process.
- Upgrade the vulnerable transitive ZIP reader to the patched
  `adm-zip@0.6.0` while retaining full synthetic-EPUB compatibility.
- Preserve the canonical content bytes and every request/response field from
  PR #6. Security checks must never rewrite the bytes used for SHA-256 identity.
- Keep all verification credential-free and based on synthetic in-memory data.

## Non-goals

- Participant/session ownership, participant login, or the final Study 2
  authentication model.
- A researcher login page or persistence of an administrator secret in the
  browser.
- Protecting every existing mutation route in the repository.
- A distributed rate limiter, WAF, reverse-proxy configuration, or slow-client
  protection. These remain deployment controls.
- Replacing `epub2`, changing EPUB normalization, or migrating stored corpora.
- Upgrading unrelated Firebase, Next.js, or OpenRouter dependencies.

## Approaches Considered

### 1. Route-local server bearer token plus layered resource guards

This is selected. A narrow server module verifies a shared administrator token,
reads the request through a byte-counting stream, validates ZIP metadata with a
patched reader, and exposes typed public errors. The route owns composition and
the parser retains domain-level chapter/paragraph limits.

This approach is small, can be proven without credentials, and checks access in
the Route Handler itself rather than trusting UI hiding or Proxy behavior. Its
trade-off is that production browser upload needs a future authenticated admin
client or a trusted deployment proxy that supplies the header.

### 2. Firebase ID token plus an administrator custom claim

This is stronger for named administrators, but the repository has no Firebase
Auth initialization, login flow, session ownership, or claim-management path.
Adding all of those would conflate this slice with the later participant/session
P0 and could prematurely determine the study identity model.

### 3. Deployment-proxy protection only

Vercel protection or a reverse proxy can enforce authentication, global rate
limits, and raw request limits, but those controls are not present in the
repository and are difficult to verify in credential-free CI. They remain a
required second layer, not the only application guard.

## Authentication Contract

The server reads `EPUB_INGEST_ADMIN_TOKEN`; it is never exposed through a
`NEXT_PUBLIC_*` variable, response, log, query string, or form field.

- In `NODE_ENV=production`, a missing token returns
  `503 ingest_not_configured` before reading the body.
- A configured token must contain at least 32 UTF-8 bytes. A present token that
  is shorter than this returns `503 ingest_not_configured` in every environment.
- When configured, callers must send `Authorization: Bearer <token>`.
- Missing or mismatching credentials return `401 unauthorized` with a generic
  body and `WWW-Authenticate: Bearer`.
- Token comparison hashes both values and uses constant-time comparison.
- In non-production only, an absent token keeps the current local workbench
  upload flow available. Setting the token in development enables the same
  authentication check as production.

The local bypass is an explicit developer convenience, not a deployable auth
mode. `next start` runs in production mode and therefore fails closed.

## Resource Policy

All values are exported operational defaults so tests and future deployment
configuration can refer to the exact contract.

| Resource | Limit |
| --- | ---: |
| Multipart request bytes | 51 MiB |
| EPUB file bytes | 50 MiB |
| ZIP entries | 5,000 |
| One declared uncompressed entry | 16 MiB |
| Total declared uncompressed ZIP bytes | 256 MiB |
| Per-entry compression ratio | 100:1 |
| Spine items | 1,000 |
| Final normalized chapters | 1,500 |
| Paragraphs per source item | 10,000 |
| Total normalized paragraphs | 100,000 |
| One normalized paragraph | 1 MiB UTF-8 |
| Total normalized text | 64 MiB UTF-8 |
| Concurrent imports per process | 1 |

The order is security-significant:

1. Verify the caller.
2. Reject an oversized valid `Content-Length` without touching the body.
3. Acquire the per-process import slot.
4. Read the request stream while enforcing the actual 51 MiB ceiling.
5. Parse multipart from the bounded byte buffer.
6. Validate `File.size`, then copy the exact file bytes once.
7. Inspect the ZIP/EPUB container before deriving identity or creating Firebase
   adapters.
8. Invoke canonical import with a parser wrapper that enforces final output
   limits.
9. Release the import slot in `finally` on every outcome.

The `Content-Length` header is an optimization, never the authoritative check.
Chunked or dishonest requests are still bounded by the stream reader.

## EPUB Container Validation

`adm-zip@0.6.0` is added as a pinned direct dependency and forced for
`epub2` through an npm override. Version 0.6.0 is the patched boundary stated by
the reviewed CVE advisory.

Preflight validation checks:

- ZIP signatures and parsability;
- entry count, declared compressed/uncompressed sizes, aggregate size, and
  compression ratio before reading entry contents;
- no encrypted entries or unsafe names. Names containing NUL or `\\` are
  rejected rather than normalized. Names beginning with `/`, `//`, or a Windows
  drive prefix are rejected. `/`-separated empty, `.`, and `..` segments are
  rejected, except for one final empty segment on a directory entry. The
  case-sensitive duplicate key is the remaining segments joined with `/`, with
  the directory's final slash removed so a file/directory alias also conflicts;
- exactly one root `mimetype` entry using STORE with declared compressed and
  uncompressed sizes of exactly 20 bytes, followed by a byte-exact ASCII
  comparison with `application/epub+zip`;
- exactly one `META-INF/container.xml` entry;
- only stored or deflate compression methods.

Container failures are stable public errors and do not expose filenames,
archive paths, parser messages, credentials, or stack traces.

## Parser Limits

The archive preflight protects the vulnerable boundary before `epub2` opens the
file. `parseEpub` additionally rejects excessive spine count, paragraphs per
source item, single-paragraph UTF-8 bytes, final chapter count, final paragraph
count, and total normalized text bytes. A typed parser-limit error is never
swallowed by the existing per-spine unreadable-item fallback.

These checks apply to every `parseEpub` caller, not only the HTTP route, so an
internal caller cannot accidentally bypass the parser work budget.

## Concurrency Contract

A process-local single-slot gate rejects an additional authenticated import
with `429 ingest_busy` and `Retry-After: 5` before reading its body. This bounds
simultaneous large buffers and parser work inside one Node process. It is not
described as a distributed rate limiter; production still requires host-level
rate limiting and slow-request protection.

## Error Contract

| Status | Code | Meaning |
| ---: | --- | --- |
| 400 | `malformed_multipart` | Bounded body is not valid multipart data |
| 400 | `missing_file` | `file` is absent or not a `File` |
| 401 | `unauthorized` | Bearer credential missing or mismatched |
| 413 | `request_too_large` | Declared or streamed multipart limit exceeded |
| 413 | `epub_too_large` | Extracted file limit exceeded |
| 413 | `epub_resource_limit` | ZIP or parsed-content budget exceeded |
| 415 | `invalid_content_type` | Request is not multipart form data |
| 422 | `invalid_epub` | ZIP/EPUB structure is invalid or unsupported |
| 429 | `ingest_busy` | This process is already importing an EPUB |
| 503 | `ingest_not_configured` | Production administrator token is unusable |

Existing `CorpusImportError` status/code pairs remain unchanged. Unknown errors
continue returning a fixed generic 500 response.

## API and Compatibility

The form contract remains `file`, `title`, `source`, and optional `bookId`.
Successful responses retain `docId`, `chapters`, `sourceFile`, `bookId`,
`corpusRevisionId`, and `reused`.

No Firestore, Storage, or corpus schema changes are introduced. Validated bytes
are passed unchanged to `importCorpusEpub`; therefore stable revision and
paragraph IDs remain identical to PR #6.

The existing client uploader remains usable in local development without a
configured token. Production intentionally does not offer an embedded shared
secret. A later admin-session ticket or trusted deployment proxy must provide
the bearer header before production researcher uploads are enabled.

## Test Strategy

Tests must demonstrate the rejection order, not only response codes:

- missing production configuration, missing bearer, and wrong bearer consume
  zero request-body chunks and initialize no Firebase adapter;
- oversized declared and chunked bodies stop before multipart parsing;
- oversized `File` stops before `arrayBuffer`, ZIP parsing, canonical import,
  repository, or blob calls;
- invalid signature, missing/duplicate required entries, unsafe paths,
  encryption, entry-count, entry-size, aggregate-size, and ratio violations are
  rejected with stable public codes;
- a held import slot causes a second request to return 429 without body reads;
- for a new or incomplete revision, spine/chapter/paragraph/text limits fail
  before an import claim or any persistence write. The coordinator may read
  revision metadata first so a complete byte-identical reimport can retain its
  parser short-circuit;
- `epub2@3.0.2` parses the existing synthetic fixture with overridden
  `adm-zip@0.6.0`;
- valid synthetic import, deterministic reuse, provenance, merge/split, and
  canonical Firestore-size tests remain unchanged and green.

The final gate is `npm test`, `npm run typecheck`, `npm run lint`,
`npm run build`, `npm audit --json`, and `git diff --check` without Firebase,
LLM credentials, commercial EPUBs, or participant data.

## Branch and Rollout

This branch must stack on PR #6 because `main` does not yet contain the canonical
coordinator or route. If PR #6 merges before completion, the final PR can target
`main` cleanly. Otherwise the PR dependency must be explicit and the base should
be retargeted to `main` only after PR #6 merges; duplicating its 26 commits in a
review diff is not acceptable.

No deployment is performed. Production must not expose the route until the
admin token, HTTPS, host-level request/rate limits, and protected researcher UI
delivery are configured.
