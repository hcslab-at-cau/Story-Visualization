/**
 * Firebase Storage helpers for uploaded source files and generated assets.
 *
 * This module is server-only in practice: API routes use Firebase Admin SDK so
 * Storage rules do not block uploads from the application backend.
 */

import { createHash, randomUUID } from "crypto"
import { explainAdminCredentialError, getAdminStorageBucket } from "./firebase-admin"

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

const CURRENT_STORAGE_PREFIX = "documents_v2"

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
): Promise<StoredSourceFile> {
  return withStorageErrorContext(async () => {
    const safeName = sanitizeFileName(fileName)
    const storagePath = `${CURRENT_STORAGE_PREFIX}/${docId}/source/${safeName}`

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
      CURRENT_STORAGE_PREFIX,
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
