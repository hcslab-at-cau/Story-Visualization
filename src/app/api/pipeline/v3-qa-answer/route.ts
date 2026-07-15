import { createLLMClient, errorResponse, okResponse, type BaseRequestBody } from "@/lib/api-utils"
import { parseFirestoreDataSource } from "@/lib/data-source"
import { loadStageResult, stageKey } from "@/lib/firestore"
import {
  buildV3QAAnswerContext,
  normalizeV3QAGroundedAnswer,
} from "@/lib/pipeline/v3-qa-answer"
import type { V3QAAnswerResult } from "@/lib/pipeline/v3-qa-answer-types"
import { formatJsonParam } from "@/lib/prompt-loader"
import {
  retrieveV3QAEvidenceForRun,
  V3QAPrerequisiteError,
} from "@/lib/server/v3-qa-retrieval-service"
import type { PreparedChapter } from "@/types/schema"

export const maxDuration = 300

interface V3QAAnswerRequestBody extends BaseRequestBody {
  question?: string
  progressEndPid?: number
  limit?: number
}
export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as V3QAAnswerRequestBody
    const { docId, chapterId, runId } = body
    const question = body.question?.trim() ?? ""
    if (!question) return errorResponse("Question is required", 400)
    if (typeof body.progressEndPid !== "number" || !Number.isInteger(body.progressEndPid) || body.progressEndPid < 0) {
      return errorResponse("progressEndPid must be a non-negative integer", 400)
    }

    const source = parseFirestoreDataSource(body.source)
    const [retrieval, preparedChapter] = await Promise.all([
      retrieveV3QAEvidenceForRun({
        docId,
        chapterId,
        runId,
        source,
        question,
        progressEndPid: body.progressEndPid,
        limit: body.limit,
      }),
      loadStageResult<PreparedChapter>(docId, chapterId, runId, stageKey("PRE.1"), { source }),
    ])
    if (!preparedChapter) return errorResponse("PRE.1 result not found - run PRE.1 first", 400)

    const context = buildV3QAAnswerContext({
      question,
      progressEndPid: body.progressEndPid,
      paragraphs: preparedChapter.raw_chapter.paragraphs,
      hits: retrieval.hits,
    })
    const raw = context.paragraphs.length > 0 && context.evidence.length > 0
      ? await createLLMClient(body).answerV3Question({
          question,
          progress_end_pid: String(body.progressEndPid),
          source_paragraphs_json: formatJsonParam(context.paragraphs),
          retrieval_evidence_json: formatJsonParam(context.evidence),
        })
      : {
          status: "insufficient_evidence",
          answer: "",
          citation_pids: [],
          used_evidence_ids: [],
        }

    const result: V3QAAnswerResult = {
      retrieval,
      answer: normalizeV3QAGroundedAnswer({ raw, context }),
    }
    return okResponse(result)
  } catch (error) {
    if (error instanceof V3QAPrerequisiteError) return errorResponse(error.message, error.status)
    return errorResponse(error instanceof Error ? error.message : String(error))
  }
}
