import { cleanupDocumentStorage } from "@/lib/firestore"

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as { docId?: string }
    if (!body.docId) {
      return Response.json({ error: "docId required" }, { status: 400 })
    }

    const cleanup = await cleanupDocumentStorage(body.docId)
    return Response.json({ ok: true, cleanup })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
