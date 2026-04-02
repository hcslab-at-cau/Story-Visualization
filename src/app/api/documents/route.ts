import { listDocuments } from "@/lib/firestore"

export async function GET(): Promise<Response> {
  try {
    const documents = await listDocuments()
    return Response.json({ documents })
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 })
  }
}
