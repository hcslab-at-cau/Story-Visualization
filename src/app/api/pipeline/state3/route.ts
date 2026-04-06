import { loadRawChapter, loadStageResult, saveStageResult, stageKey } from "@/lib/firestore"
import { runBoundaryDetection } from "@/lib/pipeline/state3"
import { attachLLMDebug, createLLMClient, errorResponse, okResponse, type BaseRequestBody } from "@/lib/api-utils"
import type { RefinedStateFrames, StateFrames } from "@/types/schema"

export const maxDuration = 120

interface State3Body extends BaseRequestBody {
  generateTitles?: boolean
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as State3Body
    const { docId, chapterId, runId, parents = {}, generateTitles = true } = body

    const chapter = await loadRawChapter(docId, chapterId)
    if (!chapter) return errorResponse("Chapter not found", 404)

    const validatedLog = await loadStageResult<RefinedStateFrames>(docId, chapterId, runId, stageKey("STATE.2"))
    if (!validatedLog) return errorResponse("STATE.2 result not found", 400)

    const stateLog = await loadStageResult<StateFrames>(docId, chapterId, runId, stageKey("STATE.1"))

    const llm = generateTitles ? createLLMClient(body) : undefined
    const paragraphMap = new Map(chapter.paragraphs.map((p) => [p.pid, p.text]))

    const result = attachLLMDebug(
      await runBoundaryDetection(
        validatedLog, docId, chapterId, parents, stateLog ?? undefined, llm, paragraphMap,
      ),
      llm,
    )

    await saveStageResult(docId, chapterId, runId, stageKey("STATE.3"), result)
    return okResponse(result)
  } catch (e) {
    return errorResponse(String(e))
  }
}
