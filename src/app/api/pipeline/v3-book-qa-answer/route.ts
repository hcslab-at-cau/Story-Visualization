import { createLLMClient } from "@/lib/api-utils"
import { loadStageResultByArtifactId, stageKey } from "@/lib/firestore"
import {
  buildV3BookQAAnswerContext,
  insufficientV3BookQAGroundedAnswer,
  normalizeV3BookQAGroundedAnswer,
} from "@/lib/pipeline/v3-book-qa-answer"
import type {
  V3BookQAAnswerContext,
  V3BookQAAnswerChapterParagraphInput,
  V3BookQAAnswerResult,
} from "@/lib/pipeline/v3-book-qa-answer-types"
import { selectV3BookReadableChapters } from "@/lib/pipeline/v3-book-qa-corpus"
import type { V3BookQARetrievalHit } from "@/lib/pipeline/v3-book-qa-retrieval"
import type { V3BookReaderPosition } from "@/lib/pipeline/v3-book-qa-types"
import { formatJsonParam } from "@/lib/prompt-loader"
import {
  retrieveV3BookQAEvidenceForCorpus,
  V3BookQARequestError,
  type V3BookQARetrievalRequest,
} from "@/lib/server/v3-book-qa-retrieval-service"
import {
  createV3BookQACorpusStore,
  V3BookQACorpusImmutableConflictError,
  type StoredV3BookQACorpus,
} from "@/lib/server/v3-book-qa-corpus-store"
import type { PreparedChapter } from "@/types/schema"

export const maxDuration = 300

const REQUEST_KEYS = new Set([
  "source",
  "docId",
  "qaCorpusId",
  "question",
  "readerPosition",
  "limit",
  "model",
])

export interface V3BookQAAnswerRequest extends V3BookQARetrievalRequest {
  source: "v3"
  model?: string
}

export interface V3BookQAAnswerRouteDependencies {
  retrieve(request: V3BookQARetrievalRequest): Promise<Awaited<ReturnType<typeof retrieveV3BookQAEvidenceForCorpus>>>
  loadCorpus(docId: string, qaCorpusId: string): Promise<StoredV3BookQACorpus | null>
  loadExactPRE1(params: {
    docId: string
    chapterId: string
    runId: string
    artifactId: string
  }): Promise<PreparedChapter | null>
  answerModel(params: {
    request: V3BookQAAnswerRequest
    context: V3BookQAAnswerContext
  }): Promise<Record<string, unknown>>
}

function requestError(status: 400 | 404 | 409, code: string, message: string): V3BookQARequestError {
  return new V3BookQARequestError({ status, code, message })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function validId(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 1_500 ||
    value.trim() !== value ||
    value.includes("/") ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) throw requestError(400, "invalid_request", `${label} must be a valid non-empty ID`)
  return value
}

export function parseV3BookQAAnswerRequest(value: unknown): V3BookQAAnswerRequest {
  if (!isRecord(value)) throw requestError(400, "invalid_request", "Request body must be an object")
  const unexpected = Object.keys(value).find((key) => !REQUEST_KEYS.has(key))
  if (unexpected) throw requestError(400, "invalid_request", `Unexpected request field: ${unexpected}`)
  if (value.source !== "v3") throw requestError(400, "invalid_source", 'source must be exactly "v3"')
  const docId = validId(value.docId, "docId")
  const qaCorpusId = validId(value.qaCorpusId, "qaCorpusId")
  if (
    typeof value.question !== "string" ||
    value.question.length === 0 ||
    value.question.trim() !== value.question
  ) throw requestError(400, "invalid_request", "question must be non-empty and trimmed")
  if (
    !isRecord(value.readerPosition) ||
    Object.keys(value.readerPosition).sort().join(",") !== "chapter_id,pid"
  ) throw requestError(400, "invalid_reader_position", "readerPosition must contain only chapter_id and pid")
  const readerPosition: V3BookReaderPosition = {
    chapter_id: validId(value.readerPosition.chapter_id, "readerPosition.chapter_id"),
    pid: value.readerPosition.pid as number,
  }
  if (!Number.isSafeInteger(readerPosition.pid) || readerPosition.pid < 0) {
    throw requestError(400, "invalid_reader_position", "readerPosition.pid must be a non-negative integer")
  }
  if (
    value.limit !== undefined &&
    (!Number.isSafeInteger(value.limit) || (value.limit as number) < 1)
  ) throw requestError(400, "invalid_limit", "limit must be a positive integer")
  if (
    value.model !== undefined &&
    (typeof value.model !== "string" || value.model.length === 0 || value.model.trim() !== value.model)
  ) throw requestError(400, "invalid_model", "model must be a non-empty trimmed string")

  return {
    source: "v3",
    docId,
    qaCorpusId,
    question: value.question,
    readerPosition,
    ...(value.limit !== undefined ? { limit: value.limit as number } : {}),
    ...(value.model !== undefined ? { model: value.model as string } : {}),
  }
}

function progressSafeHit(
  hit: V3BookQARetrievalHit,
  readableThroughByChapter: Map<string, number>,
): boolean {
  const readableThrough = readableThroughByChapter.get(hit.chapter_id)
  return readableThrough !== undefined &&
    Number.isSafeInteger(hit.text_span?.start_pid) &&
    Number.isSafeInteger(hit.text_span?.end_pid) &&
    hit.text_span!.start_pid >= 0 &&
    hit.text_span!.end_pid >= hit.text_span!.start_pid &&
    hit.text_span!.end_pid <= readableThrough
}

function neededPidsByChapter(
  hits: V3BookQARetrievalHit[],
  readableThroughByChapter: Map<string, number>,
): Map<string, Set<number>> {
  const needed = new Map<string, Set<number>>()
  for (const hit of hits) {
    if (!progressSafeHit(hit, readableThroughByChapter)) continue
    const pids = needed.get(hit.chapter_id) ?? new Set<number>()
    for (let pid = hit.text_span!.start_pid; pid <= hit.text_span!.end_pid; pid += 1) pids.add(pid)
    needed.set(hit.chapter_id, pids)
  }
  return needed
}

function validatePreparedChapter(params: {
  artifact: PreparedChapter
  artifactId: string
  docId: string
  chapterId: string
  runId: string
}): void {
  const { artifact } = params
  if (
    artifact.stage_id !== "PRE.1" ||
    artifact.doc_id !== params.docId ||
    artifact.chapter_id !== params.chapterId ||
    artifact.run_id !== params.runId ||
    artifact.artifact_id !== params.artifactId ||
    artifact.raw_chapter?.chapter_id !== params.chapterId ||
    !Array.isArray(artifact.raw_chapter?.paragraphs)
  ) {
    throw requestError(409, "pre1_integrity_mismatch", `Pinned PRE.1 is invalid for ${params.chapterId}`)
  }
}

async function loadNeededChapterParagraphs(params: {
  dependencies: V3BookQAAnswerRouteDependencies
  request: V3BookQAAnswerRequest
  stored: StoredV3BookQACorpus
  hits: V3BookQARetrievalHit[]
}): Promise<V3BookQAAnswerChapterParagraphInput[]> {
  const readable = selectV3BookReadableChapters(
    params.stored.manifest,
    params.request.readerPosition,
  )
  const readableById = new Map(readable.map((chapter) => [chapter.chapter_id, chapter]))
  const readableThroughByChapter = new Map(
    readable.map((chapter) => [chapter.chapter_id, chapter.readable_through_pid]),
  )
  const neededByChapter = neededPidsByChapter(params.hits, readableThroughByChapter)
  const result: V3BookQAAnswerChapterParagraphInput[] = []

  for (const chapter of readable) {
    const neededPids = neededByChapter.get(chapter.chapter_id)
    if (!neededPids || neededPids.size === 0) continue
    const artifactId = chapter.artifact_ids["PRE.1"]
    if (!artifactId) {
      throw requestError(409, "pre1_not_ready", `Pinned PRE.1 is missing for ${chapter.chapter_id}`)
    }
    let prepared: PreparedChapter | null
    try {
      prepared = await params.dependencies.loadExactPRE1({
        docId: params.request.docId,
        chapterId: chapter.chapter_id,
        runId: chapter.run_id,
        artifactId,
      })
    } catch (error) {
      if (error instanceof Error && /does not match expected stage/i.test(error.message)) {
        throw requestError(409, "pre1_integrity_mismatch", error.message)
      }
      throw error
    }
    if (!prepared) {
      throw requestError(409, "pre1_not_ready", `Pinned PRE.1 was not found for ${chapter.chapter_id}`)
    }
    validatePreparedChapter({
      artifact: prepared,
      artifactId,
      docId: params.request.docId,
      chapterId: chapter.chapter_id,
      runId: chapter.run_id,
    })
    const paragraphsByPid = new Map<number, PreparedChapter["raw_chapter"]["paragraphs"][number]>()
    for (const paragraph of prepared.raw_chapter.paragraphs) {
      if (
        !Number.isSafeInteger(paragraph.pid) ||
        paragraph.pid < 0 ||
        typeof paragraph.text !== "string" ||
        paragraphsByPid.has(paragraph.pid)
      ) {
        throw requestError(409, "pre1_integrity_mismatch", `Pinned PRE.1 paragraphs are invalid for ${chapter.chapter_id}`)
      }
      paragraphsByPid.set(paragraph.pid, paragraph)
    }
    const orderedNeededPids = [...neededPids].sort((left, right) => left - right)
    const missingPids = orderedNeededPids.filter((pid) => !paragraphsByPid.has(pid))
    if (missingPids.length > 0) {
      throw requestError(409, "pre1_integrity_mismatch", `Pinned PRE.1 lacks needed paragraphs for ${chapter.chapter_id}`)
    }
    const selected = orderedNeededPids.map((pid) => ({
      pid,
      text: paragraphsByPid.get(pid)!.text,
    }))
    const expected = readableById.get(chapter.chapter_id)!
    result.push({
      chapter_id: chapter.chapter_id,
      chapter_title: expected.chapter_title,
      paragraphs: selected,
    })
  }
  return result
}

function defaultDependencies(): V3BookQAAnswerRouteDependencies {
  const store = createV3BookQACorpusStore()
  return {
    retrieve: retrieveV3BookQAEvidenceForCorpus,
    loadCorpus: (docId, qaCorpusId) => store.load(docId, qaCorpusId),
    loadExactPRE1: ({ docId, chapterId, artifactId }) =>
      loadStageResultByArtifactId<PreparedChapter>(
        docId,
        chapterId,
        artifactId,
        stageKey("PRE.1"),
        { source: "v3" },
      ),
    answerModel: ({ request, context }) => createLLMClient({
      docId: request.docId,
      chapterId: request.readerPosition.chapter_id,
      runId: request.qaCorpusId,
      source: "v3",
      model: request.model,
    }).answerV3BookQuestion({
      question: request.question,
      reader_position_json: formatJsonParam(request.readerPosition),
      source_paragraphs_json: formatJsonParam(context.paragraphs),
      retrieval_evidence_json: formatJsonParam(context.evidence),
    }),
  }
}

function errorResponse(error: unknown): Response {
  if (error instanceof SyntaxError) {
    return Response.json({ error: error.message, code: "invalid_json" }, { status: 400 })
  }
  if (error instanceof V3BookQARequestError) {
    return Response.json({
      error: error.message,
      code: error.code,
      ...(error.diagnostics.length > 0 ? { diagnostics: error.diagnostics } : {}),
    }, { status: error.status })
  }
  if (error instanceof V3BookQACorpusImmutableConflictError) {
    return Response.json({ error: error.message, code: error.code }, { status: 409 })
  }
  return Response.json({
    error: error instanceof Error ? error.message : String(error),
  }, { status: 500 })
}

export function createV3BookQAAnswerPostHandler(
  dependencies: V3BookQAAnswerRouteDependencies = defaultDependencies(),
): (request: Request) => Promise<Response> {
  return async function postV3BookQAAnswer(request: Request): Promise<Response> {
    try {
      const body = parseV3BookQAAnswerRequest(await request.json())
      const retrieval = await dependencies.retrieve({
        docId: body.docId,
        qaCorpusId: body.qaCorpusId,
        question: body.question,
        readerPosition: body.readerPosition,
        limit: body.limit,
      })
      if (retrieval.hits.length === 0) {
        const result: V3BookQAAnswerResult = {
          retrieval,
          answer: insufficientV3BookQAGroundedAnswer(),
        }
        return Response.json(result)
      }

      const stored = await dependencies.loadCorpus(body.docId, body.qaCorpusId)
      if (!stored) throw requestError(404, "corpus_not_found", "BOOK.1 corpus was not found")
      const chapterParagraphs = await loadNeededChapterParagraphs({
        dependencies,
        request: body,
        stored,
        hits: retrieval.hits,
      })
      const context = buildV3BookQAAnswerContext({
        question: body.question,
        manifest: stored.manifest,
        readerPosition: body.readerPosition,
        chapterParagraphs,
        hits: retrieval.hits,
      })
      if (context.paragraphs.length === 0 || context.evidence.length === 0) {
        const result: V3BookQAAnswerResult = {
          retrieval,
          answer: insufficientV3BookQAGroundedAnswer(),
        }
        return Response.json(result)
      }

      const raw = await dependencies.answerModel({ request: body, context })
      const result: V3BookQAAnswerResult = {
        retrieval,
        answer: normalizeV3BookQAGroundedAnswer({ raw, context }),
      }
      return Response.json(result)
    } catch (error) {
      return errorResponse(error)
    }
  }
}

const defaultPostHandler = createV3BookQAAnswerPostHandler()

export async function POST(request: Request): Promise<Response> {
  return defaultPostHandler(request)
}
