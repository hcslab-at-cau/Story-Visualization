import { parseFirestoreDataSource } from "@/lib/data-source"
import { loadStageResult, saveStageResult, stageKey } from "@/lib/firestore"
import { errorResponse, okResponse, type BaseRequestBody } from "@/lib/api-utils"
import { buildV3CausalEdges } from "@/lib/pipeline/v3-narrative-memory"
import type { V3MemoryContractArtifact } from "@/lib/pipeline/v3-memory-contract-types"
import type { V3EventFramesArtifact } from "@/lib/pipeline/v3-memory-frames-types"
import type { V3CausalEdgesArtifact, V3GoalGroundingArtifact } from "@/lib/pipeline/v3-narrative-memory-types"

export const maxDuration = 300

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as BaseRequestBody
    const { docId, chapterId, runId, parents = {} } = body
    const source = parseFirestoreDataSource(body.source)

    const memoryContract = await loadStageResult<V3MemoryContractArtifact>(docId, chapterId, runId, stageKey("MEM.0"), { source })
    if (!memoryContract) return errorResponse("MEM.0 result not found - run MEM.0 first", 400)

    const eventFrames = await loadStageResult<V3EventFramesArtifact>(docId, chapterId, runId, stageKey("EVENT.2"), { source })
    if (!eventFrames) return errorResponse("EVENT.2 result not found - run EVENT.2 first", 400)

    const groundedGoals = await loadStageResult<V3GoalGroundingArtifact>(docId, chapterId, runId, stageKey("GOAL.1"), { source })
    if (!groundedGoals) return errorResponse("GOAL.1 result not found - run GOAL.1 first", 400)

    const result: V3CausalEdgesArtifact = buildV3CausalEdges({
      docId,
      chapterId,
      parents,
      memoryContract,
      eventFrames,
      groundedGoals,
    })

    await saveStageResult(docId, chapterId, runId, stageKey("CAUS.1"), result, { source })
    return okResponse(result)
  } catch (e) {
    return errorResponse(String(e))
  }
}
