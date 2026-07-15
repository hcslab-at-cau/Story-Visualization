import { parseFirestoreDataSource } from "@/lib/data-source"
import { loadRawChapter, loadStageResult, saveStageResult, stageKey } from "@/lib/firestore"
import { runV3MentionExtraction } from "@/lib/pipeline/v3-mentions"
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
import type { V3MentionCandidates } from "@/lib/pipeline/v3-mention-normalization"

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

    const execute = async (progress?: ProgressReporter): Promise<V3MentionCandidates> => {
      const llm = createLLMClient(body)
      const result = attachLLMDebug(
        await runV3MentionExtraction(chapter, llm, docId, chapterId, classifyLog, parents, progress),
        llm,
      )

      await saveStageResult(docId, chapterId, runId, stageKey("ENT.1"), result, { source })
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
