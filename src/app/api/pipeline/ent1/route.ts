import { loadRawChapter, loadStageResult, saveStageResult, stageKey } from "@/lib/firestore"
import { runMentionExtraction } from "@/lib/pipeline/ent1"
import { attachLLMDebug, createLLMClient, errorResponse, okResponse, type BaseRequestBody } from "@/lib/api-utils"
import type { ContentUnits } from "@/types/schema"

export const maxDuration = 300

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as BaseRequestBody
    const { docId, chapterId, runId, parents = {} } = body

    const chapter = await loadRawChapter(docId, chapterId)
    if (!chapter) return errorResponse("Chapter not found", 404)

    const classifyLog = await loadStageResult<ContentUnits>(docId, chapterId, runId, stageKey("PRE.2"))
    if (!classifyLog) return errorResponse("PRE.2 result not found — run PRE.2 first", 400)

    const llm = createLLMClient(body)
    const result = attachLLMDebug(
      await runMentionExtraction(chapter, llm, docId, chapterId, classifyLog, parents),
      llm,
    )

    await saveStageResult(docId, chapterId, runId, stageKey("ENT.1"), result)
    return okResponse(result)
  } catch (e) {
    return errorResponse(String(e))
  }
}
