/**
 * GET /api/chapters?docId=xxx — list chapters for a document
 */

import { listChapters, parseFirestoreDataSource } from "@/lib/firestore"
import type { NextRequest } from "next/server"

export async function GET(request: NextRequest): Promise<Response> {
  const docId = request.nextUrl.searchParams.get("docId")
  const source = parseFirestoreDataSource(request.nextUrl.searchParams.get("source"))
  if (!docId) return Response.json({ error: "docId required" }, { status: 400 })

  try {
    const chapters = await listChapters(docId, { source })
    return Response.json({ chapters })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
