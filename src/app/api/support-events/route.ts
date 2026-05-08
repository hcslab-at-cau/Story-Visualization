import { listReaderSupportEvents, saveReaderSupportEvent } from "@/lib/firestore"
import type { ReaderProblem, ReaderSupportEvent, SupportUnitKind } from "@/types/schema"
import type { NextRequest } from "next/server"

const SUPPORT_EVENT_ACTIONS = new Set<ReaderSupportEvent["action"]>([
  "shown",
  "opened",
  "dismissed",
  "suppressed",
])

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 160)
}

function parseLimit(value: string | null): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export async function GET(request: NextRequest): Promise<Response> {
  const docId = request.nextUrl.searchParams.get("docId")
  const sessionId = request.nextUrl.searchParams.get("sessionId") ?? undefined
  const maxEvents = parseLimit(request.nextUrl.searchParams.get("limit"))

  if (!docId) {
    return Response.json({ error: "docId required" }, { status: 400 })
  }

  try {
    const events = await listReaderSupportEvents(docId, { sessionId, maxEvents })
    return Response.json({ events })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as Partial<ReaderSupportEvent> & {
      docId?: string
      unit_kind?: SupportUnitKind
      reader_problem?: ReaderProblem
    }
    const docId = body.doc_id ?? body.docId
    const action = body.action

    if (!docId || !body.session_id || !body.scene_key || !body.unit_id || !action) {
      return Response.json({
        error: "doc_id/docId, session_id, scene_key, unit_id, and action required",
      }, { status: 400 })
    }
    if (!SUPPORT_EVENT_ACTIONS.has(action)) {
      return Response.json({ error: `Unsupported action: ${action}` }, { status: 400 })
    }

    const createdAt = body.created_at ?? new Date().toISOString()
    const eventId = body.event_id ?? safeId([
      body.session_id,
      body.scene_key,
      body.unit_id,
      action,
      createdAt,
    ].join(":"))
    const event: ReaderSupportEvent = {
      event_id: eventId,
      doc_id: docId,
      session_id: body.session_id,
      scene_key: body.scene_key,
      chapter_id: body.chapter_id,
      scene_id: body.scene_id,
      reader_run_id: body.reader_run_id,
      unit_id: body.unit_id,
      unit_kind: body.unit_kind,
      reader_problem: body.reader_problem,
      action,
      reason: body.reason,
      created_at: createdAt,
    }

    await saveReaderSupportEvent(event)
    return Response.json({ ok: true, event })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
