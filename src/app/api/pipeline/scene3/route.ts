import { loadStageResult, saveStageResult, stageKey } from "@/lib/firestore"
import { runSceneIndexValidation } from "@/lib/pipeline/scene3"
import { attachLLMDebug, createLLMClient, errorResponse, okResponse, type BaseRequestBody } from "@/lib/api-utils"
import type { ScenePackets, SceneIndexDraft, EntityGraph, RefinedStateFrames } from "@/types/schema"

export const maxDuration = 300

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as BaseRequestBody
    const { docId, chapterId, runId, parents = {} } = body

    const packetLog = await loadStageResult<ScenePackets>(docId, chapterId, runId, stageKey("SCENE.1"))
    if (!packetLog) return errorResponse("SCENE.1 result not found", 400)

    const indexLog = await loadStageResult<SceneIndexDraft>(docId, chapterId, runId, stageKey("SCENE.2"))
    if (!indexLog) return errorResponse("SCENE.2 result not found", 400)

    const entityLog = await loadStageResult<EntityGraph>(docId, chapterId, runId, stageKey("ENT.3"))
    if (!entityLog) return errorResponse("ENT.3 result not found", 400)

    const validatedLog = await loadStageResult<RefinedStateFrames>(docId, chapterId, runId, stageKey("STATE.2"))
    if (!validatedLog) return errorResponse("STATE.2 result not found", 400)

    const llm = createLLMClient(body)
    const result = attachLLMDebug(
      await runSceneIndexValidation(packetLog, indexLog, entityLog, validatedLog, llm, docId, chapterId, parents),
      llm,
    )

    await saveStageResult(docId, chapterId, runId, stageKey("SCENE.3"), result)
    return okResponse(result)
  } catch (e) {
    return errorResponse(String(e))
  }
}
