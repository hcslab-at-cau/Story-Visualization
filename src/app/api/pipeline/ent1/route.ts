import { loadRawChapter, loadStageResult, saveStageResult, stageKey } from "@/lib/firestore"
import { runMentionExtraction } from "@/lib/pipeline/ent1"
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
import type { ContentUnits, MentionCandidates } from "@/types/schema"

export const maxDuration = 300

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as BaseRequestBody
    const { docId, chapterId, runId, parents = {} } = body

    const chapter = await loadRawChapter(docId, chapterId)
    if (!chapter) return errorResponse("Chapter not found", 404)

    const classifyLog = await loadStageResult<ContentUnits>(docId, chapterId, runId, stageKey("PRE.2"))
    if (!classifyLog) return errorResponse("PRE.2 result not found — run PRE.2 first", 400)

    const execute = async (progress?: ProgressReporter): Promise<MentionCandidates> => {
      const llm = createLLMClient(body)
      const result = attachLLMDebug(
        await runMentionExtraction(chapter, llm, docId, chapterId, classifyLog, parents, progress),
        llm,
      )

      await saveStageResult(docId, chapterId, runId, stageKey("ENT.1"), result)
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
