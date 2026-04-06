import { loadStageResult, saveStageResult, stageKey } from "@/lib/firestore"
import { errorResponse, okResponse, type BaseRequestBody } from "@/lib/api-utils"
import { runImageGeneration } from "@/lib/pipeline/vis4"
import type { RenderPackage } from "@/types/schema"

export const maxDuration = 300

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as BaseRequestBody
    const { docId, chapterId, runId, parents = {}, model } = body

    const renderPackage = await loadStageResult<RenderPackage>(docId, chapterId, runId, stageKey("VIS.3"))
    if (!renderPackage) return errorResponse("VIS.3 result not found", 400)

    const result = await runImageGeneration(renderPackage, docId, chapterId, runId, parents, model)

    await saveStageResult(docId, chapterId, runId, stageKey("VIS.4"), result)
    return okResponse(result)
  } catch (e) {
    return errorResponse(String(e))
  }
}
