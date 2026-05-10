import { saveRunStageModels } from "@/lib/firestore"
import type { StageId } from "@/types/schema"

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as {
      docId?: string
      chapterId?: string
      runId?: string
      stageModels?: Partial<Record<StageId, string>>
    }
    if (!body.docId || !body.chapterId || !body.runId || !body.stageModels) {
      return Response.json({ error: "docId, chapterId, runId, and stageModels required" }, { status: 400 })
    }

    await saveRunStageModels(body.docId, body.chapterId, body.runId, body.stageModels)
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
