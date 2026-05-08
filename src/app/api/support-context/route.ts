import { loadBookMemorySnapshot } from "@/lib/firestore"
import { buildSupportContext } from "@/lib/support-context"
import type { SupportContextKind } from "@/types/support-context"
import type { NextRequest } from "next/server"

function parsePid(value: string | null): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export async function GET(request: NextRequest): Promise<Response> {
  const docId = request.nextUrl.searchParams.get("docId")
  const chapterId = request.nextUrl.searchParams.get("chapterId")
  const sceneId = request.nextUrl.searchParams.get("sceneId")
  const bookRunId = request.nextUrl.searchParams.get("bookRunId") ?? undefined
  const supportKind = (request.nextUrl.searchParams.get("supportKind") ?? "all") as SupportContextKind

  if (!docId || !chapterId || !sceneId) {
    return Response.json({ error: "docId, chapterId, and sceneId required" }, { status: 400 })
  }

  try {
    const snapshot = await loadBookMemorySnapshot(docId, bookRunId)
    if (!snapshot) {
      return Response.json({ error: "BOOK.0 snapshot not found" }, { status: 404 })
    }

    const context = buildSupportContext(snapshot, {
      chapterId,
      sceneId,
      supportKind,
      readerPosition: {
        chapterId: request.nextUrl.searchParams.get("readerChapterId") ?? chapterId,
        sceneId: request.nextUrl.searchParams.get("readerSceneId") ?? sceneId,
        pid: parsePid(request.nextUrl.searchParams.get("readerPid")),
      },
    })
    return Response.json({ context })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
