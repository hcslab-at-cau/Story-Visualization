import { loadRawChapter, loadStageResult, saveStageResult, stageKey } from "@/lib/firestore"
import { runEntityResolution } from "@/lib/pipeline/ent3"
import { toFilteredCandidates } from "@/lib/pipeline/ent2"
import { attachLLMDebug, createLLMClient, errorResponse, okResponse, type BaseRequestBody } from "@/lib/api-utils"
import type { FilteredMentions } from "@/types/schema"

export const maxDuration = 300

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as BaseRequestBody
    const { docId, chapterId, runId, parents = {} } = body

    const chapter = await loadRawChapter(docId, chapterId)
    if (!chapter) return errorResponse("Chapter not found", 404)

    const filteredLog = await loadStageResult<FilteredMentions>(docId, chapterId, runId, stageKey("ENT.2"))
    if (!filteredLog) return errorResponse("ENT.2 result not found", 400)

    const mentionLog = toFilteredCandidates(filteredLog)

    const llm = createLLMClient(body)
    const result = attachLLMDebug(
      await runEntityResolution(chapter, mentionLog, llm, docId, chapterId, parents),
      llm,
    )

    await saveStageResult(docId, chapterId, runId, stageKey("ENT.3"), result)
    return okResponse(result)
  } catch (e) {
    return errorResponse(String(e))
  }
}
