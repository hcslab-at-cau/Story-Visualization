import { loadRawChapter, loadStageResult, saveStageResult, stageKey } from "@/lib/firestore"
import { runScenePacketBuilder } from "@/lib/pipeline/scene1"
import { errorResponse, okResponse, type BaseRequestBody } from "@/lib/api-utils"
import type { SceneBoundaries, RefinedStateFrames, StateFrames, EntityGraph } from "@/types/schema"

export const maxDuration = 60

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as BaseRequestBody
    const { docId, chapterId, runId, parents = {} } = body

    const chapter = await loadRawChapter(docId, chapterId)
    if (!chapter) return errorResponse("Chapter not found", 404)

    const boundaryLog = await loadStageResult<SceneBoundaries>(docId, chapterId, runId, stageKey("STATE.3"))
    if (!boundaryLog) return errorResponse("STATE.3 result not found", 400)

    const validatedLog = await loadStageResult<RefinedStateFrames>(docId, chapterId, runId, stageKey("STATE.2"))
    if (!validatedLog) return errorResponse("STATE.2 result not found", 400)

    const stateLog = await loadStageResult<StateFrames>(docId, chapterId, runId, stageKey("STATE.1"))
    if (!stateLog) return errorResponse("STATE.1 result not found", 400)

    const entityLog = await loadStageResult<EntityGraph>(docId, chapterId, runId, stageKey("ENT.3"))
    if (!entityLog) return errorResponse("ENT.3 result not found", 400)

    const result = runScenePacketBuilder(boundaryLog, validatedLog, stateLog, entityLog, chapter, docId, chapterId, parents)

    await saveStageResult(docId, chapterId, runId, stageKey("SCENE.1"), result)
    return okResponse(result)
  } catch (e) {
    return errorResponse(String(e))
  }
}
