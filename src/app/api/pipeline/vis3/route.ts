import { loadStageResult, saveStageResult, stageKey } from "@/lib/firestore"
import { errorResponse, okResponse, type BaseRequestBody } from "@/lib/api-utils"
import { runRenderPackageCompilation } from "@/lib/pipeline/vis3"
import type { StageBlueprint } from "@/types/schema"

export const maxDuration = 60

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as BaseRequestBody
    const { docId, chapterId, runId, parents = {} } = body

    const blueprintLog = await loadStageResult<StageBlueprint>(docId, chapterId, runId, stageKey("VIS.2"))
    if (!blueprintLog) return errorResponse("VIS.2 result not found", 400)

    const result = runRenderPackageCompilation(blueprintLog, docId, chapterId, parents)

    await saveStageResult(docId, chapterId, runId, stageKey("VIS.3"), result)
    return okResponse(result)
  } catch (e) {
    return errorResponse(String(e))
  }
}
