import { loadStageResult, saveStageResult, stageKey } from "@/lib/firestore"
import { runOverlayRefinement } from "@/lib/pipeline/final2"
import { errorResponse, okResponse, type BaseRequestBody } from "@/lib/api-utils"
import type { SceneReaderPackageLog, StageBlueprint } from "@/types/schema"

export const maxDuration = 300

interface Final2Body extends BaseRequestBody {
  visionModel?: string
  visionApiKey?: string
  visionApiBase?: string
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as Final2Body
    const { docId, chapterId, runId, parents = {}, visionModel, visionApiKey, visionApiBase } = body

    const sceneReaderLog = await loadStageResult<SceneReaderPackageLog>(docId, chapterId, runId, stageKey("FINAL.1"))
    if (!sceneReaderLog) return errorResponse("FINAL.1 result not found", 400)

    const blueprintLog = await loadStageResult<StageBlueprint>(docId, chapterId, runId, stageKey("VIS.2"))

    // Create vision LLM client only if credentials are provided
    const llm = visionModel && visionApiKey
      ? new (await import("@/lib/llm-client")).LLMClient(visionModel, visionApiKey, visionApiBase)
      : undefined

    const result = await runOverlayRefinement(
      sceneReaderLog, docId, chapterId, parents,
      llm,
      blueprintLog ?? undefined,
    )

    await saveStageResult(docId, chapterId, runId, stageKey("FINAL.2"), result)
    return okResponse(result)
  } catch (e) {
    return errorResponse(String(e))
  }
}
