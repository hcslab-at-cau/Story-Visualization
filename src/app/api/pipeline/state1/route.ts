import { loadRawChapter, loadStageResult, saveStageResult, stageKey } from "@/lib/firestore"
import { runStateTracking } from "@/lib/pipeline/state1"
import { errorResponse, okResponse, type BaseRequestBody } from "@/lib/api-utils"
import type { EntityGraph } from "@/types/schema"

export const maxDuration = 60

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as BaseRequestBody
    const { docId, chapterId, runId, parents = {} } = body

    const chapter = await loadRawChapter(docId, chapterId)
    if (!chapter) return errorResponse("Chapter not found", 404)

    const entityLog = await loadStageResult<EntityGraph>(docId, chapterId, runId, stageKey("ENT.3"))
    if (!entityLog) return errorResponse("ENT.3 result not found", 400)

    const result = runStateTracking(entityLog, chapter, docId, chapterId, parents)

    await saveStageResult(docId, chapterId, runId, stageKey("STATE.1"), result)
    return okResponse(result)
  } catch (e) {
    return errorResponse(String(e))
  }
}
