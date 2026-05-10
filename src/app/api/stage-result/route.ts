import { deleteStageResult, loadStageResult, parseFirestoreDataSource } from "@/lib/firestore"
import type { StageId } from "@/types/schema"
import type { NextRequest } from "next/server"

export async function GET(request: NextRequest): Promise<Response> {
  const docId = request.nextUrl.searchParams.get("docId")
  const chapterId = request.nextUrl.searchParams.get("chapterId")
  const runId = request.nextUrl.searchParams.get("runId")
  const stageKey = request.nextUrl.searchParams.get("stageKey")
  const source = parseFirestoreDataSource(request.nextUrl.searchParams.get("source"))
  if (!docId || !chapterId || !runId || !stageKey) {
    return Response.json({ error: "docId, chapterId, runId, and stageKey required" }, { status: 400 })
  }

  try {
    const result = await loadStageResult(docId, chapterId, runId, stageKey, { source })
    return Response.json({ result })
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
      stageId?: StageId
    }
    if (!body.docId || !body.chapterId || !body.runId || !body.stageId) {
      return Response.json({ error: "docId, chapterId, runId, and stageId required" }, { status: 400 })
    }

    await deleteStageResult(body.docId, body.chapterId, body.runId, body.stageId)
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
