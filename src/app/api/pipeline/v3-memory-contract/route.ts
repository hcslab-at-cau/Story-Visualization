import { parseFirestoreDataSource } from "@/lib/data-source"
import { loadStageResult, saveStageResult, stageKey } from "@/lib/firestore"
import { errorResponse, okResponse } from "@/lib/api-utils"
import { buildV3MemoryContract } from "@/lib/pipeline/v3-memory-contract"
import type { BaseRequestBody } from "@/lib/api-utils"
import type { V3EventGroupingArtifact } from "@/lib/pipeline/v3-event-types"
import type { V3MemoryContractArtifact } from "@/lib/pipeline/v3-memory-contract-types"
import type { V3SceneGroupingArtifact } from "@/lib/pipeline/v3-scene-types"

export const maxDuration = 300

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as BaseRequestBody
    const { docId, chapterId, runId, parents = {} } = body
    const source = parseFirestoreDataSource(body.source)

    const eventGrouping = await loadStageResult<V3EventGroupingArtifact>(
      docId,
      chapterId,
      runId,
      stageKey("EVENT.1"),
      { source },
    )
    if (!eventGrouping) return errorResponse("EVENT.1 result not found - run EVENT.1 first", 400)

    const sceneGrouping = await loadStageResult<V3SceneGroupingArtifact>(
      docId,
      chapterId,
      runId,
      stageKey("SCENE.0"),
      { source },
    )
    if (!sceneGrouping) return errorResponse("SCENE.0 result not found - run SCENE.0 first", 400)

    const result: V3MemoryContractArtifact = buildV3MemoryContract({
      docId,
      chapterId,
      parents,
      eventGrouping,
      sceneGrouping,
    })

    await saveStageResult(docId, chapterId, runId, stageKey("MEM.0"), result, { source })
    return okResponse(result)
  } catch (e) {
    return errorResponse(String(e))
  }
}
