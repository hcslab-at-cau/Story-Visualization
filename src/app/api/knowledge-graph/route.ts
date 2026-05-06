import { loadKnowledgeGraph, projectKnowledgeGraphForRun } from "@/lib/firestore"
import type { KnowledgeGraphNodeKind } from "@/types/graph"
import type { NextRequest } from "next/server"

function parseDepth(value: string | null): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export async function GET(request: NextRequest): Promise<Response> {
  const docId = request.nextUrl.searchParams.get("docId")
  const chapterId = request.nextUrl.searchParams.get("chapterId")
  const runId = request.nextUrl.searchParams.get("runId")
  if (!docId || !chapterId || !runId) {
    return Response.json({ error: "docId, chapterId, and runId required" }, { status: 400 })
  }

  try {
    const graph = await loadKnowledgeGraph({
      docId,
      chapterId,
      runId,
      q: request.nextUrl.searchParams.get("q") ?? undefined,
      kind: (request.nextUrl.searchParams.get("kind") ?? undefined) as KnowledgeGraphNodeKind | "all" | undefined,
      nodeId: request.nextUrl.searchParams.get("nodeId") ?? undefined,
      depth: parseDepth(request.nextUrl.searchParams.get("depth")),
    })
    return Response.json({ graph })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as {
      docId?: string
      chapterId?: string
      runId?: string
    }
    if (!body.docId || !body.chapterId || !body.runId) {
      return Response.json({ error: "docId, chapterId, and runId required" }, { status: 400 })
    }

    const projection = await projectKnowledgeGraphForRun(body.docId, body.chapterId, body.runId)
    return Response.json({ ok: true, projection })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
