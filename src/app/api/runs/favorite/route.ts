import { setRunFavorite } from "@/lib/firestore"

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as {
      docId?: string
      chapterId?: string
      runId?: string
      favorite?: boolean
    }
    if (!body.docId || !body.chapterId || !body.runId || typeof body.favorite !== "boolean") {
      return Response.json({ error: "docId, chapterId, runId, and favorite required" }, { status: 400 })
    }

    await setRunFavorite(body.docId, body.chapterId, body.runId, body.favorite)
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
