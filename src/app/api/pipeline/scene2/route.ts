import { loadStageResult, saveStageResult, stageKey } from "@/lib/firestore"
import { runSceneIndexExtraction } from "@/lib/pipeline/scene2"
import { createLLMClient, errorResponse, okResponse, type BaseRequestBody } from "@/lib/api-utils"
import type { ScenePackets } from "@/types/schema"

export const maxDuration = 300

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as BaseRequestBody
    const { docId, chapterId, runId, parents = {} } = body

    const packetLog = await loadStageResult<ScenePackets>(docId, chapterId, runId, stageKey("SCENE.1"))
    if (!packetLog) return errorResponse("SCENE.1 result not found", 400)

    const llm = createLLMClient(body)
    const result = await runSceneIndexExtraction(packetLog, llm, docId, chapterId, parents)

    await saveStageResult(docId, chapterId, runId, stageKey("SCENE.2"), result)
    return okResponse(result)
  } catch (e) {
    return errorResponse(String(e))
  }
}
