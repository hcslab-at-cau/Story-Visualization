import { parseFirestoreDataSource } from "@/lib/data-source"
import { errorResponse, okResponse, type BaseRequestBody } from "@/lib/api-utils"
import {
  retrieveV3QAEvidenceForRun,
  V3QAPrerequisiteError,
} from "@/lib/server/v3-qa-retrieval-service"

export const maxDuration = 300

interface V3QARetrieveRequestBody extends BaseRequestBody {
  question?: string
  progressEndPid?: number
  limit?: number
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as V3QARetrieveRequestBody
    const { docId, chapterId, runId } = body
    const question = body.question?.trim() ?? ""
    if (!question) return errorResponse("Question is required", 400)
    if (typeof body.progressEndPid !== "number" || !Number.isInteger(body.progressEndPid) || body.progressEndPid < 0) {
      return errorResponse("progressEndPid must be a non-negative integer", 400)
    }

    const source = parseFirestoreDataSource(body.source)

    const result = await retrieveV3QAEvidenceForRun({
      docId,
      chapterId,
      runId,
      source,
      question,
      progressEndPid: body.progressEndPid,
      limit: body.limit,
    })

    return okResponse(result)
  } catch (e) {
    if (e instanceof V3QAPrerequisiteError) return errorResponse(e.message, e.status)
    return errorResponse(String(e))
  }
}
