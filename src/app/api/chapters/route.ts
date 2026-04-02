/**
 * GET /api/chapters?docId=xxx — list chapters for a document
 */

import { listChapters } from "@/lib/firestore"
import type { NextRequest } from "next/server"

export async function GET(request: NextRequest): Promise<Response> {
  const docId = request.nextUrl.searchParams.get("docId")
  if (!docId) return Response.json({ error: "docId required" }, { status: 400 })

  try {
    const chapters = await listChapters(docId)
    return Response.json({ chapters })
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 })
  }
}
