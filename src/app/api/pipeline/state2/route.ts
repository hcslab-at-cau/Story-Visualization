import { loadRawChapter, loadStageResult, saveStageResult, stageKey } from "@/lib/firestore"
import { runStateValidation } from "@/lib/pipeline/state2"
import { createLLMClient, errorResponse, okResponse, type BaseRequestBody } from "@/lib/api-utils"
import type { StateFrames, EntityGraph, ContentUnits } from "@/types/schema"

export const maxDuration = 300

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as BaseRequestBody
    const { docId, chapterId, runId, parents = {} } = body

    const chapter = await loadRawChapter(docId, chapterId)
    if (!chapter) return errorResponse("Chapter not found", 404)

    const stateLog = await loadStageResult<StateFrames>(docId, chapterId, runId, stageKey("STATE.1"))
    if (!stateLog) return errorResponse("STATE.1 result not found", 400)

    const entityLog = await loadStageResult<EntityGraph>(docId, chapterId, runId, stageKey("ENT.3"))
    if (!entityLog) return errorResponse("ENT.3 result not found", 400)

    const classifyLog = await loadStageResult<ContentUnits>(docId, chapterId, runId, stageKey("PRE.2"))
    if (!classifyLog) return errorResponse("PRE.2 result not found", 400)

    const llm = createLLMClient(body)
    const result = await runStateValidation(stateLog, entityLog, chapter, classifyLog, llm, docId, chapterId, parents)

    await saveStageResult(docId, chapterId, runId, stageKey("STATE.2"), result)
    return okResponse(result)
  } catch (e) {
    return errorResponse(String(e))
  }
}
