import { errorResponse, okResponse } from "@/lib/api-utils"
import {
  deleteV3QAHistoryEntry,
  listV3QAHistoryEntries,
  saveV3QAHistoryEntry,
} from "@/lib/firestore"
import {
  normalizeV3QAHistoryCreateInput,
  normalizeV3QAHistoryDeleteInput,
  normalizeV3QAHistoryScopeInput,
  V3QAHistoryValidationError,
} from "@/lib/server/v3-qa-history"

function historyErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error)
  const status = error instanceof V3QAHistoryValidationError || error instanceof SyntaxError ? 400 : 500
  return errorResponse(message, status)
}

export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams
    const input = normalizeV3QAHistoryScopeInput({
      source: params.get("source"),
      docId: params.get("docId"),
      chapterId: params.get("chapterId"),
      runId: params.get("runId"),
      cursor: params.get("cursor") ?? undefined,
    })
    return okResponse(await listV3QAHistoryEntries(input))
  } catch (error) {
    return historyErrorResponse(error)
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const input = normalizeV3QAHistoryCreateInput(await request.json())
    return okResponse(await saveV3QAHistoryEntry(input))
  } catch (error) {
    return historyErrorResponse(error)
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const input = normalizeV3QAHistoryDeleteInput(await request.json())
    const deleted = await deleteV3QAHistoryEntry(input)
    return deleted ? okResponse({ ok: true }) : errorResponse("QA history entry not found", 404)
  } catch (error) {
    return historyErrorResponse(error)
  }
}
