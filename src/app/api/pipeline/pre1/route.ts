import { loadRawChapter, saveStageResult, stageKey } from "@/lib/firestore"
import { runRawChapterPreparation } from "@/lib/pipeline/pre1"
import { errorResponse, okResponse, type BaseRequestBody } from "@/lib/api-utils"

export const maxDuration = 300

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as BaseRequestBody
    const { docId, chapterId, runId, parents = {} } = body

    const chapter = await loadRawChapter(docId, chapterId)
    if (!chapter) return errorResponse("Chapter not found", 404)

    const result = await runRawChapterPreparation(chapter, docId, chapterId, parents)

    await saveStageResult(docId, chapterId, runId, stageKey("PRE.1"), result)
    return okResponse(result)
  } catch (e) {
    return errorResponse(String(e))
  }
}
