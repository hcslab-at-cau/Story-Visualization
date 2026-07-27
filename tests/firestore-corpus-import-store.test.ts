import assert from "node:assert/strict"
import test from "node:test"
import { Timestamp } from "firebase-admin/firestore"
import { deriveCorpusIdentity } from "../src/lib/corpus-identity.ts"
import { CorpusImportError } from "../src/lib/corpus-import.ts"
import {
  FirestoreCorpusImportRepository,
  isCanonicalRevisionComplete,
  loadCanonicalRawChapter,
} from "../src/lib/server/firestore-corpus-import-store.ts"

type StoredRecord = Record<string, unknown>

class FakeDocSnapshot {
  constructor(
    readonly path: string,
    private readonly value: StoredRecord | undefined,
  ) {}

  get exists(): boolean {
    return this.value !== undefined
  }

  data(): StoredRecord | undefined {
    return this.value === undefined ? undefined : cloneValue(this.value)
  }

  get(field: string): unknown {
    return this.value?.[field]
  }
}

class FakeFirestore {
  readonly docs = new Map<string, StoredRecord>()
  readonly reads = new Map<string, number>()
  private timestampCounter = 0

  collection(path: string): FakeCollectionRef {
    return new FakeCollectionRef(this, path)
  }

  async runTransaction<T>(
    operation: (transaction: FakeTransaction) => Promise<T>,
  ): Promise<T> {
    return operation(new FakeTransaction(this))
  }

  seed(path: string, value: StoredRecord): void {
    this.docs.set(path, cloneValue(value))
  }

  readCount(path: string): number {
    return this.reads.get(path) ?? 0
  }

  getSnapshot(path: string): FakeDocSnapshot {
    this.reads.set(path, (this.reads.get(path) ?? 0) + 1)
    return new FakeDocSnapshot(path, this.docs.get(path))
  }

  write(path: string, value: StoredRecord, options?: { merge?: boolean }): void {
    const normalized = this.normalizeValue(value) as StoredRecord
    if (!options?.merge) {
      this.docs.set(path, normalized)
      return
    }

    const existing = cloneValue(this.docs.get(path) ?? {})
    for (const [key, nextValue] of Object.entries(normalized)) {
      if (nextValue === undefined) delete existing[key]
      else existing[key] = nextValue
    }
    this.docs.set(path, existing)
  }

  private normalizeValue(value: unknown): unknown {
    if (value instanceof Timestamp) return value
    if (Array.isArray(value)) return value.map((item) => this.normalizeValue(item))
    if (value && typeof value === "object") {
      const ctorName = value.constructor?.name
      if (ctorName === "DeleteTransform") return undefined
      if (ctorName === "ServerTimestampTransform") {
        this.timestampCounter += 1
        return Timestamp.fromMillis(1_000 + this.timestampCounter)
      }
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => {
          const normalized = this.normalizeValue(nested)
          return normalized === undefined ? [] : [[key, normalized]]
        }),
      )
    }
    return value
  }
}

function cloneValue<T>(value: T): T {
  if (value instanceof Timestamp) return Timestamp.fromMillis(value.toMillis()) as T
  if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as T
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, cloneValue(nested)]),
    ) as T
  }
  return value
}

class FakeCollectionRef {
  constructor(
    private readonly db: FakeFirestore,
    private readonly path: string,
  ) {}

  doc(id: string): FakeDocRef {
    return new FakeDocRef(this.db, `${this.path}/${id}`)
  }
}

class FakeDocRef {
  constructor(
    private readonly db: FakeFirestore,
    readonly path: string,
  ) {}

  collection(name: string): FakeCollectionRef {
    return new FakeCollectionRef(this.db, `${this.path}/${name}`)
  }

  async get(): Promise<FakeDocSnapshot> {
    return this.db.getSnapshot(this.path)
  }

  set(value: StoredRecord, options?: { merge?: boolean }): void {
    this.db.write(this.path, value, options)
  }
}

class FakeTransaction {
  constructor(private readonly db: FakeFirestore) {}

  async get(ref: FakeDocRef): Promise<FakeDocSnapshot> {
    return ref.get()
  }

  set(ref: FakeDocRef, value: StoredRecord, options?: { merge?: boolean }): void {
    ref.set(value, options)
  }
}

function createRepository(fakeDb: FakeFirestore, onGetDb?: () => void) {
  return new FirestoreCorpusImportRepository({
    getDb() {
      onGetDb?.()
      return fakeDb as never
    },
  })
}

function revisionPath(corpusRevisionId: string): string {
  return `corpus_revisions/${corpusRevisionId}`
}

function chapterPath(corpusRevisionId: string, chapterId: string): string {
  return `${revisionPath(corpusRevisionId)}/chapters/${chapterId}`
}

function storedSourceFile(identity = deriveCorpusIdentity(Buffer.from("canonical source file"))): StoredRecord {
  return {
    bucket: "fake-bucket",
    storagePath: `corpus_revisions/${identity.corpusRevisionId}/source.epub`,
    gsUri: `gs://fake-bucket/corpus_revisions/${identity.corpusRevisionId}/source.epub`,
    fileName: "source.epub",
    contentType: "application/epub+zip",
    sizeBytes: 123,
  }
}

function completeRevisionDoc(identity: ReturnType<typeof deriveCorpusIdentity>, chapterIds = ["ch01"]): StoredRecord {
  return {
    schemaVersion: 1,
    ingestSchemaVersion: 1,
    bookId: identity.bookId,
    sourceSha256: identity.sourceSha256,
    status: "complete",
    sourceFile: storedSourceFile(identity),
    chapterIds,
    chapterCount: chapterIds.length,
    completedAt: Timestamp.fromMillis(1),
  }
}

function rawChapter(identity: ReturnType<typeof deriveCorpusIdentity>, chapterId = "ch01"): StoredRecord {
  return {
    doc_id: identity.corpusRevisionId,
    book_id: identity.bookId,
    corpus_revision_id: identity.corpusRevisionId,
    chapter_id: chapterId,
    title: "Chapter 1",
    text: "body",
    paragraphs: [validParagraph()],
  }
}

function validParagraph(): StoredRecord {
  return {
    pid: 0,
    start: 0,
    end: 4,
    text: "body",
    paragraph_id: `p_v1_${"a".repeat(64)}`,
    source_item_id: `si_v1_${"b".repeat(64)}`,
    source_paragraph_ordinal: 0,
    global_ordinal: 0,
  }
}

function pendingRevisionDoc(identity: ReturnType<typeof deriveCorpusIdentity>, claimToken: string): StoredRecord {
  return {
    schemaVersion: 1,
    ingestSchemaVersion: 1,
    bookId: identity.bookId,
    sourceSha256: identity.sourceSha256,
    status: "pending",
    claimToken,
    claimExpiresAt: Timestamp.fromMillis(10_000),
  }
}

test("FirestoreCorpusImportRepository does not initialize Firestore until a method runs", async () => {
  const identity = deriveCorpusIdentity(Buffer.from("canonical firestore fixture"))
  const fakeDb = new FakeFirestore()
  let getDbCalls = 0
  const repository = createRepository(fakeDb, () => {
    getDbCalls += 1
  })

  assert.equal(getDbCalls, 0)
  assert.equal(await repository.getRevision(identity.corpusRevisionId), null)
  assert.equal(getDbCalls, 1)
})

test("loadCanonicalRawChapter returns null for non-manifest chapter IDs without reading stale docs", async () => {
  const identity = deriveCorpusIdentity(Buffer.from("manifest authoritative read"))
  const fakeDb = new FakeFirestore()
  fakeDb.seed(revisionPath(identity.corpusRevisionId), completeRevisionDoc(identity, ["ch01"]))
  fakeDb.seed(chapterPath(identity.corpusRevisionId, "ch99"), { raw: rawChapter(identity, "ch99") })

  const result = await loadCanonicalRawChapter(identity.corpusRevisionId, "ch99", {
    getDb: () => fakeDb as never,
  })

  assert.equal(result, null)
  assert.equal(fakeDb.readCount(chapterPath(identity.corpusRevisionId, "ch99")), 0)
})

test("loadCanonicalRawChapter returns a valid canonical chapter when the manifest row matches", async () => {
  const identity = deriveCorpusIdentity(Buffer.from("manifest valid row"))
  const fakeDb = new FakeFirestore()
  fakeDb.seed(revisionPath(identity.corpusRevisionId), completeRevisionDoc(identity, ["ch01"]))
  fakeDb.seed(chapterPath(identity.corpusRevisionId, "ch01"), { raw: rawChapter(identity, "ch01") })

  const chapter = await loadCanonicalRawChapter(identity.corpusRevisionId, "ch01", {
    getDb: () => fakeDb as never,
  })

  assert.equal(chapter?.chapter_id, "ch01")
  assert.equal(chapter?.paragraphs[0]?.text, "body")
})

test("loadCanonicalRawChapter throws when a manifest-listed canonical chapter row is missing", async () => {
  const identity = deriveCorpusIdentity(Buffer.from("manifest missing row"))
  const fakeDb = new FakeFirestore()
  fakeDb.seed(revisionPath(identity.corpusRevisionId), completeRevisionDoc(identity, ["ch01"]))

  await assert.rejects(
    loadCanonicalRawChapter(identity.corpusRevisionId, "ch01", {
      getDb: () => fakeDb as never,
    }),
    (error: unknown) => error instanceof CorpusImportError &&
      error.statusCode === 409 &&
      error.code === "revision_unavailable",
  )
  assert.equal(fakeDb.readCount(chapterPath(identity.corpusRevisionId, "ch01")), 1)
})

test("loadCanonicalRawChapter throws when a manifest-listed row stores a different chapter_id", async () => {
  const identity = deriveCorpusIdentity(Buffer.from("manifest wrong row"))
  const fakeDb = new FakeFirestore()
  fakeDb.seed(revisionPath(identity.corpusRevisionId), completeRevisionDoc(identity, ["ch01"]))
  fakeDb.seed(chapterPath(identity.corpusRevisionId, "ch01"), { raw: rawChapter(identity, "ch02") })

  await assert.rejects(
    loadCanonicalRawChapter(identity.corpusRevisionId, "ch01", {
      getDb: () => fakeDb as never,
    }),
    (error: unknown) => error instanceof CorpusImportError &&
      error.statusCode === 409 &&
      error.code === "revision_unavailable",
  )
})

test("listChapters rejects canonical rows whose raw.chapter_id does not match the manifest entry", async () => {
  const identity = deriveCorpusIdentity(Buffer.from("list chapter mismatch"))
  const fakeDb = new FakeFirestore()
  fakeDb.seed(revisionPath(identity.corpusRevisionId), completeRevisionDoc(identity, ["ch01"]))
  fakeDb.seed(chapterPath(identity.corpusRevisionId, "ch01"), { raw: rawChapter(identity, "ch77") })

  await assert.rejects(
    createRepository(fakeDb).listChapters(identity.corpusRevisionId),
    (error: unknown) => error instanceof CorpusImportError &&
      error.statusCode === 409 &&
      error.code === "revision_unavailable",
  )
})

test("claimRevision rejects sourceSha256 mismatches before any database access", async () => {
  const identity = deriveCorpusIdentity(Buffer.from("claim sha mismatch"))
  const fakeDb = new FakeFirestore()
  let getDbCalls = 0
  const repository = createRepository(fakeDb, () => {
    getDbCalls += 1
  })

  await assert.rejects(
    repository.claimRevision({
      ...identity,
      sourceSha256: "0".repeat(64),
      claimToken: "claim-token",
      nowMs: 1,
      claimExpiresAtMs: 2,
    }),
    /sourceSha256/,
  )
  assert.equal(getDbCalls, 0)
})

test("completeRevision rejects sourceSha256 mismatches before any database access", async () => {
  const identity = deriveCorpusIdentity(Buffer.from("complete sha mismatch"))
  const fakeDb = new FakeFirestore()
  let getDbCalls = 0
  const repository = createRepository(fakeDb, () => {
    getDbCalls += 1
  })

  await assert.rejects(
    repository.completeRevision({
      ...identity,
      sourceSha256: "f".repeat(64),
      claimToken: "claim-token",
      sourceFile: storedSourceFile(identity) as never,
      chapterIds: ["ch01"],
    }),
    /sourceSha256/,
  )
  assert.equal(getDbCalls, 0)
})

test("isCanonicalRevisionComplete returns false for malformed complete records", async () => {
  const identity = deriveCorpusIdentity(Buffer.from("malformed complete record"))
  const fakeDb = new FakeFirestore()
  fakeDb.seed(revisionPath(identity.corpusRevisionId), {
    schemaVersion: 1,
    ingestSchemaVersion: 1,
    bookId: identity.bookId,
    sourceSha256: identity.sourceSha256,
    status: "complete",
    chapterIds: ["ch01"],
    chapterCount: 1,
  })

  const result = await isCanonicalRevisionComplete(identity.corpusRevisionId, {
    getDb: () => fakeDb as never,
  })

  assert.equal(result, false)
})

test("isCanonicalRevisionComplete returns false for malformed present book IDs", async () => {
  const identity = deriveCorpusIdentity(Buffer.from("malformed complete book id"))
  const fakeDb = new FakeFirestore()
  fakeDb.seed(revisionPath(identity.corpusRevisionId), {
    ...completeRevisionDoc(identity, ["ch01"]),
    bookId: "bad book id",
  })

  const result = await isCanonicalRevisionComplete(identity.corpusRevisionId, {
    getDb: () => fakeDb as never,
  })

  assert.equal(result, false)
})

test("loadCanonicalRawChapter rejects malformed canonical paragraph objects", async () => {
  const identity = deriveCorpusIdentity(Buffer.from("malformed paragraph object"))
  const fakeDb = new FakeFirestore()
  fakeDb.seed(revisionPath(identity.corpusRevisionId), completeRevisionDoc(identity, ["ch01"]))
  fakeDb.seed(chapterPath(identity.corpusRevisionId, "ch01"), {
    raw: {
      ...rawChapter(identity, "ch01"),
      paragraphs: [{}],
    },
  })

  await assert.rejects(
    loadCanonicalRawChapter(identity.corpusRevisionId, "ch01", {
      getDb: () => fakeDb as never,
    }),
    (error: unknown) => error instanceof CorpusImportError &&
      error.statusCode === 409 &&
      error.code === "revision_unavailable",
  )
})

test("loadCanonicalRawChapter rejects malformed canonical paragraph text values", async () => {
  const identity = deriveCorpusIdentity(Buffer.from("malformed paragraph text"))
  const fakeDb = new FakeFirestore()
  fakeDb.seed(revisionPath(identity.corpusRevisionId), completeRevisionDoc(identity, ["ch01"]))
  fakeDb.seed(chapterPath(identity.corpusRevisionId, "ch01"), {
    raw: {
      ...rawChapter(identity, "ch01"),
      paragraphs: [{ ...validParagraph(), text: 7 }],
    },
  })

  await assert.rejects(
    loadCanonicalRawChapter(identity.corpusRevisionId, "ch01", {
      getDb: () => fakeDb as never,
    }),
    (error: unknown) => error instanceof CorpusImportError &&
      error.statusCode === 409 &&
      error.code === "revision_unavailable",
  )
})

test("saveChapters rejects malformed canonical paragraph metadata", async () => {
  const identity = deriveCorpusIdentity(Buffer.from("save malformed paragraph metadata"))
  const fakeDb = new FakeFirestore()
  fakeDb.seed(revisionPath(identity.corpusRevisionId), pendingRevisionDoc(identity, "claim-token"))

  await assert.rejects(
    createRepository(fakeDb).saveChapters(identity.corpusRevisionId, "claim-token", [
      {
        ...rawChapter(identity, "ch01"),
        paragraphs: [{ ...validParagraph(), paragraph_id: "bad" }],
      } as never,
    ]),
    (error: unknown) => error instanceof CorpusImportError &&
      error.statusCode === 409 &&
      error.code === "revision_unavailable",
  )
})

test("failRevision writes a bounded fallback failure message when the input message is empty", async () => {
  const identity = deriveCorpusIdentity(Buffer.from("failed revision fallback"))
  const fakeDb = new FakeFirestore()
  fakeDb.seed(revisionPath(identity.corpusRevisionId), pendingRevisionDoc(identity, "claim-token"))

  const repository = createRepository(fakeDb)
  await repository.failRevision({
    corpusRevisionId: identity.corpusRevisionId,
    claimToken: "claim-token",
    failedStep: "blob",
    message: "",
  })

  const revision = await repository.getRevision(identity.corpusRevisionId)
  assert.equal(revision?.status, "failed")
  assert.equal(revision?.failureMessage, "corpus import failed")
})
