/**
 * Firebase Storage helpers for uploaded source files and generated assets.
 */

import { getDownloadURL, ref, uploadBytes } from "firebase/storage"
import { getStorageClient } from "./firebase"
import { createHash } from "crypto"

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

function sanitizeFileName(fileName: string): string {
  const cleaned = fileName
    .trim()
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
  return cleaned || "original.epub"
}

export async function uploadSourceEpub(
  docId: string,
  fileName: string,
  buffer: Buffer,
  contentType = "application/epub+zip",
): Promise<StoredSourceFile> {
  const storage = getStorageClient()
  const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "story-visualization-cb0e2.firebasestorage.app"
  const safeName = sanitizeFileName(fileName)
  const storagePath = `documents/${docId}/source/${safeName}`
  const storageRef = ref(storage, storagePath)

  await uploadBytes(storageRef, new Uint8Array(buffer), {
    contentType,
  })

  return {
    bucket,
    storagePath,
    gsUri: `gs://${bucket}/${storagePath}`,
    fileName,
    contentType,
    sizeBytes: buffer.byteLength,
  }
}

function sanitizePathSegment(value: string, fallback: string): string {
  const cleaned = value
    .trim()
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
  return cleaned || fallback
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
  const storage = getStorageClient()
  const bucket =
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ??
    "story-visualization-cb0e2.firebasestorage.app"
  const safeSceneId = sanitizePathSegment(params.sceneId, "scene")
  const fileExtension = (params.fileExtension ?? "png").replace(/^\./, "") || "png"
  const contentHash = createHash("sha256")
    .update(params.buffer)
    .digest("hex")
    .slice(0, 16)
  const fileName = `${safeSceneId}__${contentHash}.${fileExtension}`
  const storagePath = [
    "documents",
    params.docId,
    "chapters",
    params.chapterId,
    "assets",
    "vis4",
    safeSceneId,
    fileName,
  ].join("/")
  const storageRef = ref(storage, storagePath)
  const contentType = params.contentType ?? "image/png"

  await uploadBytes(storageRef, new Uint8Array(params.buffer), {
    contentType,
  })

  const downloadUrl = await getDownloadURL(storageRef)

  return {
    bucket,
    storagePath,
    gsUri: `gs://${bucket}/${storagePath}`,
    fileName,
    contentType,
    sizeBytes: params.buffer.byteLength,
    downloadUrl,
  }
}
