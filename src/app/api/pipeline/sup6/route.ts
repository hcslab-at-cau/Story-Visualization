import { errorResponse, okResponse, type BaseRequestBody } from "@/lib/api-utils"
import { loadStageResult, saveStageResult, stageKey } from "@/lib/firestore"
import { runSupportPolicySelection } from "@/lib/pipeline/support"
import type {
  SupportCausalBridges,
  SupportCharacterRelations,
  SupportReentryReference,
  SupportSnapshots,
} from "@/types/schema"

export const maxDuration = 60

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as BaseRequestBody
    const { docId, chapterId, runId, parents = {} } = body

    const snapshots = await loadStageResult<SupportSnapshots>(docId, chapterId, runId, stageKey("SUP.2"))
    if (!snapshots) return errorResponse("SUP.2 result not found", 400)

    const causal = await loadStageResult<SupportCausalBridges>(docId, chapterId, runId, stageKey("SUP.3"))
    if (!causal) return errorResponse("SUP.3 result not found", 400)

    const characterRelations = await loadStageResult<SupportCharacterRelations>(docId, chapterId, runId, stageKey("SUP.4"))
    if (!characterRelations) return errorResponse("SUP.4 result not found", 400)

    const reentryReference = await loadStageResult<SupportReentryReference>(docId, chapterId, runId, stageKey("SUP.5"))
    if (!reentryReference) return errorResponse("SUP.5 result not found", 400)

    const result = runSupportPolicySelection(
      snapshots,
      causal,
      characterRelations,
      reentryReference,
      docId,
      chapterId,
      {
        ...parents,
        "SUP.2": snapshots.run_id,
        "SUP.3": causal.run_id,
        "SUP.4": characterRelations.run_id,
        "SUP.5": reentryReference.run_id,
      },
    )

    await saveStageResult(docId, chapterId, runId, stageKey("SUP.6"), result)
    return okResponse(result)
  } catch (e) {
    return errorResponse(String(e))
  }
}
