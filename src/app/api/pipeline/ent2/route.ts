import { loadRawChapter, loadStageResult, saveStageResult, stageKey } from "@/lib/firestore"
import { runMentionValidation } from "@/lib/pipeline/ent2"
import { attachLLMDebug, createLLMClient, errorResponse, okResponse, type BaseRequestBody } from "@/lib/api-utils"
import type { MentionCandidates } from "@/types/schema"

export const maxDuration = 300

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as BaseRequestBody
    const { docId, chapterId, runId, parents = {} } = body

    const chapter = await loadRawChapter(docId, chapterId)
    if (!chapter) return errorResponse("Chapter not found", 404)

    const mentionLog = await loadStageResult<MentionCandidates>(docId, chapterId, runId, stageKey("ENT.1"))
    if (!mentionLog) return errorResponse("ENT.1 result not found", 400)

    const llm = createLLMClient(body)
    const result = attachLLMDebug(
      await runMentionValidation(chapter, mentionLog, llm, docId, chapterId, parents),
      llm,
    )

    await saveStageResult(docId, chapterId, runId, stageKey("ENT.2"), result)
    return okResponse(result)
  } catch (e) {
    return errorResponse(String(e))
  }
}
