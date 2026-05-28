import {
  loadRawChapter,
  loadStageResult,
  parseFirestoreDataSource,
  stageKey,
} from "@/lib/firestore"
import {
  buildState3BoundaryExport,
  state3BoundaryExportFilename,
} from "@/lib/state3-export"
import type { SceneBoundaries } from "@/types/schema"
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
    const [chapter, boundaryLog] = await Promise.all([
      loadRawChapter(docId, chapterId, { source }),
      loadStageResult<SceneBoundaries>(docId, chapterId, runId, stageKey("STATE.3"), { source }),
    ])

    if (!chapter) {
      return Response.json({ error: "Chapter not found" }, { status: 404 })
    }
    if (!boundaryLog) {
      return Response.json({ error: "STATE.3 result not found" }, { status: 404 })
    }

    const exportData = buildState3BoundaryExport(chapter, boundaryLog)
    const filename = state3BoundaryExportFilename(exportData.doc_id)

    return new Response(JSON.stringify(exportData, null, 2), {
      headers: {
        "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Content-Type": "application/json; charset=utf-8",
      },
    })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
