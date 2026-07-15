import { parseFirestoreDataSource } from "@/lib/data-source"
import { loadRawChapter, loadStageResult, saveStageResult, stageKey } from "@/lib/firestore"
import { runV3EvidenceRefinement } from "@/lib/pipeline/v3-evidence-refinement"
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
import type { V3EvidenceArtifact } from "@/lib/pipeline/v3-evidence-types"
import type { V3EvidenceRefinementArtifact } from "@/lib/pipeline/v3-evidence-refinement-types"

export const maxDuration = 300

const SOURCE_STAGE_IDS = ["EVID.1A", "EVID.1B", "EVID.1C", "EVID.1D"] as const

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

    const evidenceArtifacts: V3EvidenceArtifact[] = []
    for (const stageId of SOURCE_STAGE_IDS) {
      const artifact = await loadStageResult<V3EvidenceArtifact>(
        docId,
        chapterId,
        runId,
        stageKey(stageId),
        { source },
      )
      if (!artifact) return errorResponse(`${stageId} result not found - run all EVID.1 passes first`, 400)
      evidenceArtifacts.push(artifact)
    }

    const execute = async (progress?: ProgressReporter): Promise<V3EvidenceRefinementArtifact> => {
      const llm = createLLMClient(body)
      const result = attachLLMDebug(
        await runV3EvidenceRefinement(
          chapter,
          llm,
          docId,
          chapterId,
          classifyLog,
          evidenceArtifacts,
          parents,
          progress,
        ),
        llm,
      )

      await saveStageResult(docId, chapterId, runId, stageKey("EVID.2"), result, { source })
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
