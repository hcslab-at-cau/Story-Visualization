/**
 * POST /api/epub — import an EPUB into canonical corpus storage and ensure a
 * source-specific workspace points at the completed revision.
 */

import { randomUUID } from "node:crypto"
import {
  CorpusImportError,
  importCorpusEpub,
  type CorpusImportDependencies,
} from "@/lib/corpus-import"
import { parseFirestoreDataSource } from "@/lib/data-source"
import { parseEpub } from "@/lib/epub"
import { chapterMetaFromRawChapters } from "@/lib/firestore"
import { FirestoreCorpusImportRepository } from "@/lib/server/firestore-corpus-import-store"
import { FirebaseCorpusBlobStore } from "@/lib/storage"

export const maxDuration = 120

function importDependencies(): CorpusImportDependencies {
  return {
    repository: new FirestoreCorpusImportRepository(),
    blobStore: new FirebaseCorpusBlobStore(),
    parseEpub,
    now: () => new Date(),
    createClaimToken: () => randomUUID(),
  }
}

function formString(formData: FormData, name: string): string | undefined {
  const value = formData.get(name)
  return typeof value === "string" ? value : undefined
}

export async function POST(request: Request): Promise<Response> {
  try {
    const formData = await request.formData()
    const fileValue = formData.get("file")
    if (!(fileValue instanceof File)) {
      return Response.json({ error: "No file provided" }, { status: 400 })
    }

    const sourceValue = formString(formData, "source")
    const result = await importCorpusEpub({
      buffer: Buffer.from(await fileValue.arrayBuffer()),
      fileName: fileValue.name,
      contentType: fileValue.type || "application/epub+zip",
      title: formString(formData, "title") ?? "Untitled",
      bookId: formString(formData, "bookId"),
      source: parseFirestoreDataSource(sourceValue),
    }, importDependencies())

    return Response.json({
      docId: result.docId,
      chapters: chapterMetaFromRawChapters(result.chapters),
      sourceFile: result.sourceFile,
      bookId: result.bookId,
      corpusRevisionId: result.corpusRevisionId,
      reused: result.reused,
    })
  } catch (error) {
    if (error instanceof CorpusImportError) {
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.statusCode },
      )
    }
    return Response.json({ error: "Failed to import EPUB" }, { status: 500 })
  }
}
