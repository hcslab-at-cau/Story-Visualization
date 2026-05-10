import { errorResponse, okResponse, type BaseRequestBody } from "@/lib/api-utils"
import { loadStageResult, saveStageResult, stageKey } from "@/lib/firestore"
import { runSupportSnapshots } from "@/lib/pipeline/support"
import type { SharedSupportRepresentation } from "@/types/schema"

export const maxDuration = 60

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as BaseRequestBody
    const { docId, chapterId, runId, parents = {} } = body

    const sharedLog = await loadStageResult<SharedSupportRepresentation>(docId, chapterId, runId, stageKey("SUP.1"))
    if (!sharedLog) return errorResponse("SUP.1 result not found", 400)

    const result = runSupportSnapshots(sharedLog, docId, chapterId, {
      ...parents,
      "SUP.1": sharedLog.run_id,
    })

    await saveStageResult(docId, chapterId, runId, stageKey("SUP.2"), result)
    return okResponse(result)
  } catch (e) {
    return errorResponse(String(e))
  }
}
