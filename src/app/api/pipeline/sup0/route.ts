import { errorResponse, okResponse, type BaseRequestBody } from "@/lib/api-utils"
import { loadStageResult, saveStageResult, stageKey } from "@/lib/firestore"
import { runSupportMemoryBuild } from "@/lib/pipeline/support"
import type {
  GroundedSceneModel,
  SceneBoundaries,
  ScenePackets,
  ValidatedSubscenes,
} from "@/types/schema"

export const maxDuration = 60

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as BaseRequestBody
    const { docId, chapterId, runId, parents = {} } = body

    const packetLog = await loadStageResult<ScenePackets>(docId, chapterId, runId, stageKey("SCENE.1"))
    if (!packetLog) return errorResponse("SCENE.1 result not found", 400)

    const boundaryLog = await loadStageResult<SceneBoundaries>(docId, chapterId, runId, stageKey("STATE.3"))
    if (!boundaryLog) return errorResponse("STATE.3 result not found", 400)

    const groundedLog = await loadStageResult<GroundedSceneModel>(docId, chapterId, runId, stageKey("SCENE.3"))
    if (!groundedLog) return errorResponse("SCENE.3 result not found", 400)

    const sub3Log = await loadStageResult<ValidatedSubscenes>(docId, chapterId, runId, stageKey("SUB.3"))

    const result = runSupportMemoryBuild(
      packetLog,
      boundaryLog,
      groundedLog,
      sub3Log ?? undefined,
      docId,
      chapterId,
      {
        ...parents,
        "SCENE.1": packetLog.run_id,
        "STATE.3": boundaryLog.run_id,
        "SCENE.3": groundedLog.run_id,
        ...(sub3Log ? { "SUB.3": sub3Log.run_id } : {}),
      },
    )

    await saveStageResult(docId, chapterId, runId, stageKey("SUP.0"), result)
    return okResponse(result)
  } catch (e) {
    return errorResponse(String(e))
  }
}
