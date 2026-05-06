import { listDocuments, parseFirestoreDataSource } from "@/lib/firestore"
import type { NextRequest } from "next/server"

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const source = parseFirestoreDataSource(request.nextUrl.searchParams.get("source"))
    const documents = await listDocuments({ source })
    return Response.json({ documents })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
