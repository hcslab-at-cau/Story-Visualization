import { loadStageResult, saveStageResult, stageKey } from "@/lib/firestore"
import { runSemanticClarification } from "@/lib/pipeline/vis1"
import {
  attachLLMDebug,
  createLLMClient,
  errorResponse,
  okResponse,
  type BaseRequestBody,
} from "@/lib/api-utils"
import type { GroundedSceneModel, ScenePackets } from "@/types/schema"

export const maxDuration = 300

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as BaseRequestBody
    const { docId, chapterId, runId, parents = {} } = body

    const packetLog = await loadStageResult<ScenePackets>(docId, chapterId, runId, stageKey("SCENE.1"))
    if (!packetLog) return errorResponse("SCENE.1 result not found", 400)

    const groundedLog = await loadStageResult<GroundedSceneModel>(
      docId,
      chapterId,
      runId,
      stageKey("SCENE.3"),
    )
    if (!groundedLog) return errorResponse("SCENE.3 result not found", 400)

    const llm = createLLMClient(body)
    const result = attachLLMDebug(
      await runSemanticClarification(packetLog, groundedLog, llm, docId, chapterId, parents),
      llm,
    )

    await saveStageResult(docId, chapterId, runId, stageKey("VIS.1"), result)
    return okResponse(result)
  } catch (e) {
    return errorResponse(String(e))
  }
}
