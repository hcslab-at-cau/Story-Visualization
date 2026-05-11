import { loadBookMemorySnapshot } from "@/lib/firestore"
import { queryNarrativeGraphSnapshot } from "@/lib/narrative-graph"
import type { SupportContextKind } from "@/types/support-context"
import type { NextRequest } from "next/server"

export async function GET(request: NextRequest): Promise<Response> {
  const docId = request.nextUrl.searchParams.get("docId")
  const bookRunId = request.nextUrl.searchParams.get("bookRunId") ?? undefined
  const chapterId = request.nextUrl.searchParams.get("chapterId") ?? undefined
  const sceneId = request.nextUrl.searchParams.get("sceneId") ?? undefined
  const supportKind = (request.nextUrl.searchParams.get("supportKind") ?? "all") as SupportContextKind

  if (!docId) {
    return Response.json({ error: "docId required" }, { status: 400 })
  }

  try {
    const snapshot = await loadBookMemorySnapshot(docId, bookRunId)
    if (!snapshot) {
      return Response.json({ error: "BOOK.0 snapshot not found" }, { status: 404 })
    }

    const graph = queryNarrativeGraphSnapshot(snapshot, {
      chapterId,
      sceneId,
      supportKind,
    })
    return Response.json({ graph })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

