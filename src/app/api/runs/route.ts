import { deleteRun, listRuns, parseFirestoreDataSource } from "@/lib/firestore"
import type { NextRequest } from "next/server"

export async function GET(request: NextRequest): Promise<Response> {
  const docId = request.nextUrl.searchParams.get("docId")
  const chapterId = request.nextUrl.searchParams.get("chapterId")
  const source = parseFirestoreDataSource(request.nextUrl.searchParams.get("source"))
  if (!docId || !chapterId) {
    return Response.json({ error: "docId and chapterId required" }, { status: 400 })
  }

  try {
    const runs = await listRuns(docId, chapterId, undefined, { source })
    return Response.json({ runs })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as {
      docId?: string
      chapterId?: string
      runId?: string
    }
    if (!body.docId || !body.chapterId || !body.runId) {
      return Response.json({ error: "docId, chapterId, and runId required" }, { status: 400 })
    }

    await deleteRun(body.docId, body.chapterId, body.runId)
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
