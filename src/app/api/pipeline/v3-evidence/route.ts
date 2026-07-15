import { parseFirestoreDataSource } from "@/lib/data-source"
import { loadRawChapter, loadStageResult, saveStageResult, stageKey } from "@/lib/firestore"
import { runV3EvidenceExtraction } from "@/lib/pipeline/v3-evidence"
import { isV3EvidencePassId, type V3EvidenceArtifact } from "@/lib/pipeline/v3-evidence-types"
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

export const maxDuration = 300

interface V3EvidenceRequestBody extends BaseRequestBody {
  passId?: unknown
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as V3EvidenceRequestBody
    const { docId, chapterId, runId, parents = {} } = body
    const source = parseFirestoreDataSource(body.source)
    const seedSource = parseFirestoreDataSource(body.seedSource ?? body.source)

    if (!isV3EvidencePassId(body.passId)) {
      return errorResponse("passId must be one of EVID.1A, EVID.1B, EVID.1C, EVID.1D", 400)
    }
    const passId = body.passId

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

    const execute = async (progress?: ProgressReporter): Promise<V3EvidenceArtifact> => {
      const llm = createLLMClient(body)
      const result = attachLLMDebug(
        await runV3EvidenceExtraction(
          passId,
          chapter,
          llm,
          docId,
          chapterId,
          classifyLog,
          parents,
          progress,
        ),
        llm,
      )

      await saveStageResult(docId, chapterId, runId, stageKey(passId), result, { source })
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
