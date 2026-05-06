import { errorResponse, okResponse, type BaseRequestBody } from "@/lib/api-utils"
import { loadStageResult, saveStageResult, stageKey } from "@/lib/firestore"
import { runReaderSupportPackage } from "@/lib/pipeline/support"
import type { SharedSupportRepresentation, SupportPolicySelection } from "@/types/schema"

export const maxDuration = 60

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as BaseRequestBody
    const { docId, chapterId, runId, parents = {} } = body

    const policyLog = await loadStageResult<SupportPolicySelection>(docId, chapterId, runId, stageKey("SUP.6"))
    if (!policyLog) return errorResponse("SUP.6 result not found", 400)

    const sharedLog = await loadStageResult<SharedSupportRepresentation>(docId, chapterId, runId, stageKey("SUP.1"))
    if (!sharedLog) return errorResponse("SUP.1 result not found", 400)

    const result = runReaderSupportPackage(policyLog, sharedLog, docId, chapterId, {
      ...parents,
      "SUP.1": sharedLog.run_id,
      "SUP.6": policyLog.run_id,
    })

    await saveStageResult(docId, chapterId, runId, stageKey("SUP.7"), result)
    return okResponse(result)
  } catch (e) {
    return errorResponse(String(e))
  }
}
