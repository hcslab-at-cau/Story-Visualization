import { errorResponse, okResponse, type BaseRequestBody } from "@/lib/api-utils"
import { loadStageResult, saveStageResult, stageKey } from "@/lib/firestore"
import { runSharedSupportRepresentation } from "@/lib/pipeline/support"
import type { SupportMemoryLog } from "@/types/schema"

export const maxDuration = 60

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as BaseRequestBody
    const { docId, chapterId, runId, parents = {} } = body

    const memoryLog = await loadStageResult<SupportMemoryLog>(docId, chapterId, runId, stageKey("SUP.0"))
    if (!memoryLog) return errorResponse("SUP.0 result not found", 400)

    const result = runSharedSupportRepresentation(memoryLog, docId, chapterId, {
      ...parents,
      "SUP.0": memoryLog.run_id,
    })

    await saveStageResult(docId, chapterId, runId, stageKey("SUP.1"), result)
    return okResponse(result)
  } catch (e) {
    return errorResponse(String(e))
  }
}
