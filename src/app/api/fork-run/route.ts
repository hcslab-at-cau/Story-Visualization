import { forkRunResults } from "@/lib/firestore"
import type { StageId } from "@/types/schema"

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as {
      docId?: string
      chapterId?: string
      sourceRunId?: string
      targetRunId?: string
      stagesToCopy?: StageId[]
    }
    if (!body.docId || !body.chapterId || !body.sourceRunId || !body.targetRunId || !body.stagesToCopy) {
      return Response.json({ error: "docId, chapterId, sourceRunId, targetRunId, and stagesToCopy required" }, { status: 400 })
    }

    await forkRunResults(
      body.docId,
      body.chapterId,
      body.sourceRunId,
      body.targetRunId,
      body.stagesToCopy,
    )
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
