import {
  loadDocumentMeta,
  loadRawChapter,
  loadStageResult,
  parseFirestoreDataSource,
  stageKey,
} from "@/lib/firestore"
import {
  buildState3BoundaryExport,
  state3BoundaryExportFilename,
  type State3BoundaryExportUnit,
} from "@/lib/state3-export"
import type { SceneBoundaries } from "@/types/schema"
import type { NextRequest } from "next/server"

function parseExportUnit(value: string | null): State3BoundaryExportUnit {
  return value === "paragraph" ? "paragraph" : "sentence"
}

function contentDispositionHeader(filename: string): string {
  const asciiFallback = filename
    .replace(/[^\x20-\x7E]+/g, "_")
    .replace(/["\\]/g, "_")
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

export async function GET(request: NextRequest): Promise<Response> {
  const docId = request.nextUrl.searchParams.get("docId")
  const chapterId = request.nextUrl.searchParams.get("chapterId")
  const runId = request.nextUrl.searchParams.get("runId")
  const unit = parseExportUnit(request.nextUrl.searchParams.get("unit"))
  const source = parseFirestoreDataSource(request.nextUrl.searchParams.get("source"))

  if (!docId || !chapterId || !runId) {
    return Response.json({ error: "docId, chapterId, and runId required" }, { status: 400 })
  }

  try {
    const [documentMeta, chapter, boundaryLog] = await Promise.all([
      loadDocumentMeta(docId, { source }),
      loadRawChapter(docId, chapterId, { source }),
      loadStageResult<SceneBoundaries>(docId, chapterId, runId, stageKey("STATE.3"), { source }),
    ])

    if (!chapter) {
      return Response.json({ error: "Chapter not found" }, { status: 404 })
    }
    if (!boundaryLog) {
      return Response.json({ error: "STATE.3 result not found" }, { status: 404 })
    }

    const exportData = buildState3BoundaryExport(chapter, boundaryLog, unit)
    const filename = state3BoundaryExportFilename({
      workTitle: documentMeta?.title ?? chapter.title,
      chapterId: chapter.chapter_id,
      unit,
    })

    return new Response(JSON.stringify(exportData, null, 2), {
      headers: {
        "Content-Disposition": contentDispositionHeader(filename),
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
