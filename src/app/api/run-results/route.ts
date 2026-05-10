import { loadRunResults, parseFirestoreDataSource } from "@/lib/firestore"
import type { NextRequest } from "next/server"

export async function GET(request: NextRequest): Promise<Response> {
  const docId = request.nextUrl.searchParams.get("docId")
  const chapterId = request.nextUrl.searchParams.get("chapterId")
  const runId = request.nextUrl.searchParams.get("runId")
  const source = parseFirestoreDataSource(request.nextUrl.searchParams.get("source"))
  if (!docId || !chapterId || !runId) {
    return Response.json({ error: "docId, chapterId, and runId required" }, { status: 400 })
  }

  try {
    const results = await loadRunResults(docId, chapterId, runId, { source })
    return Response.json({ results })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
