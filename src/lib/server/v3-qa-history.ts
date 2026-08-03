import { createHash } from "node:crypto"
import { z } from "zod"
import type {
  V3QAHistoryAnswerSnapshot,
  V3QAHistoryDeleteRequest,
  V3QAHistoryEntry,
  V3QAHistoryPage,
  V3QAHistoryScopeRequest,
} from "../v3-qa-history-types"

export const V3QA_HISTORY_MAX_BYTES = 800 * 1024
const HISTORY_PAGE_SIZE = 20
const HISTORY_SCHEMA_VERSION = "v3-qa-history-0.1" as const

const idSchema = z.string().trim().min(1).max(512)
const questionSchema = z.string().trim().min(1).max(4_000)
const nonNegativeInt = z.number().int().nonnegative()
const boundedText = z.string().max(200_000)

const citationSchema = z.object({
  pid: nonNegativeInt,
  paragraph_text: boundedText,
})

const usedEvidenceSchema = z.object({
  evidence_id: idSchema,
  record_id: idSchema,
  record_type: z.enum(["paragraph", "scene", "event", "character", "place", "object", "goal", "causal_edge"]),
  label: z.string().max(4_000),
})

const answerSchema = z.object({
  status: z.enum(["answered", "insufficient_evidence"]),
  text: boundedText,
  citations: z.array(citationSchema).max(200),
  used_evidence: z.array(usedEvidenceSchema).max(200),
})

const retrievalStatsSchema = z.object({
  total_records: nonNegativeInt,
  searched_records: nonNegativeInt,
  blocked_ahead_records: nonNegativeInt,
  direct_hits: nonNegativeInt,
  lexical_hits: nonNegativeInt,
  semantic_hits: nonNegativeInt,
  graph_neighbor_hits: nonNegativeInt,
  returned_hits: nonNegativeInt,
})

const retrievalHitSchema = z.object({
  record_id: idSchema,
  record_type: z.enum(["paragraph", "scene", "event", "character", "place", "object", "goal", "causal_edge"]),
  label: z.string().max(4_000),
  text: boundedText,
  score: z.number().finite(),
  match_kind: z.enum(["hybrid", "semantic", "lexical", "graph_neighbor"]),
  scene_id: idSchema.optional(),
  event_id: idSchema.optional(),
  text_span: z.object({
    start_pid: nonNegativeInt,
    end_pid: nonNegativeInt,
  }),
  progress_status: z.literal("available"),
  evidence_refs: z.array(idSchema).max(5_000),
  matched_terms: z.array(z.string().max(512)).max(1_000),
  semantic_similarity: z.number().finite().optional(),
})

const answerSnapshotSchema = z.object({
  answer: answerSchema,
  retrieval: z.object({
    stats: retrievalStatsSchema,
    hits: z.array(retrievalHitSchema).max(100),
  }),
})

const scopeRequestSchema = z.object({
  source: z.string(),
  docId: idSchema,
  chapterId: idSchema,
  runId: idSchema,
  cursor: z.string().max(2_000).optional(),
})

const createRequestSchema = scopeRequestSchema.omit({ cursor: true }).extend({
  question: questionSchema,
  progressEndPid: nonNegativeInt,
  answerSnapshot: answerSnapshotSchema,
})

const deleteRequestSchema = scopeRequestSchema.omit({ cursor: true }).extend({
  entryId: idSchema,
})

const cursorSchema = z.object({
  createdAtMs: nonNegativeInt,
  entryId: idSchema,
})

const storedEntrySchema = z.object({
  schema_version: z.literal(HISTORY_SCHEMA_VERSION),
  entry_id: idSchema,
  doc_id: idSchema,
  chapter_id: idSchema,
  run_id: idSchema,
  question: questionSchema,
  progress_end_pid: nonNegativeInt,
  answer_snapshot: answerSnapshotSchema,
  created_at: z.string().datetime(),
})

export class V3QAHistoryValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "V3QAHistoryValidationError"
  }
}

function validationError(error: unknown): V3QAHistoryValidationError {
  if (error instanceof V3QAHistoryValidationError) return error
  if (error instanceof z.ZodError) {
    return new V3QAHistoryValidationError(error.issues[0]?.message ?? "Invalid QA history input")
  }
  return new V3QAHistoryValidationError(error instanceof Error ? error.message : String(error))
}

export function validateV3QAHistoryCreateSource(source: unknown): "v3" {
  if (source !== "v3") throw new V3QAHistoryValidationError('source must be "v3"')
  return "v3"
}

export function createV3QAHistoryScopeId(chapterId: string, runId: string): string {
  return createHash("sha256").update(JSON.stringify([chapterId, runId])).digest("hex")
}

export interface V3QAHistoryCursor {
  createdAtMs: number
  entryId: string
}

export function encodeV3QAHistoryCursor(cursor: V3QAHistoryCursor): string {
  const parsed = cursorSchema.parse(cursor)
  return Buffer.from(JSON.stringify(parsed), "utf8").toString("base64url")
}

export function decodeV3QAHistoryCursor(cursor: string | null | undefined): V3QAHistoryCursor | null {
  if (!cursor) return null
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")))
  } catch {
    return null
  }
}

export interface NormalizedV3QAHistoryCreateInput {
  source: "v3"
  docId: string
  chapterId: string
  runId: string
  question: string
  progressEndPid: number
  answer_snapshot: V3QAHistoryAnswerSnapshot
}

export function normalizeV3QAHistoryCreateInput(input: unknown): NormalizedV3QAHistoryCreateInput {
  try {
    const parsed = createRequestSchema.parse(input)
    const source = validateV3QAHistoryCreateSource(parsed.source)
    const { answer, retrieval } = parsed.answerSnapshot

    if (answer.status === "answered" && !answer.text.trim()) {
      throw new V3QAHistoryValidationError("Answered history requires answer text")
    }
    if (answer.status === "insufficient_evidence"
      && (answer.text || answer.citations.length > 0 || answer.used_evidence.length > 0)) {
      throw new V3QAHistoryValidationError("Insufficient-evidence history cannot contain an answer or citations")
    }
    if (answer.citations.some((citation) => citation.pid > parsed.progressEndPid)) {
      throw new V3QAHistoryValidationError("Answer citations exceed the saved reading progress")
    }
    if (retrieval.hits.some((hit) => hit.text_span.start_pid > hit.text_span.end_pid
      || hit.text_span.end_pid > parsed.progressEndPid)) {
      throw new V3QAHistoryValidationError("Retrieval hits exceed the saved reading progress")
    }

    const answerSnapshot: V3QAHistoryAnswerSnapshot = {
      answer,
      retrieval,
    }
    const bytes = Buffer.byteLength(JSON.stringify({
      question: parsed.question,
      progress_end_pid: parsed.progressEndPid,
      answer_snapshot: answerSnapshot,
    }), "utf8")
    if (bytes > V3QA_HISTORY_MAX_BYTES) {
      throw new V3QAHistoryValidationError("QA history snapshot is too large to store")
    }

    return {
      source,
      docId: parsed.docId,
      chapterId: parsed.chapterId,
      runId: parsed.runId,
      question: parsed.question,
      progressEndPid: parsed.progressEndPid,
      answer_snapshot: answerSnapshot,
    }
  } catch (error) {
    throw validationError(error)
  }
}

export function normalizeV3QAHistoryScopeInput(input: unknown): V3QAHistoryScopeRequest & { source: "v3" } {
  try {
    const parsed = scopeRequestSchema.parse(input)
    return { ...parsed, source: validateV3QAHistoryCreateSource(parsed.source) }
  } catch (error) {
    throw validationError(error)
  }
}

export function normalizeV3QAHistoryDeleteInput(input: unknown): V3QAHistoryDeleteRequest & { source: "v3" } {
  try {
    const parsed = deleteRequestSchema.parse(input)
    return { ...parsed, source: validateV3QAHistoryCreateSource(parsed.source) }
  } catch (error) {
    throw validationError(error)
  }
}

export function normalizeV3QAHistoryStoredEntry(input: unknown): V3QAHistoryEntry {
  return storedEntrySchema.parse(input) as V3QAHistoryEntry
}

export function normalizeV3QAHistoryPage(
  orderedEntries: V3QAHistoryEntry[],
  pageSize = HISTORY_PAGE_SIZE,
): V3QAHistoryPage {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new Error("Invalid QA history page size")
  }
  const entries = orderedEntries.slice(0, pageSize)
  const hasMore = orderedEntries.length > pageSize
  const last = entries.at(-1)
  const createdAtMs = last ? Date.parse(last.created_at) : Number.NaN
  if (last && !Number.isFinite(createdAtMs)) throw new Error("Invalid QA history timestamp")

  return {
    entries,
    has_more: hasMore,
    next_cursor: hasMore && last
      ? encodeV3QAHistoryCursor({ createdAtMs, entryId: last.entry_id })
      : null,
  }
}
