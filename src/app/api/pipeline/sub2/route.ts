import { loadStageResult, saveStageResult, stageKey } from "@/lib/firestore"
import { runSubsceneStateExtraction } from "@/lib/pipeline/sub2"
import { attachLLMDebug, createLLMClient, errorResponse, okResponse, type BaseRequestBody } from "@/lib/api-utils"
import type { SubsceneProposals, ScenePackets, GroundedSceneModel } from "@/types/schema"

export const maxDuration = 300

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as BaseRequestBody
    const { docId, chapterId, runId, parents = {} } = body

    const proposalLog = await loadStageResult<SubsceneProposals>(docId, chapterId, runId, stageKey("SUB.1"))
    if (!proposalLog) return errorResponse("SUB.1 result not found", 400)

    const packetLog = await loadStageResult<ScenePackets>(docId, chapterId, runId, stageKey("SCENE.1"))
    if (!packetLog) return errorResponse("SCENE.1 result not found", 400)

    const validatedLog = await loadStageResult<GroundedSceneModel>(docId, chapterId, runId, stageKey("SCENE.3"))
    if (!validatedLog) return errorResponse("SCENE.3 result not found", 400)

    const llm = createLLMClient(body)
    const result = attachLLMDebug(
      await runSubsceneStateExtraction(proposalLog, packetLog, validatedLog, llm, docId, chapterId, parents),
      llm,
    )

    await saveStageResult(docId, chapterId, runId, stageKey("SUB.2"), result)
    return okResponse(result)
  } catch (e) {
    return errorResponse(String(e))
  }
}
