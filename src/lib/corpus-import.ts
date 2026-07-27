import {
  deriveCorpusIdentity,
  type CorpusIdentity,
} from "@/lib/corpus-identity"
import type { FirestoreDataSource } from "@/lib/data-source"
import type { StoredSourceFile } from "@/lib/storage"
import type { RawChapter } from "@/types/schema"

export class CorpusImportError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message)
    this.name = "CorpusImportError"
  }
}

export const CORPUS_CLAIM_LEASE_MS = 5 * 60 * 1000

export type CorpusRevisionStatus = "pending" | "complete" | "failed"
export type CorpusImportFailureStep = "blob" | "chapters" | "complete"

export interface CorpusRevisionRecord extends CorpusIdentity {
  status: CorpusRevisionStatus
  sourceFile?: StoredSourceFile
  chapterIds?: string[]
  claimToken?: string
  claimExpiresAtMs?: number
  failedStep?: CorpusImportFailureStep
  failureMessage?: string
}

export interface ClaimRevisionInput extends CorpusIdentity {
  claimToken: string
  nowMs: number
  claimExpiresAtMs: number
}

export type ClaimRevisionResult =
  | { outcome: "claimed" }
  | { outcome: "complete" }
  | { outcome: "in_progress" }

export interface CompleteRevisionInput extends CorpusIdentity {
  claimToken: string
  sourceFile: StoredSourceFile
  chapterIds: string[]
}

export interface FailRevisionInput {
  corpusRevisionId: string
  claimToken: string
  failedStep: CorpusImportFailureStep
  message: string
}

export interface EnsureWorkspaceInput extends CorpusIdentity {
  title: string
  source: FirestoreDataSource
  sourceFile: StoredSourceFile
}

export interface PutCorpusBlobInput extends CorpusIdentity {
  fileName: string
  contentType: string
  buffer: Buffer
}

export interface CorpusImportRepository {
  getRevision(revisionId: string): Promise<CorpusRevisionRecord | null>
  claimRevision(input: ClaimRevisionInput): Promise<ClaimRevisionResult>
  saveChapters(
    revisionId: string,
    claimToken: string,
    chapters: RawChapter[],
  ): Promise<void>
  completeRevision(input: CompleteRevisionInput): Promise<void>
  failRevision(input: FailRevisionInput): Promise<void>
  listChapters(revisionId: string): Promise<RawChapter[]>
  ensureWorkspace(input: EnsureWorkspaceInput): Promise<void>
}

export interface CorpusBlobStore {
  putIfAbsent(input: PutCorpusBlobInput): Promise<StoredSourceFile>
}

export interface CorpusEpubParseContext {
  docId: string
  bookId: string
  corpusRevisionId: string
}

export interface CorpusEpubParser {
  (buffer: Buffer, context: CorpusEpubParseContext): Promise<RawChapter[]>
}

export interface CorpusImportInput {
  buffer: Buffer
  fileName: string
  contentType: string
  title: string
  bookId?: string
  source: FirestoreDataSource
}

export interface CorpusImportDependencies {
  repository: CorpusImportRepository
  blobStore: CorpusBlobStore
  parseEpub: CorpusEpubParser
  now(): Date
  createClaimToken(): string
}

export interface CorpusImportResult extends CorpusIdentity {
  docId: string
  chapters: RawChapter[]
  sourceFile: StoredSourceFile
  reused: boolean
}

function conflictForKnownRevision(
  identity: CorpusIdentity,
  existing: CorpusRevisionRecord,
  requestedBookId: string | undefined,
): CorpusIdentity {
  if (requestedBookId !== undefined && existing.bookId !== identity.bookId) {
    throw new CorpusImportError(
      "corpus revision belongs to another book",
      409,
      "book_conflict",
    )
  }

  return {
    ...identity,
    bookId: existing.bookId,
  }
}

function completedSourceFile(record: CorpusRevisionRecord): StoredSourceFile {
  if (record.status !== "complete" || !record.sourceFile) {
    throw new CorpusImportError(
      "completed corpus revision is unavailable",
      409,
      "revision_unavailable",
    )
  }

  return record.sourceFile
}

async function reuseCompletedRevision(
  identity: CorpusIdentity,
  record: CorpusRevisionRecord,
  input: CorpusImportInput,
  repository: CorpusImportRepository,
): Promise<CorpusImportResult> {
  const sourceFile = completedSourceFile(record)
  await repository.ensureWorkspace({
    ...identity,
    title: input.title,
    source: input.source,
    sourceFile,
  })

  return {
    ...identity,
    docId: identity.corpusRevisionId,
    chapters: await repository.listChapters(identity.corpusRevisionId),
    sourceFile,
    reused: true,
  }
}

function failureDiagnostic(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500)
}

export function workspaceCorpusRevisionId(workspace: unknown): string | null {
  if (typeof workspace !== "object" || workspace === null) return null
  const corpusRevisionId = (workspace as { corpusRevisionId?: unknown }).corpusRevisionId
  return typeof corpusRevisionId === "string" && corpusRevisionId.length > 0
    ? corpusRevisionId
    : null
}

export async function importCorpusEpub(
  input: CorpusImportInput,
  dependencies: CorpusImportDependencies,
): Promise<CorpusImportResult> {
  let identity: CorpusIdentity
  try {
    identity = deriveCorpusIdentity(input.buffer, input.bookId)
  } catch (error) {
    throw new CorpusImportError(
      error instanceof Error ? error.message : "invalid bookId",
      400,
      "invalid_book_id",
    )
  }

  const existing = await dependencies.repository.getRevision(identity.corpusRevisionId)
  if (existing) {
    identity = conflictForKnownRevision(identity, existing, input.bookId)
    if (existing.status === "complete") {
      return reuseCompletedRevision(identity, existing, input, dependencies.repository)
    }
  }

  const chapters = await dependencies.parseEpub(input.buffer, {
    docId: identity.corpusRevisionId,
    bookId: identity.bookId,
    corpusRevisionId: identity.corpusRevisionId,
  })

  const nowMs = dependencies.now().getTime()
  const claimToken = dependencies.createClaimToken()
  const claim = await dependencies.repository.claimRevision({
    ...identity,
    claimToken,
    nowMs,
    claimExpiresAtMs: nowMs + CORPUS_CLAIM_LEASE_MS,
  })

  if (claim.outcome === "complete") {
    const completed = await dependencies.repository.getRevision(identity.corpusRevisionId)
    if (!completed || completed.status !== "complete") {
      throw new CorpusImportError(
        "completed corpus revision is unavailable",
        409,
        "revision_unavailable",
      )
    }
    identity = conflictForKnownRevision(identity, completed, input.bookId)
    return reuseCompletedRevision(identity, completed, input, dependencies.repository)
  }

  if (claim.outcome === "in_progress") {
    throw new CorpusImportError(
      `corpus import already in progress: ${identity.corpusRevisionId}`,
      409,
      "import_in_progress",
    )
  }

  let completed = false
  let failedStep: CorpusImportFailureStep = "blob"
  try {
    const sourceFile = await dependencies.blobStore.putIfAbsent({
      ...identity,
      fileName: input.fileName,
      contentType: input.contentType,
      buffer: input.buffer,
    })

    failedStep = "chapters"
    await dependencies.repository.saveChapters(
      identity.corpusRevisionId,
      claimToken,
      chapters,
    )

    failedStep = "complete"
    await dependencies.repository.completeRevision({
      ...identity,
      claimToken,
      sourceFile,
      chapterIds: chapters.map((chapter) => chapter.chapter_id),
    })
    completed = true

    await dependencies.repository.ensureWorkspace({
      ...identity,
      title: input.title,
      source: input.source,
      sourceFile,
    })

    return {
      ...identity,
      docId: identity.corpusRevisionId,
      chapters,
      sourceFile,
      reused: false,
    }
  } catch (error) {
    if (!completed) {
      await dependencies.repository.failRevision({
        corpusRevisionId: identity.corpusRevisionId,
        claimToken,
        failedStep,
        message: failureDiagnostic(error),
      })
    }
    throw error
  }
}
