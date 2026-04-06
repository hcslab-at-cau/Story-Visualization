import { loadRawChapter, loadStageResult, saveStageResult, stageKey } from "@/lib/firestore"
import { runSceneReaderPackage } from "@/lib/pipeline/final1"
import { errorResponse, okResponse, type BaseRequestBody } from "@/lib/api-utils"
import type {
  GroundedSceneModel,
  RenderedImages,
  ScenePackets,
  SceneBoundaries,
  ValidatedSubscenes,
  InterventionPackages,
  StageBlueprint,
} from "@/types/schema"

export const maxDuration = 60

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as BaseRequestBody
    const { docId, chapterId, runId, parents = {} } = body

    const chapter = await loadRawChapter(docId, chapterId)
    if (!chapter) return errorResponse("Chapter not found", 404)

    const groundedLog = await loadStageResult<GroundedSceneModel>(docId, chapterId, runId, stageKey("SCENE.3"))
    if (!groundedLog) return errorResponse("SCENE.3 result not found", 400)

    const sub3Log = await loadStageResult<ValidatedSubscenes>(docId, chapterId, runId, stageKey("SUB.3"))
    if (!sub3Log) return errorResponse("SUB.3 result not found", 400)

    const packetLog = await loadStageResult<ScenePackets>(docId, chapterId, runId, stageKey("SCENE.1"))
    if (!packetLog) return errorResponse("SCENE.1 result not found", 400)

    const boundaryLog = await loadStageResult<SceneBoundaries>(docId, chapterId, runId, stageKey("STATE.3"))
    if (!boundaryLog) return errorResponse("STATE.3 result not found", 400)

    // Optional upstream artifacts
    const blueprintLog = await loadStageResult<StageBlueprint>(docId, chapterId, runId, stageKey("VIS.2"))
    const interventionLog = await loadStageResult<InterventionPackages>(docId, chapterId, runId, stageKey("SUB.4"))
    const renderedImagesLog = await loadStageResult<RenderedImages>(docId, chapterId, runId, stageKey("VIS.4"))

    const result = runSceneReaderPackage(
      groundedLog, sub3Log, packetLog, boundaryLog, chapter, docId, chapterId, parents,
      blueprintLog ?? undefined, interventionLog ?? undefined, renderedImagesLog ?? undefined,
    )

    await saveStageResult(docId, chapterId, runId, stageKey("FINAL.1"), result)
    return okResponse(result)
  } catch (e) {
    return errorResponse(String(e))
  }
}
