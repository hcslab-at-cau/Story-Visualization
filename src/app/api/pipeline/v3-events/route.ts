import { parseFirestoreDataSource } from "@/lib/data-source"
import { loadRawChapter, loadStageResult, saveStageResult, stageKey } from "@/lib/firestore"
import { runV3EventGrouping } from "@/lib/pipeline/v3-event-grouping"
import {
  attachLLMDebug,
  createLLMClient,
  errorResponse,
  okResponse,
  progressStreamResponse,
  wantsProgressStream,
  type BaseRequestBody,
  type ProgressReporter,
} from "@/lib/api-utils"
import type { ContentUnits } from "@/types/schema"
import type { V3EvidenceClusteringArtifact } from "@/lib/pipeline/v3-evidence-clustering-types"
import type { V3EvidenceGateArtifact } from "@/lib/pipeline/v3-evidence-gate-types"
import type { V3EvidenceRefinementArtifact } from "@/lib/pipeline/v3-evidence-refinement-types"
import type { V3EventGroupingArtifact } from "@/lib/pipeline/v3-event-types"

export const maxDuration = 300

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as BaseRequestBody
    const { docId, chapterId, runId, parents = {} } = body
    const source = parseFirestoreDataSource(body.source)
    const seedSource = parseFirestoreDataSource(body.seedSource ?? body.source)

    const chapter = await loadRawChapter(docId, chapterId, { source: seedSource })
    if (!chapter) return errorResponse("Chapter not found", 404)

    const classifyLog = await loadStageResult<ContentUnits>(
      docId,
      chapterId,
      runId,
      stageKey("PRE.2"),
      { source },
    )
    if (!classifyLog) return errorResponse("PRE.2 result not found - run PRE.2 first", 400)

    const evidenceRefinement = await loadStageResult<V3EvidenceRefinementArtifact>(
      docId,
      chapterId,
      runId,
      stageKey("EVID.2"),
      { source },
    )
    if (!evidenceRefinement) return errorResponse("EVID.2 result not found - run EVID.2 first", 400)

    const evidenceClustering = await loadStageResult<V3EvidenceClusteringArtifact>(
      docId,
      chapterId,
      runId,
      stageKey("EVID.4"),
      { source },
    )
    if (!evidenceClustering) return errorResponse("EVID.4 result not found - run EVID.4 first", 400)

    const evidenceGate = await loadStageResult<V3EvidenceGateArtifact>(
      docId,
      chapterId,
      runId,
      stageKey("EVID.3"),
      { source },
    )
    if (!evidenceGate) return errorResponse("EVID.3 result not found - run EVID.3 first", 400)

    const execute = async (progress?: ProgressReporter): Promise<V3EventGroupingArtifact> => {
      const llm = createLLMClient(body)
      const result = attachLLMDebug(
        await runV3EventGrouping(
          chapter,
          llm,
          docId,
          chapterId,
          classifyLog,
          evidenceRefinement,
          evidenceGate,
          evidenceClustering,
          parents,
          progress,
        ),
        llm,
      )

      await saveStageResult(docId, chapterId, runId, stageKey("EVENT.1"), result, { source })
      return result
    }

    if (wantsProgressStream(request)) {
      return progressStreamResponse((progress) => execute(progress))
    }

    return okResponse(await execute())
  } catch (e) {
    return errorResponse(String(e))
  }
}
