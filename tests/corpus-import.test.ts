import assert from "node:assert/strict"
import test from "node:test"
import { deriveCorpusIdentity } from "../src/lib/corpus-identity.ts"
import {
  CORPUS_CLAIM_LEASE_MS,
  CorpusImportError,
  importCorpusEpub,
  workspaceCorpusRevisionId,
  type ClaimRevisionInput,
  type ClaimRevisionResult,
  type CompleteRevisionInput,
  type CorpusBlobStore,
  type CorpusEpubParser,
  type CorpusImportDependencies,
  type CorpusImportInput,
  type CorpusImportRepository,
  type CorpusRevisionRecord,
  type EnsureWorkspaceInput,
  type FailRevisionInput,
  type PutCorpusBlobInput,
} from "../src/lib/corpus-import.ts"
import { parseEpub } from "../src/lib/epub.ts"
import type { StoredSourceFile } from "../src/lib/storage.ts"
import type { RawChapter } from "../src/types/schema.ts"
import { buildSyntheticEpub } from "./helpers/synthetic-epub.ts"

const NOW = new Date("2026-07-27T00:00:00.000Z")

function cloneChapters(chapters: RawChapter[]): RawChapter[] {
  return structuredClone(chapters)
}

function makeStoredSourceFile(input: PutCorpusBlobInput): StoredSourceFile {
  const storagePath = `corpus_revisions/${input.corpusRevisionId}/source.epub`
  return {
    bucket: "fake-corpus-bucket",
    storagePath,
    gsUri: `gs://fake-corpus-bucket/${storagePath}`,
    fileName: input.fileName,
    contentType: input.contentType,
    sizeBytes: input.buffer.byteLength,
  }
}

class FakeCorpusBlobStore implements CorpusBlobStore {
  readonly objects = new Map<string, StoredSourceFile>()
  putCalls = 0
  writeCount = 0

  private pauseEnteredResolve?: () => void
  private pauseEntered?: Promise<void>
  private releasePause?: () => void
  private pausedPut?: Promise<void>

  pauseNextPut(): void {
    this.pauseEntered = new Promise<void>((resolve) => {
      this.pauseEnteredResolve = resolve
    })
    this.pausedPut = new Promise<void>((resolve) => {
      this.releasePause = resolve
    })
  }

  async waitUntilPutPaused(): Promise<void> {
    assert.ok(this.pauseEntered, "pauseNextPut must be called first")
    await this.pauseEntered
  }

  resumePut(): void {
    assert.ok(this.releasePause, "pauseNextPut must be called first")
    this.releasePause()
    this.pauseEntered = undefined
    this.pauseEnteredResolve = undefined
    this.pausedPut = undefined
    this.releasePause = undefined
  }

  async putIfAbsent(input: PutCorpusBlobInput): Promise<StoredSourceFile> {
    this.putCalls += 1

    if (this.pausedPut) {
      const pause = this.pausedPut
      this.pauseEnteredResolve?.()
      await pause
    }

    const sourceFile = makeStoredSourceFile(input)
    const existing = this.objects.get(sourceFile.storagePath)
    if (existing) return existing

    this.objects.set(sourceFile.storagePath, sourceFile)
    this.writeCount += 1
    return sourceFile
  }
}

interface WorkspaceRecord extends EnsureWorkspaceInput {}

class FakeCorpusImportRepository implements CorpusImportRepository {
  readonly books = new Set<string>()
  readonly revisions = new Map<string, CorpusRevisionRecord>()
  readonly chapters = new Map<string, Map<string, RawChapter>>()
  readonly workspaces = new Map<string, WorkspaceRecord>()
  readonly savedChapterSnapshots: RawChapter[][] = []

  getRevisionCalls = 0
  claimCalls = 0
  saveChapterCalls = 0
  completeCalls = 0
  failCalls = 0
  listChapterCalls = 0
  workspaceCalls = 0
  lastClaimInput?: ClaimRevisionInput

  completeFailures: unknown[] = []
  workspaceFailures: unknown[] = []
  completeOnNextClaim?: {
    record: CorpusRevisionRecord
    chapters: RawChapter[]
  }

  async getRevision(revisionId: string): Promise<CorpusRevisionRecord | null> {
    this.getRevisionCalls += 1
    return this.revisions.get(revisionId) ?? null
  }

  async claimRevision(input: ClaimRevisionInput): Promise<ClaimRevisionResult> {
    this.claimCalls += 1
    this.lastClaimInput = input

    if (this.completeOnNextClaim) {
      const completed = this.completeOnNextClaim
      this.completeOnNextClaim = undefined
      this.revisions.set(input.corpusRevisionId, completed.record)
      this.chapters.set(
        input.corpusRevisionId,
        new Map(completed.chapters.map((chapter) => [chapter.chapter_id, structuredClone(chapter)])),
      )
      return { outcome: "complete" }
    }

    const existing = this.revisions.get(input.corpusRevisionId)
    if (existing?.bookId !== undefined && existing.bookId !== input.bookId) {
      throw new CorpusImportError(
        "corpus revision belongs to another book",
        409,
        "book_conflict",
      )
    }
    if (existing?.status === "complete") return { outcome: "complete" }
    if (
      existing?.status === "pending" &&
      existing.claimExpiresAtMs !== undefined &&
      existing.claimExpiresAtMs > input.nowMs
    ) {
      return { outcome: "in_progress" }
    }

    this.books.add(input.bookId)
    this.revisions.set(input.corpusRevisionId, {
      corpusRevisionId: input.corpusRevisionId,
      sourceSha256: input.sourceSha256,
      bookId: input.bookId,
      status: "pending",
      claimToken: input.claimToken,
      claimExpiresAtMs: input.claimExpiresAtMs,
    })
    return { outcome: "claimed" }
  }

  async saveChapters(
    revisionId: string,
    claimToken: string,
    chapters: RawChapter[],
  ): Promise<void> {
    this.saveChapterCalls += 1
    const revision = this.revisions.get(revisionId)
    if (revision?.claimToken !== claimToken) throw new Error("claim lost while saving chapters")

    const snapshot = cloneChapters(chapters)
    this.savedChapterSnapshots.push(snapshot)
    this.chapters.set(
      revisionId,
      new Map(snapshot.map((chapter) => [chapter.chapter_id, structuredClone(chapter)])),
    )
  }

  async completeRevision(input: CompleteRevisionInput): Promise<void> {
    this.completeCalls += 1
    const failure = this.completeFailures.shift()
    if (failure !== undefined) throw failure

    const revision = this.revisions.get(input.corpusRevisionId)
    if (revision?.claimToken !== input.claimToken) throw new Error("claim lost while completing")
    this.revisions.set(input.corpusRevisionId, {
      corpusRevisionId: input.corpusRevisionId,
      sourceSha256: input.sourceSha256,
      bookId: input.bookId,
      status: "complete",
      sourceFile: input.sourceFile,
      chapterIds: [...input.chapterIds],
    })
  }

  async failRevision(input: FailRevisionInput): Promise<void> {
    this.failCalls += 1
    const revision = this.revisions.get(input.corpusRevisionId)
    if (revision?.claimToken !== input.claimToken) throw new Error("claim lost while failing")
    assert.ok(revision)
    this.revisions.set(input.corpusRevisionId, {
      ...revision,
      status: "failed",
      failedStep: input.failedStep,
      failureMessage: input.message,
    })
  }

  async listChapters(revisionId: string): Promise<RawChapter[]> {
    this.listChapterCalls += 1
    const revision = this.revisions.get(revisionId)
    if (revision?.status !== "complete") return []

    const byId = this.chapters.get(revisionId) ?? new Map<string, RawChapter>()
    return (revision.chapterIds ?? []).map((chapterId) => {
      const chapter = byId.get(chapterId)
      assert.ok(chapter, `missing chapter ${chapterId}`)
      return structuredClone(chapter)
    })
  }

  async ensureWorkspace(input: EnsureWorkspaceInput): Promise<void> {
    this.workspaceCalls += 1
    const failure = this.workspaceFailures.shift()
    if (failure !== undefined) throw failure
    this.workspaces.set(`${input.source}:${input.corpusRevisionId}`, structuredClone(input))
  }
}

function fakeParser(): CorpusEpubParser {
  return async (buffer, context) => {
    const text = `synthetic-${buffer.toString("hex")}`
    return [{
      doc_id: context.docId,
      book_id: context.bookId,
      corpus_revision_id: context.corpusRevisionId,
      chapter_id: "ch01",
      title: "Synthetic chapter",
      source: { type: "spine", hrefs: ["Text/chapter.xhtml"] },
      text,
      paragraphs: [{ pid: 0, start: 0, end: text.length, text }],
    }]
  }
}

function makeInput(
  buffer: Buffer,
  overrides: Partial<Omit<CorpusImportInput, "buffer">> = {},
): CorpusImportInput {
  return {
    buffer,
    fileName: "novel.epub",
    contentType: "application/epub+zip",
    title: "Synthetic novel",
    source: "current",
    ...overrides,
  }
}

function makeDependencies(
  repository: FakeCorpusImportRepository,
  blobStore: FakeCorpusBlobStore,
  parser: CorpusEpubParser = fakeParser(),
): { dependencies: CorpusImportDependencies; state: { parserCalls: number; tokenCalls: number } } {
  const state = { parserCalls: 0, tokenCalls: 0 }
  const dependencies: CorpusImportDependencies = {
    repository,
    blobStore,
    parseEpub: async (buffer, context) => {
      state.parserCalls += 1
      return parser(buffer, context)
    },
    now: () => new Date(NOW),
    createClaimToken: () => {
      state.tokenCalls += 1
      return `claim-${state.tokenCalls}`
    },
  }
  return { dependencies, state }
}

test("initial real EPUB import persists one canonical revision and a renamed byte-identical retry reuses it", async () => {
  const buffer = await buildSyntheticEpub()
  const copiedBuffer = Buffer.from(buffer)
  const repository = new FakeCorpusImportRepository()
  const blobStore = new FakeCorpusBlobStore()
  const { dependencies, state } = makeDependencies(repository, blobStore, parseEpub)

  const first = await importCorpusEpub(makeInput(buffer), dependencies)
  const second = await importCorpusEpub(
    makeInput(copiedBuffer, { fileName: "renamed-byte-copy.epub" }),
    dependencies,
  )

  assert.equal(first.reused, false)
  assert.equal(second.reused, true)
  assert.equal(first.corpusRevisionId, second.corpusRevisionId)
  assert.equal(first.docId, first.corpusRevisionId)
  assert.equal(first.bookId, second.bookId)
  assert.deepEqual(second.chapters, first.chapters)
  assert.ok(first.chapters.length >= 2)
  assert.equal(second.sourceFile.fileName, "novel.epub")
  assert.equal(repository.books.size, 1)
  assert.equal(repository.revisions.size, 1)
  assert.equal(repository.chapters.size, 1)
  assert.equal(repository.workspaces.size, 1)
  assert.equal(blobStore.objects.size, 1)
  assert.equal(blobStore.putCalls, 1)
  assert.equal(blobStore.writeCount, 1)
  assert.equal(repository.saveChapterCalls, 1)
  assert.equal(repository.completeCalls, 1)
  assert.equal(state.parserCalls, 1)
})

test("an omitted book ID keeps the stored explicit book association", async () => {
  const buffer = Buffer.from("same explicit-book revision")
  const repository = new FakeCorpusImportRepository()
  const blobStore = new FakeCorpusBlobStore()
  const { dependencies, state } = makeDependencies(repository, blobStore)

  const first = await importCorpusEpub(makeInput(buffer, { bookId: "book-curated-7" }), dependencies)
  const retry = await importCorpusEpub(makeInput(Buffer.from(buffer)), dependencies)

  assert.equal(first.bookId, "book-curated-7")
  assert.equal(retry.bookId, "book-curated-7")
  assert.equal(repository.revisions.get(first.corpusRevisionId)?.bookId, "book-curated-7")
  assert.equal(repository.books.size, 1)
  assert.equal(state.parserCalls, 1)
  assert.equal(blobStore.putCalls, 1)
  assert.equal(repository.saveChapterCalls, 1)
})

test("changed bytes join an explicit book but use a separate deterministic book when omitted", async () => {
  const firstBuffer = Buffer.from("edition one")
  const linkedBuffer = Buffer.from("edition two linked")
  const separateBuffer = Buffer.from("edition three separate")
  const repository = new FakeCorpusImportRepository()
  const blobStore = new FakeCorpusBlobStore()
  const { dependencies } = makeDependencies(repository, blobStore)

  const first = await importCorpusEpub(makeInput(firstBuffer, { bookId: "series-book" }), dependencies)
  const linked = await importCorpusEpub(
    makeInput(linkedBuffer, { bookId: first.bookId }),
    dependencies,
  )
  const separate = await importCorpusEpub(makeInput(separateBuffer), dependencies)

  assert.notEqual(linked.corpusRevisionId, first.corpusRevisionId)
  assert.equal(linked.bookId, first.bookId)
  assert.notEqual(separate.corpusRevisionId, first.corpusRevisionId)
  assert.notEqual(separate.bookId, first.bookId)
  assert.equal(separate.bookId, deriveCorpusIdentity(separateBuffer).bookId)
  assert.equal(repository.revisions.size, 3)
  assert.equal(repository.books.size, 2)
  assert.equal(blobStore.objects.size, 3)
})

test("a known revision rejects a conflicting explicit book ID without parsing or writing", async () => {
  const buffer = Buffer.from("known revision")
  const repository = new FakeCorpusImportRepository()
  const blobStore = new FakeCorpusBlobStore()
  const { dependencies, state } = makeDependencies(repository, blobStore)
  await importCorpusEpub(makeInput(buffer, { bookId: "book-one" }), dependencies)

  await assert.rejects(
    importCorpusEpub(makeInput(Buffer.from(buffer), { bookId: "book-two" }), dependencies),
    (error: unknown) => {
      assert.ok(error instanceof CorpusImportError)
      assert.equal(error.statusCode, 409)
      assert.equal(error.code, "book_conflict")
      return true
    },
  )

  assert.equal(state.parserCalls, 1)
  assert.equal(blobStore.putCalls, 1)
  assert.equal(repository.saveChapterCalls, 1)
  assert.equal(repository.completeCalls, 1)
  assert.equal(repository.revisions.get(deriveCorpusIdentity(buffer).corpusRevisionId)?.bookId, "book-one")
})

test("an invalid book ID performs no repository, parser, or blob work", async () => {
  const repository = new FakeCorpusImportRepository()
  const blobStore = new FakeCorpusBlobStore()
  const { dependencies, state } = makeDependencies(repository, blobStore)

  await assert.rejects(
    importCorpusEpub(makeInput(Buffer.from("bytes"), { bookId: "invalid/book" }), dependencies),
    (error: unknown) => {
      assert.ok(error instanceof CorpusImportError)
      assert.equal(error.statusCode, 400)
      assert.equal(error.code, "invalid_book_id")
      return true
    },
  )

  assert.equal(repository.getRevisionCalls, 0)
  assert.equal(repository.claimCalls, 0)
  assert.equal(repository.revisions.size, 0)
  assert.equal(state.parserCalls, 0)
  assert.equal(blobStore.putCalls, 0)
  assert.equal(blobStore.objects.size, 0)
})

test("an invalid EPUB fails in the real parser before any claim or persistence write", async () => {
  const repository = new FakeCorpusImportRepository()
  const blobStore = new FakeCorpusBlobStore()
  const { dependencies, state } = makeDependencies(repository, blobStore, parseEpub)

  await assert.rejects(importCorpusEpub(makeInput(Buffer.from("not an epub")), dependencies))

  assert.equal(repository.getRevisionCalls, 1)
  assert.equal(repository.claimCalls, 0)
  assert.equal(repository.saveChapterCalls, 0)
  assert.equal(repository.completeCalls, 0)
  assert.equal(repository.failCalls, 0)
  assert.equal(repository.revisions.size, 0)
  assert.equal(state.parserCalls, 1)
  assert.equal(blobStore.putCalls, 0)
  assert.equal(blobStore.objects.size, 0)
})

test("an active five-minute claim returns an import-in-progress conflict without a second writer", async () => {
  const buffer = Buffer.from("actively claimed revision")
  const identity = deriveCorpusIdentity(buffer)
  const repository = new FakeCorpusImportRepository()
  repository.revisions.set(identity.corpusRevisionId, {
    ...identity,
    status: "pending",
    claimToken: "other-writer",
    claimExpiresAtMs: NOW.getTime() + CORPUS_CLAIM_LEASE_MS,
  })
  const blobStore = new FakeCorpusBlobStore()
  const { dependencies, state } = makeDependencies(repository, blobStore)

  await assert.rejects(importCorpusEpub(makeInput(buffer), dependencies), (error: unknown) => {
    assert.ok(error instanceof CorpusImportError)
    assert.equal(error.statusCode, 409)
    assert.equal(error.code, "import_in_progress")
    return true
  })

  assert.equal(CORPUS_CLAIM_LEASE_MS, 5 * 60 * 1000)
  assert.equal(repository.claimCalls, 1)
  assert.equal(state.parserCalls, 1)
  assert.equal(blobStore.putCalls, 0)
  assert.equal(repository.saveChapterCalls, 0)
  assert.equal(repository.revisions.get(identity.corpusRevisionId)?.claimToken, "other-writer")
})

test("concurrent identical imports allow only the active claimant to write", async () => {
  const buffer = Buffer.from("concurrent revision")
  const repository = new FakeCorpusImportRepository()
  const blobStore = new FakeCorpusBlobStore()
  blobStore.pauseNextPut()
  const { dependencies } = makeDependencies(repository, blobStore)

  const firstImport = importCorpusEpub(makeInput(buffer), dependencies)
  await blobStore.waitUntilPutPaused()
  const secondImport = importCorpusEpub(
    makeInput(Buffer.from(buffer), { fileName: "concurrent-copy.epub" }),
    dependencies,
  )

  await assert.rejects(secondImport, (error: unknown) => {
    assert.ok(error instanceof CorpusImportError)
    assert.equal(error.code, "import_in_progress")
    return true
  })
  blobStore.resumePut()
  const completed = await firstImport

  assert.equal(completed.reused, false)
  assert.equal(repository.claimCalls, 2)
  assert.equal(repository.revisions.size, 1)
  assert.equal(repository.revisions.get(completed.corpusRevisionId)?.status, "complete")
  assert.equal(blobStore.writeCount, 1)
  assert.equal(repository.saveChapterCalls, 1)
  assert.equal(repository.completeCalls, 1)
})

test("a claim race that reports complete returns the stored manifest without blob or chapter writes", async () => {
  const buffer = Buffer.from("completed during claim race")
  const identity = deriveCorpusIdentity(buffer, "race-book")
  const sourceFile = makeStoredSourceFile({
    ...identity,
    buffer,
    fileName: "winner.epub",
    contentType: "application/epub+zip",
  })
  const storedChapters = await fakeParser()(buffer, {
    docId: identity.corpusRevisionId,
    bookId: identity.bookId,
    corpusRevisionId: identity.corpusRevisionId,
  })
  const repository = new FakeCorpusImportRepository()
  repository.completeOnNextClaim = {
    record: {
      ...identity,
      status: "complete",
      sourceFile,
      chapterIds: storedChapters.map((chapter) => chapter.chapter_id),
    },
    chapters: storedChapters,
  }
  const blobStore = new FakeCorpusBlobStore()
  const { dependencies, state } = makeDependencies(repository, blobStore)

  const result = await importCorpusEpub(makeInput(buffer, { bookId: identity.bookId }), dependencies)

  assert.equal(result.reused, true)
  assert.deepEqual(result.chapters, storedChapters)
  assert.deepEqual(result.sourceFile, sourceFile)
  assert.equal(state.parserCalls, 1)
  assert.equal(repository.claimCalls, 1)
  assert.equal(repository.listChapterCalls, 1)
  assert.equal(blobStore.putCalls, 0)
  assert.equal(repository.saveChapterCalls, 0)
  assert.equal(repository.completeCalls, 0)
})

test("a completion failure marks the revision failed with a bounded diagnostic and retry reuses deterministic data", async () => {
  const buffer = Buffer.from("retryable complete failure")
  const identity = deriveCorpusIdentity(buffer)
  const repository = new FakeCorpusImportRepository()
  const longMessage = "failure-detail-".repeat(60)
  repository.completeFailures.push(new Error(longMessage))
  const blobStore = new FakeCorpusBlobStore()
  const { dependencies } = makeDependencies(repository, blobStore)

  await assert.rejects(importCorpusEpub(makeInput(buffer), dependencies), (error: unknown) => {
    assert.ok(error instanceof Error)
    assert.equal(error.message, longMessage)
    return true
  })

  const failed = repository.revisions.get(identity.corpusRevisionId)
  assert.equal(failed?.status, "failed")
  assert.equal(failed?.failedStep, "complete")
  assert.equal(failed?.failureMessage, longMessage.slice(0, 500))
  assert.equal(failed?.failureMessage?.length, 500)
  assert.equal(repository.failCalls, 1)
  assert.equal(blobStore.writeCount, 1)
  assert.equal(repository.saveChapterCalls, 1)

  const retried = await importCorpusEpub(makeInput(Buffer.from(buffer)), dependencies)

  assert.equal(retried.corpusRevisionId, identity.corpusRevisionId)
  assert.equal(retried.bookId, identity.bookId)
  assert.equal(repository.revisions.get(identity.corpusRevisionId)?.status, "complete")
  assert.equal(blobStore.putCalls, 2)
  assert.equal(blobStore.writeCount, 1)
  assert.equal(repository.saveChapterCalls, 2)
  assert.deepEqual(repository.savedChapterSnapshots[1], repository.savedChapterSnapshots[0])
  assert.equal(repository.completeCalls, 2)
  assert.equal(repository.failCalls, 1)
})

test("workspace failure after completion leaves the corpus complete and retry only repairs the workspace", async () => {
  const buffer = Buffer.from("workspace repair")
  const identity = deriveCorpusIdentity(buffer)
  const repository = new FakeCorpusImportRepository()
  repository.workspaceFailures.push(new Error("workspace unavailable"))
  const blobStore = new FakeCorpusBlobStore()
  const { dependencies, state } = makeDependencies(repository, blobStore)

  await assert.rejects(importCorpusEpub(makeInput(buffer), dependencies), /workspace unavailable/)

  assert.equal(repository.revisions.get(identity.corpusRevisionId)?.status, "complete")
  assert.equal(repository.failCalls, 0)
  assert.equal(repository.workspaces.size, 0)

  const repaired = await importCorpusEpub(makeInput(Buffer.from(buffer)), dependencies)

  assert.equal(repaired.reused, true)
  assert.equal(repository.revisions.get(identity.corpusRevisionId)?.status, "complete")
  assert.equal(repository.workspaces.size, 1)
  assert.equal(repository.workspaceCalls, 2)
  assert.equal(state.parserCalls, 1)
  assert.equal(blobStore.putCalls, 1)
  assert.equal(repository.saveChapterCalls, 1)
  assert.equal(repository.completeCalls, 1)
  assert.equal(repository.failCalls, 0)
})

test("claims use the exact five-minute lease and an expired claim is reclaimed", async () => {
  const buffer = Buffer.from("expired claim")
  const identity = deriveCorpusIdentity(buffer)
  const repository = new FakeCorpusImportRepository()
  repository.revisions.set(identity.corpusRevisionId, {
    ...identity,
    status: "pending",
    claimToken: "expired-writer",
    claimExpiresAtMs: NOW.getTime(),
  })
  const blobStore = new FakeCorpusBlobStore()
  const { dependencies } = makeDependencies(repository, blobStore)

  const result = await importCorpusEpub(makeInput(buffer), dependencies)

  assert.equal(result.reused, false)
  assert.equal(repository.lastClaimInput?.nowMs, NOW.getTime())
  assert.equal(
    (repository.lastClaimInput?.claimExpiresAtMs ?? 0) - (repository.lastClaimInput?.nowMs ?? 0),
    CORPUS_CLAIM_LEASE_MS,
  )
  assert.equal(repository.revisions.get(identity.corpusRevisionId)?.status, "complete")
})

test("workspaceCorpusRevisionId selects only a present string canonical marker", () => {
  const revisionId = "cr_v1_abc123"

  assert.equal(workspaceCorpusRevisionId({ corpusRevisionId: revisionId }), revisionId)
  assert.equal(workspaceCorpusRevisionId({}), null)
  assert.equal(workspaceCorpusRevisionId({ corpusRevisionId: "" }), null)
  assert.equal(workspaceCorpusRevisionId({ corpusRevisionId: 17 }), null)
  assert.equal(workspaceCorpusRevisionId(null), null)
})
