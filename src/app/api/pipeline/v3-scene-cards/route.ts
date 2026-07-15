import { parseFirestoreDataSource } from "@/lib/data-source"
import { loadStageResult, saveStageResult, stageKey } from "@/lib/firestore"
import { errorResponse, okResponse, type BaseRequestBody } from "@/lib/api-utils"
import { buildV3SceneSituationCards } from "@/lib/pipeline/v3-memory-frames"
import type { V3MemoryContractArtifact } from "@/lib/pipeline/v3-memory-contract-types"
import type { V3SceneSituationCardsArtifact } from "@/lib/pipeline/v3-memory-frames-types"

export const maxDuration = 300

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as BaseRequestBody
    const { docId, chapterId, runId, parents = {} } = body
    const source = parseFirestoreDataSource(body.source)

    const memoryContract = await loadStageResult<V3MemoryContractArtifact>(
      docId,
      chapterId,
      runId,
      stageKey("MEM.0"),
      { source },
    )
    if (!memoryContract) return errorResponse("MEM.0 result not found - run MEM.0 first", 400)

    const result: V3SceneSituationCardsArtifact = buildV3SceneSituationCards({
      docId,
      chapterId,
      parents,
      memoryContract,
    })

    await saveStageResult(docId, chapterId, runId, stageKey("MEM.1"), result, { source })
    return okResponse(result)
  } catch (e) {
    return errorResponse(String(e))
  }
}
