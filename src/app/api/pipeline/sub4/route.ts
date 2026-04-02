import { loadStageResult, saveStageResult, stageKey } from "@/lib/firestore"
import { runInterventionPackaging } from "@/lib/pipeline/sub4"
import { createLLMClient, errorResponse, okResponse, type BaseRequestBody } from "@/lib/api-utils"
import type { ValidatedSubscenes, ScenePackets, GroundedSceneModel } from "@/types/schema"

export const maxDuration = 300

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as BaseRequestBody
    const { docId, chapterId, runId, parents = {} } = body

    const validationLog = await loadStageResult<ValidatedSubscenes>(docId, chapterId, runId, stageKey("SUB.3"))
    if (!validationLog) return errorResponse("SUB.3 result not found", 400)

    const packetLog = await loadStageResult<ScenePackets>(docId, chapterId, runId, stageKey("SCENE.1"))
    if (!packetLog) return errorResponse("SCENE.1 result not found", 400)

    const validatedSceneLog = await loadStageResult<GroundedSceneModel>(docId, chapterId, runId, stageKey("SCENE.3"))
    if (!validatedSceneLog) return errorResponse("SCENE.3 result not found", 400)

    const llm = createLLMClient(body)
    const result = await runInterventionPackaging(validationLog, packetLog, validatedSceneLog, llm, docId, chapterId, parents)

    await saveStageResult(docId, chapterId, runId, stageKey("SUB.4"), result)
    return okResponse(result)
  } catch (e) {
    return errorResponse(String(e))
  }
}
