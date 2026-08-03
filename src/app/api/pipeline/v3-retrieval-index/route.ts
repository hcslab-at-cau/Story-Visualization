import { parseFirestoreDataSource } from "@/lib/data-source"
import { loadStageResult, saveStageResult, stageKey } from "@/lib/firestore"
import { errorResponse, okResponse, type BaseRequestBody } from "@/lib/api-utils"
import { buildV3RetrievalIndex } from "@/lib/pipeline/v3-narrative-memory"
import type { V3EvidenceClusteringArtifact } from "@/lib/pipeline/v3-evidence-clustering-types"
import type { V3EventFramesArtifact, V3SceneSituationCardsArtifact } from "@/lib/pipeline/v3-memory-frames-types"
import type {
  V3CausalEdgesArtifact,
  V3GoalGroundingArtifact,
  V3ProgressiveNarrativeMemoryArtifact,
  V3RetrievalIndexArtifact,
} from "@/lib/pipeline/v3-narrative-memory-types"
import type { ContentUnits, PreparedChapter } from "@/types/schema"

export const maxDuration = 300

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as BaseRequestBody
    const { docId, chapterId, runId, parents = {} } = body
    const source = parseFirestoreDataSource(body.source)

    const preparedChapter = await loadStageResult<PreparedChapter>(docId, chapterId, runId, stageKey("PRE.1"), { source })
    if (!preparedChapter) return errorResponse("PRE.1 result not found - run PRE.1 first", 400)

    const contentUnits = await loadStageResult<ContentUnits>(docId, chapterId, runId, stageKey("PRE.2"), { source })
    if (!contentUnits) return errorResponse("PRE.2 result not found - run PRE.2 first", 400)

    const evidenceClusters = await loadStageResult<V3EvidenceClusteringArtifact>(docId, chapterId, runId, stageKey("EVID.4"), { source })
    if (!evidenceClusters) return errorResponse("EVID.4 result not found - run EVID.4 first", 400)

    const sceneCards = await loadStageResult<V3SceneSituationCardsArtifact>(docId, chapterId, runId, stageKey("MEM.1"), { source })
    if (!sceneCards) return errorResponse("MEM.1 result not found - run MEM.1 first", 400)

    const eventFrames = await loadStageResult<V3EventFramesArtifact>(docId, chapterId, runId, stageKey("EVENT.2"), { source })
    if (!eventFrames) return errorResponse("EVENT.2 result not found - run EVENT.2 first", 400)

    const groundedGoals = await loadStageResult<V3GoalGroundingArtifact>(docId, chapterId, runId, stageKey("GOAL.1"), { source })
    if (!groundedGoals) return errorResponse("GOAL.1 result not found - run GOAL.1 first", 400)

    const causalEdges = await loadStageResult<V3CausalEdgesArtifact>(docId, chapterId, runId, stageKey("CAUS.1"), { source })
    if (!causalEdges) return errorResponse("CAUS.1 result not found - run CAUS.1 first", 400)

    const progressiveMemory = await loadStageResult<V3ProgressiveNarrativeMemoryArtifact>(docId, chapterId, runId, stageKey("MEM.2"), { source })
    if (!progressiveMemory) return errorResponse("MEM.2 result not found - run MEM.2 first", 400)

    const result: V3RetrievalIndexArtifact = buildV3RetrievalIndex({
      docId,
      chapterId,
      parents,
      preparedChapter,
      contentUnits,
      evidenceClusters,
      sceneCards,
      eventFrames,
      groundedGoals,
      causalEdges,
      progressiveMemory,
    })

    await saveStageResult(docId, chapterId, runId, stageKey("IDX.1"), result, { source })
    return okResponse(result)
  } catch (e) {
    return errorResponse(String(e))
  }
}
