import { loadStageResult, saveStageResult, stageKey } from "@/lib/firestore"
import { runOverlayRefinement } from "@/lib/pipeline/final2"
import { attachLLMDebug, createLLMClient, errorResponse, okResponse, type BaseRequestBody } from "@/lib/api-utils"
import type { SceneReaderPackageLog, StageBlueprint } from "@/types/schema"

export const maxDuration = 300

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as BaseRequestBody
    const { docId, chapterId, runId, parents = {} } = body

    const sceneReaderLog = await loadStageResult<SceneReaderPackageLog>(docId, chapterId, runId, stageKey("FINAL.1"))
    if (!sceneReaderLog) return errorResponse("FINAL.1 result not found", 400)

    const blueprintLog = await loadStageResult<StageBlueprint>(docId, chapterId, runId, stageKey("VIS.2"))

    const llm = createLLMClient(body)

    const result = attachLLMDebug(
      await runOverlayRefinement(
        sceneReaderLog, docId, chapterId, parents,
        llm,
        blueprintLog ?? undefined,
      ),
      llm,
    )

    await saveStageResult(docId, chapterId, runId, stageKey("FINAL.2"), result)
    return okResponse(result)
  } catch (e) {
    return errorResponse(String(e))
  }
}
