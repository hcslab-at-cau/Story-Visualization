/**
 * Firebase Storage helpers for uploaded source files and generated assets.
 *
 * This module is server-only in practice: API routes use Firebase Admin SDK so
 * Storage rules do not block uploads from the application backend.
 */

import { createHash, randomUUID } from "crypto"
import { gunzipSync, gzipSync } from "node:zlib"
import {
  storagePrefixForSource,
  type StorageDataSource,
} from "./data-source"
import { CorpusImportError } from "./corpus-import"
import type {
  CorpusBlobStore,
  PutCorpusBlobInput,
} from "./corpus-import"
import { explainAdminCredentialError, getAdminStorageBucket } from "./firebase-admin"
import type { V3SemanticVectorPayload } from "./pipeline/v3-semantic-index-types"

export interface StoredSourceFile {
  bucket: string
  storagePath: string
  gsUri: string
  fileName: string
  contentType: string
  sizeBytes: number
}

export interface StoredGeneratedImage extends StoredSourceFile {
  downloadUrl: string
}

export interface StoredSemanticVectorBlob extends StoredSourceFile {
  contentType: "application/gzip"
  contentHash: string
}

interface CanonicalStorageMetadata {
  contentType?: unknown
  metadata?: Record<string, unknown> | null
}

interface CanonicalStorageFileLike {
  save(
    buffer: Buffer,
    options: {
      resumable: boolean
      metadata: {
        contentType: string
        metadata: Record<string, string>
      }
      preconditionOpts: {
        ifGenerationMatch: number
      }
    },
  ): Promise<void>
  getMetadata(): Promise<[CanonicalStorageMetadata, unknown?]>
  download(): Promise<[Buffer]>
}

interface CanonicalStorageBucketLike {
  file(path: string): CanonicalStorageFileLike
}

interface PutCanonicalSourceEpubInput {
  corpusRevisionId: string
  sourceSha256: string
  fileName: string
  buffer: Buffer
  contentType: string
}

interface PutCanonicalSourceEpubDependencies {
  getBucket(): CanonicalStorageBucketLike
  bucketName(): string
  explainError(error: unknown): Error
}

const SOURCE_SHA256_PATTERN = /^[a-f0-9]{64}$/

function sanitizeFileName(fileName: string): string {
  const cleaned = fileName
    .trim()
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
  return cleaned || "original.epub"
}

function sanitizePathSegment(value: string, fallback: string): string {
  const cleaned = value
    .trim()
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
  return cleaned || fallback
}

async function withStorageErrorContext<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw explainAdminCredentialError(error)
  }
}

function bucketName(): string {
  return (
    process.env.FIREBASE_STORAGE_BUCKET ??
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ??
    "story-visualization-cb0e2.firebasestorage.app"
  )
}

function canonicalStoragePath(corpusRevisionId: string): string {
  return `corpus_revisions/${corpusRevisionId}/source.epub`
}

function validateCanonicalSourceIdentity(input: Pick<PutCanonicalSourceEpubInput, "corpusRevisionId" | "sourceSha256">): void {
  if (!SOURCE_SHA256_PATTERN.test(input.sourceSha256)) {
    throw new Error("sourceSha256 must match ^[a-f0-9]{64}$")
  }

  const expectedRevisionId = `cr_v1_${input.sourceSha256}`
  if (input.corpusRevisionId !== expectedRevisionId) {
    throw new Error(`corpusRevisionId must equal ${expectedRevisionId}`)
  }
}

function canonicalSourceMetadata(input: PutCanonicalSourceEpubInput): {
  contentType: string
  metadata: Record<string, string>
} {
  return {
    contentType: input.contentType,
    metadata: {
      originalFileName: input.fileName,
      sizeBytes: String(input.buffer.byteLength),
      sourceSha256: input.sourceSha256,
    },
  }
}

function isPreconditionFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false
  return Number(error.code) === 412
}

function sourceIntegrityConflict(): CorpusImportError {
  return new CorpusImportError(
    "stored canonical source object does not match the requested revision identity",
    409,
    "source_integrity_conflict",
  )
}

function storedMetadataField(
  metadata: CanonicalStorageMetadata,
  fieldName: string,
): string | undefined {
  const value = metadata.metadata?.[fieldName]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function verifyStoredCanonicalSource(
  input: PutCanonicalSourceEpubInput,
  metadata: CanonicalStorageMetadata,
): {
  fileName: string
  contentType: string
} {
  const storedSha256 = storedMetadataField(metadata, "sourceSha256")
  if (storedSha256 !== input.sourceSha256) throw sourceIntegrityConflict()

  const storedSizeBytes = Number(storedMetadataField(metadata, "sizeBytes"))
  if (!Number.isSafeInteger(storedSizeBytes) || storedSizeBytes !== input.buffer.byteLength) {
    throw sourceIntegrityConflict()
  }

  return {
    contentType: typeof metadata.contentType === "string" && metadata.contentType.length > 0
      ? metadata.contentType
      : input.contentType,
    fileName: storedMetadataField(metadata, "originalFileName") ?? input.fileName,
  }
}

function createStoredSourceFile(
  bucket: string,
  storagePath: string,
  fileName: string,
  contentType: string,
  sizeBytes: number,
): StoredSourceFile {
  return {
    bucket,
    storagePath,
    gsUri: `gs://${bucket}/${storagePath}`,
    fileName,
    contentType,
    sizeBytes,
  }
}

function createPutCanonicalSourceEpub(dependencies: PutCanonicalSourceEpubDependencies) {
  return async function putCanonicalSourceEpubWithDependencies(
    input: PutCanonicalSourceEpubInput,
  ): Promise<StoredSourceFile> {
    validateCanonicalSourceIdentity(input)

    let bucket: CanonicalStorageBucketLike
    try {
      bucket = dependencies.getBucket()
    } catch (error) {
      throw dependencies.explainError(error)
    }

    const bucketLabel = dependencies.bucketName()
    const storagePath = canonicalStoragePath(input.corpusRevisionId)
    const file = bucket.file(storagePath)

    try {
      await file.save(input.buffer, {
        resumable: false,
        metadata: canonicalSourceMetadata(input),
        preconditionOpts: { ifGenerationMatch: 0 },
      })

      return createStoredSourceFile(
        bucketLabel,
        storagePath,
        input.fileName,
        input.contentType,
        input.buffer.byteLength,
      )
    } catch (error) {
      if (!isPreconditionFailure(error)) {
        throw dependencies.explainError(error)
      }
    }

    try {
      const [metadata] = await file.getMetadata()
      const stored = verifyStoredCanonicalSource(input, metadata)
      const [storedBytes] = await file.download()
      if (
        storedBytes.byteLength !== input.buffer.byteLength ||
        createHash("sha256").update(storedBytes).digest("hex") !== input.sourceSha256
      ) {
        throw sourceIntegrityConflict()
      }

      return createStoredSourceFile(
        bucketLabel,
        storagePath,
        stored.fileName,
        stored.contentType,
        storedBytes.byteLength,
      )
    } catch (error) {
      if (error instanceof CorpusImportError) throw error
      throw dependencies.explainError(error)
    }
  }
}

export async function putCanonicalSourceEpub(
  input: PutCanonicalSourceEpubInput,
): Promise<StoredSourceFile> {
  return createPutCanonicalSourceEpub({
    bucketName,
    explainError: explainAdminCredentialError,
    getBucket: getAdminStorageBucket,
  })(input)
}

export class FirebaseCorpusBlobStore implements CorpusBlobStore {
  async putIfAbsent(input: PutCorpusBlobInput): Promise<StoredSourceFile> {
    return putCanonicalSourceEpub(input)
  }
}

export const __testOnly = {
  createPutCanonicalSourceEpub,
}

async function saveBuffer(params: {
  storagePath: string
  buffer: Buffer
  contentType: string
  downloadToken?: string
}): Promise<void> {
  const bucket = getAdminStorageBucket()
  const file = bucket.file(params.storagePath)
  const metadata: Record<string, unknown> = {
    contentType: params.contentType,
  }
  if (params.downloadToken) {
    metadata.metadata = { firebaseStorageDownloadTokens: params.downloadToken }
  }

  await file.save(params.buffer, {
    resumable: false,
    metadata,
  })
}

function firebaseDownloadUrl(storagePath: string, token: string): string {
  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucketName())}/o/${encodeURIComponent(storagePath)}?alt=media&token=${encodeURIComponent(token)}`
}

export async function uploadSourceEpub(
  docId: string,
  fileName: string,
  buffer: Buffer,
  contentType = "application/epub+zip",
  options: { source?: StorageDataSource } = {},
): Promise<StoredSourceFile> {
  return withStorageErrorContext(async () => {
    const safeName = sanitizeFileName(fileName)
    const storagePath = `${storagePrefixForSource(options.source)}/${docId}/source/${safeName}`

    await saveBuffer({
      storagePath,
      buffer,
      contentType,
    })

    return {
      bucket: bucketName(),
      storagePath,
      gsUri: `gs://${bucketName()}/${storagePath}`,
      fileName,
      contentType,
      sizeBytes: buffer.byteLength,
    }
  })
}

export async function uploadGeneratedImage(params: {
  docId: string
  chapterId: string
  runId: string
  sceneId: string
  buffer: Buffer
  contentType?: string
  fileExtension?: string
  source?: StorageDataSource
}): Promise<StoredGeneratedImage> {
  return withStorageErrorContext(async () => {
    const safeSceneId = sanitizePathSegment(params.sceneId, "scene")
    const fileExtension = (params.fileExtension ?? "png").replace(/^\./, "") || "png"
    const contentHash = createHash("sha256")
      .update(params.buffer)
      .digest("hex")
      .slice(0, 16)
    const fileName = `${safeSceneId}__${contentHash}.${fileExtension}`
    const storagePath = [
      storagePrefixForSource(params.source),
      params.docId,
      "chapters",
      params.chapterId,
      "assets",
      "vis4",
      safeSceneId,
      fileName,
    ].join("/")
    const contentType = params.contentType ?? "image/png"
    const downloadToken = randomUUID()

    await saveBuffer({
      storagePath,
      buffer: params.buffer,
      contentType,
      downloadToken,
    })

    const downloadUrl = firebaseDownloadUrl(storagePath, downloadToken)

    return {
      bucket: bucketName(),
      storagePath,
      gsUri: `gs://${bucketName()}/${storagePath}`,
      fileName,
      contentType,
      sizeBytes: params.buffer.byteLength,
      downloadUrl,
    }
  })
}

export async function uploadV3SemanticVectors(params: {
  docId: string
  chapterId: string
  runId: string
  payload: V3SemanticVectorPayload
  source?: StorageDataSource
}): Promise<StoredSemanticVectorBlob> {
  return withStorageErrorContext(async () => {
    const fileName = "vectors.json.gz"
    const storagePath = [
      storagePrefixForSource(params.source),
      sanitizePathSegment(params.docId, "document"),
      "chapters",
      sanitizePathSegment(params.chapterId, "chapter"),
      "runs",
      sanitizePathSegment(params.runId, "run"),
      "indexes",
      "idx2",
      fileName,
    ].join("/")
    const buffer = gzipSync(Buffer.from(JSON.stringify(params.payload), "utf8"))
    const contentHash = createHash("sha256").update(buffer).digest("hex")

    await saveBuffer({ storagePath, buffer, contentType: "application/gzip" })

    return {
      bucket: bucketName(),
      storagePath,
      gsUri: `gs://${bucketName()}/${storagePath}`,
      fileName,
      contentType: "application/gzip",
      sizeBytes: buffer.byteLength,
      contentHash,
    }
  })
}

export async function downloadV3SemanticVectors(params: {
  storagePath: string
  expectedContentHash: string
}): Promise<V3SemanticVectorPayload> {
  return withStorageErrorContext(async () => {
    const [buffer] = await getAdminStorageBucket().file(params.storagePath).download()
    const contentHash = createHash("sha256").update(buffer).digest("hex")
    if (contentHash !== params.expectedContentHash) {
      throw new Error("IDX.2 vector blob content hash mismatch")
    }
    return JSON.parse(gunzipSync(buffer).toString("utf8")) as V3SemanticVectorPayload
  })
}
