/**
 * POST /api/epub — upload an EPUB file to Firebase Storage,
 * parse it, and save raw chapters to Firestore.
 * Returns { docId, chapters: ChapterMeta[] }
 */

import { parseEpub } from "@/lib/epub"
import { createDocument, saveRawChapter, listChapters, setDocumentSourceFile } from "@/lib/firestore"
import { uploadSourceEpub } from "@/lib/storage"

export const maxDuration = 120

export async function POST(request: Request): Promise<Response> {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const title = (formData.get("title") as string | null) ?? "Untitled"

    if (!file) {
      return Response.json({ error: "No file provided" }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const docId = await createDocument(title)
    const sourceFile = await uploadSourceEpub(
      docId,
      file.name,
      buffer,
      file.type || "application/epub+zip",
    )
    await setDocumentSourceFile(docId, sourceFile)

    const chapters = await parseEpub(buffer, docId)

    // Save all chapters in parallel
    await Promise.all(chapters.map((ch) => saveRawChapter(docId, ch)))

    const chapterMeta = await listChapters(docId)
    return Response.json({ docId, chapters: chapterMeta, sourceFile })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
