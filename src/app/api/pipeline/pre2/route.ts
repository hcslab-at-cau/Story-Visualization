import { loadRawChapter, loadStageResult, saveStageResult, stageKey } from "@/lib/firestore"
import { parseFirestoreDataSource } from "@/lib/data-source"
import { runContentClassification } from "@/lib/pipeline/pre2"
import { attachLLMDebug, createLLMClient, errorResponse, okResponse, type BaseRequestBody } from "@/lib/api-utils"
import type { PreparedChapter } from "@/types/schema"

export const maxDuration = 300

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as BaseRequestBody
    const { docId, chapterId, runId, parents = {} } = body
    const source = parseFirestoreDataSource(body.source)
    const seedSource = parseFirestoreDataSource(body.seedSource ?? body.source)

    const prepared = await loadStageResult<PreparedChapter>(docId, chapterId, runId, stageKey("PRE.1"), { source })
    if (!prepared) return errorResponse("PRE.1 result not found — run PRE.1 first", 400)

    const chapter = await loadRawChapter(docId, chapterId, { source: seedSource })
    if (!chapter) return errorResponse("Chapter not found", 404)

    const llm = createLLMClient(body)
    const result = attachLLMDebug(
      await runContentClassification(chapter, llm, docId, chapterId, parents),
      llm,
    )

    await saveStageResult(docId, chapterId, runId, stageKey("PRE.2"), result, { source })
    return okResponse(result)
  } catch (e) {
    return errorResponse(String(e))
  }
}
