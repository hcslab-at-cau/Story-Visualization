/**
 * Firebase Storage helpers for original source files.
 */

import { ref, uploadBytes } from "firebase/storage"
import { getStorageClient } from "./firebase"

export interface StoredSourceFile {
  bucket: string
  storagePath: string
  gsUri: string
  fileName: string
  contentType: string
  sizeBytes: number
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
