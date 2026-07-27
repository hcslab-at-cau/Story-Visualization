import { FieldValue, Timestamp, type DocumentData, type Firestore } from "firebase-admin/firestore"
import { validateBookId } from "@/lib/corpus-identity"
import {
  CorpusImportError,
  type ClaimRevisionInput,
  type ClaimRevisionResult,
  type CompleteRevisionInput,
  type CorpusImportRepository,
  type CorpusRevisionRecord,
  type EnsureWorkspaceInput,
  type FailRevisionInput,
} from "@/lib/corpus-import"
import {
  firestoreDocumentsCollectionName,
  type FirestoreDataSource,
} from "@/lib/data-source"
import { explainAdminCredentialError, getAdminDb } from "@/lib/firebase-admin"
import type { StoredSourceFile } from "@/lib/storage"
import type { RawChapter } from "@/types/schema"

export const CORPUS_BOOKS_COLLECTION = "corpus_books"
export const CORPUS_REVISIONS_COLLECTION = "corpus_revisions"

const CORPUS_REVISION_ID_PATTERN = /^cr_v1_([a-f0-9]{64})$/
const CHAPTER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const PARAGRAPH_ID_PATTERN = /^p_v1_[a-f0-9]{64}$/
const SOURCE_ITEM_ID_PATTERN = /^si_v1_[a-f0-9]{64}$/
const STORAGE_VERSION = 2
const FAILURE_MESSAGE_MAX_LENGTH = 500

export interface FirestoreCorpusImportRepositoryDependencies {
  getDb?: () => Firestore
}

type CanonicalReadDependencies = FirestoreCorpusImportRepositoryDependencies

function withAdminErrorContext<T>(operation: () => Promise<T>): Promise<T> {
  return operation().catch((error) => {
    throw explainAdminCredentialError(error)
  })
}

function stripUndefinedDeep(value: unknown): unknown {
  if (value === undefined) return undefined
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const sanitized = stripUndefinedDeep(item)
      return sanitized === undefined ? [] : [sanitized]
    })
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).flatMap(([key, nestedValue]) => {
      const sanitized = stripUndefinedDeep(nestedValue)
      return sanitized === undefined ? [] : [[key, sanitized] as const]
    })
    return Object.fromEntries(entries)
  }
  return value
}

function revisionUnavailable(message = "completed corpus revision is unavailable"): CorpusImportError {
  return new CorpusImportError(message, 409, "revision_unavailable")
}

function claimLost(): CorpusImportError {
  return new CorpusImportError("corpus import claim is no longer active", 409, "claim_lost")
}

function bookConflict(): CorpusImportError {
  return new CorpusImportError("corpus revision belongs to another book", 409, "book_conflict")
}

function canonicalStoragePath(corpusRevisionId: string): string {
  return `corpus_revisions/${corpusRevisionId}/source.epub`
}

function validatedCorpusRevisionId(corpusRevisionId: string): string {
  if (!CORPUS_REVISION_ID_PATTERN.test(corpusRevisionId)) {
    throw revisionUnavailable("canonical corpus revision ID is invalid")
  }
  return corpusRevisionId
}

function sourceShaFromRevisionId(corpusRevisionId: string): string {
  const match = CORPUS_REVISION_ID_PATTERN.exec(corpusRevisionId)
  if (!match) throw revisionUnavailable("canonical corpus revision ID is invalid")
  return match[1]
}

function validateCanonicalIdentity(corpusRevisionId: string, sourceSha256: string): string {
  validatedCorpusRevisionId(corpusRevisionId)
  const expectedSourceSha256 = sourceShaFromRevisionId(corpusRevisionId)
  if (sourceSha256 !== expectedSourceSha256) {
    throw new Error(`sourceSha256 must equal ${expectedSourceSha256}`)
  }
  return expectedSourceSha256
}

function validatedChapterId(chapterId: unknown): string {
  if (typeof chapterId !== "string" || !CHAPTER_ID_PATTERN.test(chapterId)) {
    throw revisionUnavailable("canonical chapter ID is invalid")
  }
  return chapterId
}

function validatedStoredSourceFile(
  value: unknown,
  corpusRevisionId: string,
): StoredSourceFile {
  if (typeof value !== "object" || value === null) {
    throw revisionUnavailable("stored canonical source file is invalid")
  }

  const record = value as Record<string, unknown>
  const bucket = typeof record.bucket === "string" && record.bucket.length > 0 ? record.bucket : null
  const storagePath = typeof record.storagePath === "string" ? record.storagePath : null
  const gsUri = typeof record.gsUri === "string" ? record.gsUri : null
  const fileName = typeof record.fileName === "string" && record.fileName.length > 0 ? record.fileName : null
  const contentType = typeof record.contentType === "string" && record.contentType.length > 0
    ? record.contentType
    : null
  const sizeBytes = typeof record.sizeBytes === "number" ? record.sizeBytes : Number.NaN
  const expectedStoragePath = canonicalStoragePath(corpusRevisionId)

  if (
    !bucket ||
    storagePath !== expectedStoragePath ||
    gsUri !== `gs://${bucket}/${expectedStoragePath}` ||
    !fileName ||
    !contentType ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes < 0
  ) {
    throw revisionUnavailable("stored canonical source file is invalid")
  }

  return {
    bucket,
    storagePath: expectedStoragePath,
    gsUri,
    fileName,
    contentType,
    sizeBytes,
  }
}

function validatedTimestampMillis(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined
  if (value instanceof Timestamp) return value.toMillis()
  throw revisionUnavailable("canonical claim expiration is invalid")
}

function validatedChapterIds(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw revisionUnavailable("canonical chapter manifest is invalid")
  const chapterIds = value.map((chapterId) => validatedChapterId(chapterId))
  if (new Set(chapterIds).size !== chapterIds.length) {
    throw revisionUnavailable("canonical chapter manifest is invalid")
  }
  return chapterIds
}

function validatedNonNegativeSafeInteger(
  value: unknown,
  message: string,
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw revisionUnavailable(message)
  }
  return value
}

function validatedOptionalPattern(
  value: unknown,
  pattern: RegExp,
  message: string,
): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string" || !pattern.test(value)) {
    throw revisionUnavailable(message)
  }
  return value
}

function validatedParagraphs(value: unknown): RawChapter["paragraphs"] {
  if (!Array.isArray(value)) throw revisionUnavailable("stored canonical chapter paragraphs are invalid")

  return value.map((paragraph) => {
    if (typeof paragraph !== "object" || paragraph === null) {
      throw revisionUnavailable("stored canonical chapter paragraphs are invalid")
    }

    const record = paragraph as Record<string, unknown>
    const start = validatedNonNegativeSafeInteger(record.start, "stored canonical paragraph start is invalid")
    const end = validatedNonNegativeSafeInteger(record.end, "stored canonical paragraph end is invalid")
    if (end < start) {
      throw revisionUnavailable("stored canonical paragraph end is invalid")
    }

    const text = record.text
    if (typeof text !== "string") {
      throw revisionUnavailable("stored canonical paragraph text is invalid")
    }

    return {
      pid: validatedNonNegativeSafeInteger(record.pid, "stored canonical paragraph pid is invalid"),
      start,
      end,
      text,
      ...(validatedOptionalPattern(record.paragraph_id, PARAGRAPH_ID_PATTERN, "stored canonical paragraph_id is invalid")
        ? { paragraph_id: validatedOptionalPattern(record.paragraph_id, PARAGRAPH_ID_PATTERN, "stored canonical paragraph_id is invalid") }
        : {}),
      ...(validatedOptionalPattern(record.source_item_id, SOURCE_ITEM_ID_PATTERN, "stored canonical source_item_id is invalid")
        ? { source_item_id: validatedOptionalPattern(record.source_item_id, SOURCE_ITEM_ID_PATTERN, "stored canonical source_item_id is invalid") }
        : {}),
      ...(record.source_paragraph_ordinal !== undefined
        ? {
          source_paragraph_ordinal: validatedNonNegativeSafeInteger(
            record.source_paragraph_ordinal,
            "stored canonical source_paragraph_ordinal is invalid",
          ),
        }
        : {}),
      ...(record.global_ordinal !== undefined
        ? {
          global_ordinal: validatedNonNegativeSafeInteger(
            record.global_ordinal,
            "stored canonical global_ordinal is invalid",
          ),
        }
        : {}),
    }
  })
}

function validatedRevisionRecord(
  corpusRevisionId: string,
  value: unknown,
): CorpusRevisionRecord {
  validatedCorpusRevisionId(corpusRevisionId)
  if (typeof value !== "object" || value === null) {
    throw revisionUnavailable("canonical corpus revision is invalid")
  }

  const record = value as Record<string, unknown>
  const sourceSha256 = typeof record.sourceSha256 === "string" ? record.sourceSha256 : ""
  const expectedSourceSha256 = sourceShaFromRevisionId(corpusRevisionId)
  if (sourceSha256 !== expectedSourceSha256) {
    throw revisionUnavailable("canonical corpus revision source digest is invalid")
  }

  let bookId: string | null = null
  if (typeof record.bookId === "string") {
    try {
      bookId = validateBookId(record.bookId)
    } catch {
      throw revisionUnavailable("canonical corpus revision book ID is invalid")
    }
  }
  if (!bookId) throw revisionUnavailable("canonical corpus revision book ID is invalid")

  const status = record.status
  if (status !== "pending" && status !== "complete" && status !== "failed") {
    throw revisionUnavailable("canonical corpus revision status is invalid")
  }

  const sourceFile = record.sourceFile === undefined
    ? undefined
    : validatedStoredSourceFile(record.sourceFile, corpusRevisionId)
  const chapterIds = validatedChapterIds(record.chapterIds)
  const chapterCount = record.chapterCount
  if (
    chapterCount !== undefined &&
    (typeof chapterCount !== "number" || !Number.isSafeInteger(chapterCount) || chapterCount < 0)
  ) {
    throw revisionUnavailable("canonical chapter count is invalid")
  }
  if (chapterIds !== undefined && chapterCount !== undefined && chapterCount !== chapterIds.length) {
    throw revisionUnavailable("canonical chapter count is invalid")
  }

  const claimToken = record.claimToken
  if (claimToken !== undefined && (typeof claimToken !== "string" || claimToken.length === 0)) {
    throw revisionUnavailable("canonical claim token is invalid")
  }

  const failedStep = record.failedStep
  if (
    failedStep !== undefined &&
    failedStep !== "blob" &&
    failedStep !== "chapters" &&
    failedStep !== "complete"
  ) {
    throw revisionUnavailable("canonical failed step is invalid")
  }

  const failureMessage = record.failureMessage
  if (
    failureMessage !== undefined &&
    (typeof failureMessage !== "string" || failureMessage.length === 0)
  ) {
    throw revisionUnavailable("canonical failure message is invalid")
  }

  if (status === "complete") {
    if (!sourceFile) throw revisionUnavailable("stored canonical source file is invalid")
    if (!chapterIds || chapterIds.length === 0) {
      throw revisionUnavailable("canonical chapter manifest is invalid")
    }
    if (chapterCount !== chapterIds.length) {
      throw revisionUnavailable("canonical chapter count is invalid")
    }
  }

  return {
    bookId,
    corpusRevisionId,
    sourceSha256,
    status,
    ...(sourceFile ? { sourceFile } : {}),
    ...(chapterIds ? { chapterIds } : {}),
    ...(typeof claimToken === "string" ? { claimToken } : {}),
    ...(validatedTimestampMillis(record.claimExpiresAt) !== undefined
      ? { claimExpiresAtMs: validatedTimestampMillis(record.claimExpiresAt) }
      : {}),
    ...(failedStep ? { failedStep } : {}),
    ...(typeof failureMessage === "string" ? { failureMessage } : {}),
  }
}

function validatedChapterShape(
  chapter: unknown,
  corpusRevisionId: string,
  expectedChapterId: string,
  expectedBookId?: string,
): RawChapter {
  if (typeof chapter !== "object" || chapter === null) {
    throw revisionUnavailable("stored canonical chapter is invalid")
  }

  const record = chapter as Record<string, unknown>
  const chapterId = validatedChapterId(record.chapter_id)
  if (chapterId !== expectedChapterId) {
    throw revisionUnavailable("stored canonical chapter ID is invalid")
  }
  if (record.doc_id !== corpusRevisionId) {
    throw revisionUnavailable("stored canonical chapter doc ID is invalid")
  }
  if (record.corpus_revision_id !== corpusRevisionId) {
    throw revisionUnavailable("stored canonical chapter revision marker is invalid")
  }
  if (expectedBookId !== undefined && record.book_id !== expectedBookId) {
    throw revisionUnavailable("stored canonical chapter book ID is invalid")
  }
  if (
    typeof record.title !== "string" ||
    typeof record.text !== "string" ||
    !Array.isArray(record.paragraphs)
  ) {
    throw revisionUnavailable("stored canonical chapter is invalid")
  }

  return {
    ...(record as unknown as RawChapter),
    paragraphs: validatedParagraphs(record.paragraphs),
  }
}

function validatedOrderedChapterIds(chapterIds: string[]): string[] {
  if (chapterIds.length === 0) {
    throw revisionUnavailable("completed corpus revision is unavailable")
  }
  if (new Set(chapterIds).size !== chapterIds.length) {
    throw revisionUnavailable("completed corpus revision is unavailable")
  }
  return chapterIds
}

function sanitizedFailureMessage(message: string): string {
  const trimmed = message.trim()
  return (trimmed.length > 0 ? trimmed : "corpus import failed")
    .slice(0, FAILURE_MESSAGE_MAX_LENGTH)
}

export class FirestoreCorpusImportRepository implements CorpusImportRepository {
  constructor(
    private readonly dependencies: FirestoreCorpusImportRepositoryDependencies = {},
  ) {}

  private db(): Firestore {
    return (this.dependencies.getDb ?? getAdminDb)()
  }

  private revisionRef(corpusRevisionId: string) {
    validatedCorpusRevisionId(corpusRevisionId)
    return this.db().collection(CORPUS_REVISIONS_COLLECTION).doc(corpusRevisionId)
  }

  private bookRef(bookId: string) {
    validateBookId(bookId)
    return this.db().collection(CORPUS_BOOKS_COLLECTION).doc(bookId)
  }

  private workspaceRef(corpusRevisionId: string, source: FirestoreDataSource) {
    validatedCorpusRevisionId(corpusRevisionId)
    return this.db().collection(firestoreDocumentsCollectionName(source)).doc(corpusRevisionId)
  }

  private chapterRef(corpusRevisionId: string, chapterId: string) {
    validatedCorpusRevisionId(corpusRevisionId)
    validatedChapterId(chapterId)
    return this.revisionRef(corpusRevisionId).collection("chapters").doc(chapterId)
  }

  async getRevision(corpusRevisionId: string): Promise<CorpusRevisionRecord | null> {
    return withAdminErrorContext(async () => {
      const snapshot = await this.revisionRef(corpusRevisionId).get()
      if (!snapshot.exists) return null
      return validatedRevisionRecord(corpusRevisionId, snapshot.data())
    })
  }

  async claimRevision(input: ClaimRevisionInput): Promise<ClaimRevisionResult> {
    validateBookId(input.bookId)
    const sourceSha256 = validateCanonicalIdentity(input.corpusRevisionId, input.sourceSha256)

    return withAdminErrorContext(async () => this.db().runTransaction(async (transaction) => {
      const revisionRef = this.revisionRef(input.corpusRevisionId)
      const bookRef = this.bookRef(input.bookId)
      const [revisionSnapshot, bookSnapshot] = await Promise.all([
        transaction.get(revisionRef),
        transaction.get(bookRef),
      ])

      const existing = revisionSnapshot.exists
        ? validatedRevisionRecord(input.corpusRevisionId, revisionSnapshot.data())
        : null

      if (existing && existing.bookId !== input.bookId) throw bookConflict()
      if (existing?.status === "complete") return { outcome: "complete" }
      if (
        existing?.status === "pending" &&
        existing.claimExpiresAtMs !== undefined &&
        existing.claimExpiresAtMs > input.nowMs
      ) {
        return { outcome: "in_progress" }
      }

      const revisionPayload: DocumentData = {
        schemaVersion: 1,
        ingestSchemaVersion: 1,
        bookId: input.bookId,
        sourceSha256,
        status: "pending",
        claimToken: input.claimToken,
        claimExpiresAt: Timestamp.fromMillis(input.claimExpiresAtMs),
        createdAt: revisionSnapshot.get("createdAt") ?? FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }

      if (revisionSnapshot.exists) {
        revisionPayload.sourceFile = FieldValue.delete()
        revisionPayload.chapterIds = FieldValue.delete()
        revisionPayload.chapterCount = FieldValue.delete()
        revisionPayload.failedStep = FieldValue.delete()
        revisionPayload.failureMessage = FieldValue.delete()
        revisionPayload.completedAt = FieldValue.delete()
        transaction.set(revisionRef, revisionPayload, { merge: true })
      } else {
        transaction.set(revisionRef, revisionPayload)
      }

      if (!bookSnapshot.exists) {
        transaction.set(bookRef, {
          schemaVersion: 1,
          createdAt: FieldValue.serverTimestamp(),
        })
      } else {
        transaction.set(bookRef, {
          schemaVersion: 1,
          createdAt: bookSnapshot.get("createdAt") ?? FieldValue.serverTimestamp(),
        }, { merge: true })
      }

      return { outcome: "claimed" }
    }))
  }

  async saveChapters(
    corpusRevisionId: string,
    claimToken: string,
    chapters: RawChapter[],
  ): Promise<void> {
    validatedCorpusRevisionId(corpusRevisionId)
    const revisionRecord = await this.getRevision(corpusRevisionId)
    if (!revisionRecord) throw claimLost()

    const seenChapterIds = new Set<string>()
    const sanitizedChapters = chapters.map((chapter) => {
      const chapterId = validatedChapterId((chapter as { chapter_id?: unknown }).chapter_id)
      const validated = validatedChapterShape(
        chapter,
        corpusRevisionId,
        chapterId,
        revisionRecord.bookId,
      )
      if (seenChapterIds.has(validated.chapter_id)) {
        throw revisionUnavailable("canonical chapter manifest is invalid")
      }
      seenChapterIds.add(validated.chapter_id)
      return {
        chapterId: validated.chapter_id,
        raw: stripUndefinedDeep(validated) as DocumentData,
      }
    })

    await withAdminErrorContext(async () => {
      for (let index = 0; index < sanitizedChapters.length; index += 400) {
        const chunk = sanitizedChapters.slice(index, index + 400)
        await this.db().runTransaction(async (transaction) => {
          const revisionSnapshot = await transaction.get(this.revisionRef(corpusRevisionId))
          const activeRevision = revisionSnapshot.exists
            ? validatedRevisionRecord(corpusRevisionId, revisionSnapshot.data())
            : null
          if (!activeRevision || activeRevision.status !== "pending" || activeRevision.claimToken !== claimToken) {
            throw claimLost()
          }

          for (const chapter of chunk) {
            transaction.set(this.chapterRef(corpusRevisionId, chapter.chapterId), {
              raw: chapter.raw,
            })
          }
        })
      }
    })
  }

  async completeRevision(input: CompleteRevisionInput): Promise<void> {
    validateBookId(input.bookId)
    const sourceSha256 = validateCanonicalIdentity(input.corpusRevisionId, input.sourceSha256)
    const sourceFile = validatedStoredSourceFile(input.sourceFile, input.corpusRevisionId)
    const chapterIds = validatedOrderedChapterIds(input.chapterIds.map((chapterId) => validatedChapterId(chapterId)))

    await withAdminErrorContext(async () => this.db().runTransaction(async (transaction) => {
      const revisionRef = this.revisionRef(input.corpusRevisionId)
      const revisionSnapshot = await transaction.get(revisionRef)
      const existing = revisionSnapshot.exists
        ? validatedRevisionRecord(input.corpusRevisionId, revisionSnapshot.data())
        : null

      if (!existing || existing.status !== "pending" || existing.claimToken !== input.claimToken) {
        throw claimLost()
      }
      if (existing.bookId !== input.bookId) throw bookConflict()

      transaction.set(revisionRef, {
        schemaVersion: 1,
        ingestSchemaVersion: 1,
        bookId: input.bookId,
        sourceSha256,
        status: "complete",
        sourceFile,
        chapterIds,
        chapterCount: chapterIds.length,
        claimToken: FieldValue.delete(),
        claimExpiresAt: FieldValue.delete(),
        failedStep: FieldValue.delete(),
        failureMessage: FieldValue.delete(),
        createdAt: revisionSnapshot.get("createdAt") ?? FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        completedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    }))
  }

  async failRevision(input: FailRevisionInput): Promise<void> {
    validatedCorpusRevisionId(input.corpusRevisionId)
    const sourceSha256 = sourceShaFromRevisionId(input.corpusRevisionId)

    await withAdminErrorContext(async () => this.db().runTransaction(async (transaction) => {
      const revisionRef = this.revisionRef(input.corpusRevisionId)
      const revisionSnapshot = await transaction.get(revisionRef)
      const existing = revisionSnapshot.exists
        ? validatedRevisionRecord(input.corpusRevisionId, revisionSnapshot.data())
        : null

      if (!existing || existing.status !== "pending" || existing.claimToken !== input.claimToken) {
        throw claimLost()
      }

      transaction.set(revisionRef, {
        schemaVersion: 1,
        ingestSchemaVersion: 1,
        bookId: existing.bookId,
        sourceSha256,
        status: "failed",
        failedStep: input.failedStep,
        failureMessage: sanitizedFailureMessage(input.message),
        sourceFile: FieldValue.delete(),
        chapterIds: FieldValue.delete(),
        chapterCount: FieldValue.delete(),
        claimToken: FieldValue.delete(),
        claimExpiresAt: FieldValue.delete(),
        completedAt: FieldValue.delete(),
        createdAt: revisionSnapshot.get("createdAt") ?? FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    }))
  }

  async listChapters(corpusRevisionId: string): Promise<RawChapter[]> {
    return withAdminErrorContext(async () => {
      const revision = await this.getRevision(corpusRevisionId)
      if (!revision || revision.status !== "complete" || !revision.chapterIds) {
        throw revisionUnavailable()
      }

      const chapterIds = validatedOrderedChapterIds(revision.chapterIds)
      const snapshots = await Promise.all(
        chapterIds.map((chapterId) => this.chapterRef(corpusRevisionId, chapterId).get()),
      )

      return snapshots.map((snapshot, index) => {
        if (!snapshot.exists) throw revisionUnavailable()
        const raw = snapshot.get("raw")
        return validatedChapterShape(raw, corpusRevisionId, chapterIds[index], revision.bookId)
      })
    })
  }

  async ensureWorkspace(input: EnsureWorkspaceInput): Promise<void> {
    validateBookId(input.bookId)
    const sourceFile = validatedStoredSourceFile(input.sourceFile, input.corpusRevisionId)

    await withAdminErrorContext(async () => this.db().runTransaction(async (transaction) => {
      const workspaceRef = this.workspaceRef(input.corpusRevisionId, input.source)
      const workspaceSnapshot = await transaction.get(workspaceRef)
      transaction.set(workspaceRef, {
        title: input.title,
        bookId: input.bookId,
        corpusRevisionId: input.corpusRevisionId,
        sourceFile,
        storageVersion: STORAGE_VERSION,
        createdAt: workspaceSnapshot.get("createdAt") ?? FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    }))
  }
}

function chapterDocRef(db: Firestore, corpusRevisionId: string, chapterId: string) {
  validatedCorpusRevisionId(corpusRevisionId)
  validatedChapterId(chapterId)
  return db.collection(CORPUS_REVISIONS_COLLECTION)
    .doc(corpusRevisionId)
    .collection("chapters")
    .doc(chapterId)
}

function createRepository(
  dependencies: CanonicalReadDependencies = {},
): FirestoreCorpusImportRepository {
  return new FirestoreCorpusImportRepository(dependencies)
}

export async function isCanonicalRevisionComplete(
  corpusRevisionId: string,
  dependencies: CanonicalReadDependencies = {},
): Promise<boolean> {
  try {
    const revision = await createRepository(dependencies).getRevision(corpusRevisionId)
    return revision?.status === "complete"
  } catch (error) {
    if (error instanceof CorpusImportError && error.code === "revision_unavailable") {
      return false
    }
    throw error
  }
}

export async function loadCanonicalRawChapter(
  corpusRevisionId: string,
  chapterId: string,
  dependencies: CanonicalReadDependencies = {},
): Promise<RawChapter | null> {
  validatedCorpusRevisionId(corpusRevisionId)
  const validatedRequestedChapterId = validatedChapterId(chapterId)
  const repository = createRepository(dependencies)
  const revision = await repository.getRevision(corpusRevisionId)
  if (!revision || revision.status !== "complete") return null
  const chapterIds = validatedOrderedChapterIds(revision.chapterIds ?? [])
  if (!chapterIds.includes(validatedRequestedChapterId)) return null

  return withAdminErrorContext(async () => {
    const snapshot = await chapterDocRef(
      (dependencies.getDb ?? getAdminDb)(),
      corpusRevisionId,
      validatedRequestedChapterId,
    ).get()
    if (!snapshot.exists) throw revisionUnavailable()
    return validatedChapterShape(
      snapshot.get("raw"),
      corpusRevisionId,
      validatedRequestedChapterId,
      revision.bookId,
    )
  })
}

export async function listCanonicalRawChapters(
  corpusRevisionId: string,
  dependencies: CanonicalReadDependencies = {},
): Promise<RawChapter[]> {
  return createRepository(dependencies).listChapters(corpusRevisionId)
}
