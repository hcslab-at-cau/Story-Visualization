import {
  buildAndSaveBookMemorySnapshot,
  loadBookMemorySnapshot,
} from "@/lib/firestore"
import type { NextRequest } from "next/server"

export async function GET(request: NextRequest): Promise<Response> {
  const docId = request.nextUrl.searchParams.get("docId")
  const bookRunId = request.nextUrl.searchParams.get("bookRunId") ?? undefined
  if (!docId) {
    return Response.json({ error: "docId required" }, { status: 400 })
  }

  try {
    const snapshot = await loadBookMemorySnapshot(docId, bookRunId)
    return Response.json({ snapshot })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as {
      docId?: string
      runId?: string
      bookRunId?: string
      chapterRunIds?: Record<string, string>
    }
    if (!body.docId) {
      return Response.json({ error: "docId required" }, { status: 400 })
    }

    const snapshot = await buildAndSaveBookMemorySnapshot({
      docId: body.docId,
      runId: body.runId,
      bookRunId: body.bookRunId,
      chapterRunIds: body.chapterRunIds,
    })
    return Response.json({ ok: true, snapshot })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

