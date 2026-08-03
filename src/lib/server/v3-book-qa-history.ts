import { createHash } from "node:crypto"
import { z } from "zod"
import {
  fingerprintV3BookQACorpus,
  selectV3BookReadableChapters,
} from "../pipeline/v3-book-qa-corpus"
import {
  V3_BOOK_QA_CORPUS_VERSION,
  V3_BOOK_QA_STAGE_ID,
  type V3BookQACorpusManifest,
  type V3BookReaderPosition,
} from "../pipeline/v3-book-qa-types"
import type { V3BookQARetrievalHit } from "../pipeline/v3-book-qa-retrieval"
import {
  V3_BOOK_QA_HISTORY_PAGE_SIZE,
  V3_BOOK_QA_HISTORY_SCHEMA_VERSION,
  type V3BookQAHistoryAnswerSnapshot,
  type V3BookQAHistoryDeleteRequest,
  type V3BookQAHistoryEntry,
  type V3BookQAHistoryPage,
  type V3BookQAHistoryScopeRequest,
} from "../v3-book-qa-history-types"

export const V3_BOOK_QA_HISTORY_MAX_BYTES = 800 * 1024

const MAX_ID_CHARS = 512
const MAX_QUESTION_CHARS = 4_000
const MAX_LABEL_CHARS = 4_000
const MAX_TEXT_CHARS = 200_000
const MAX_HITS = 100
const MAX_ANSWER_REFERENCES = 200
const MAX_EVIDENCE_REFS = 5_000
const MAX_MATCHED_TERMS = 1_000
const MAX_ENTITY_GROUP_IDS = 1_000

const idSchema = z.string()
  .min(1)
  .max(MAX_ID_CHARS)
  .refine((value) => value.trim() === value, "IDs must not have surrounding whitespace")
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), "IDs must not contain control characters")
const questionSchema = z.string().trim().min(1).max(MAX_QUESTION_CHARS)
const boundedTextSchema = z.string().max(MAX_TEXT_CHARS)
const boundedLabelSchema = z.string().max(MAX_LABEL_CHARS)
const nonNegativeIntegerSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const finiteNumberSchema = z.number().finite()
const recordTypeSchema = z.enum([
  "paragraph",
  "scene",
  "event",
  "character",
  "place",
  "object",
  "goal",
  "causal_edge",
])

const readerPositionSchema = z.object({
  chapter_id: idSchema,
  pid: nonNegativeIntegerSchema,
}).strict()

const citationSchema = z.object({
  chapter_id: idSchema,
  chapter_title: boundedLabelSchema,
  pid: nonNegativeIntegerSchema,
  paragraph_text: boundedTextSchema,
}).strict()

const usedEvidenceSchema = z.object({
  evidence_id: idSchema,
  record_id: idSchema,
  record_type: recordTypeSchema,
  label: boundedLabelSchema,
}).strict()

const answerSchema = z.object({
  status: z.enum(["answered", "insufficient_evidence"]),
  text: boundedTextSchema,
  citations: z.array(citationSchema).max(MAX_ANSWER_REFERENCES),
  used_evidence: z.array(usedEvidenceSchema).max(MAX_ANSWER_REFERENCES),
}).strict()

const retrievalStatsSchema = z.object({
  readable_chapters: nonNegativeIntegerSchema,
  total_records: nonNegativeIntegerSchema,
  searched_records: nonNegativeIntegerSchema,
  blocked_ahead_records: nonNegativeIntegerSchema,
  direct_hits: nonNegativeIntegerSchema,
  lexical_hits: nonNegativeIntegerSchema,
  semantic_hits: nonNegativeIntegerSchema,
  entity_group_hits: nonNegativeIntegerSchema,
  graph_neighbor_hits: nonNegativeIntegerSchema,
  returned_hits: nonNegativeIntegerSchema,
}).strict()

const textSpanSchema = z.object({
  start_pid: nonNegativeIntegerSchema,
  end_pid: nonNegativeIntegerSchema,
}).strict()

const retrievalHitSchema = z.object({
  record_id: idSchema,
  local_record_id: idSchema,
  record_type: recordTypeSchema,
  chapter_id: idSchema,
  chapter_title: boundedLabelSchema,
  chapter_index: z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
  label: boundedLabelSchema,
  text: boundedTextSchema,
  score: finiteNumberSchema,
  match_kind: z.enum(["hybrid", "semantic", "lexical", "entity_group", "graph_neighbor"]),
  scene_id: idSchema.optional(),
  event_id: idSchema.optional(),
  text_span: textSpanSchema,
  pid: nonNegativeIntegerSchema.optional(),
  progress_status: z.literal("available"),
  evidence_refs: z.array(idSchema).max(MAX_EVIDENCE_REFS),
  matched_terms: z.array(z.string().max(MAX_ID_CHARS)).max(MAX_MATCHED_TERMS),
  semantic_similarity: finiteNumberSchema.optional(),
  entity_group_ids: z.array(idSchema).max(MAX_ENTITY_GROUP_IDS).optional(),
}).strict()

const answerSnapshotSchema = z.object({
  answer: answerSchema,
  retrieval: z.object({
    stats: retrievalStatsSchema,
    hits: z.array(retrievalHitSchema).max(MAX_HITS),
  }).strict(),
}).strict()

const scopeRequestSchema = z.object({
  source: z.string(),
  docId: idSchema,
  qaCorpusId: idSchema,
  cursor: z.string().min(1).max(2_000).optional(),
}).strict()

const createRequestSchema = z.object({
  source: z.string(),
  docId: idSchema,
  qaCorpusId: idSchema,
  question: questionSchema,
  readerPosition: readerPositionSchema,
  answerSnapshot: answerSnapshotSchema,
}).strict()

const deleteRequestSchema = z.object({
  source: z.string(),
  docId: idSchema,
  qaCorpusId: idSchema,
  entryId: idSchema,
}).strict()

const cursorSchema = z.object({
  createdAtMs: nonNegativeIntegerSchema,
  entryId: idSchema,
}).strict()

const storedEntrySchema = z.object({
  schema_version: z.literal(V3_BOOK_QA_HISTORY_SCHEMA_VERSION),
  entry_id: idSchema,
  doc_id: idSchema,
  qa_corpus_id: idSchema,
  question: questionSchema,
  reader_position: readerPositionSchema,
  answer_snapshot: answerSnapshotSchema,
  created_at: z.string().datetime(),
}).strict()

export class V3BookQAHistoryValidationError extends Error {
  readonly status = 400

  constructor(message: string) {
    super(message)
    this.name = "V3BookQAHistoryValidationError"
  }
}

export class V3BookQAHistoryCorpusIntegrityError extends Error {
  readonly status = 409

  constructor(message: string) {
    super(message)
    this.name = "V3BookQAHistoryCorpusIntegrityError"
  }
}

function validationError(error: unknown): V3BookQAHistoryValidationError {
  if (error instanceof V3BookQAHistoryValidationError) return error
  if (error instanceof z.ZodError) {
    return new V3BookQAHistoryValidationError(
      error.issues[0]?.message ?? "Invalid book QA history input",
    )
  }
  return new V3BookQAHistoryValidationError(
    error instanceof Error ? error.message : String(error),
  )
}

export function validateV3BookQAHistoryCreateSource(source: unknown): "v3" {
  if (source !== "v3") {
    throw new V3BookQAHistoryValidationError('source must be "v3"')
  }
  return "v3"
}

export function createV3BookQAHistoryScopeId(qaCorpusId: string): string {
  return createHash("sha256")
    .update(JSON.stringify(["book", qaCorpusId]))
    .digest("hex")
}

export interface V3BookQAHistoryCursor {
  createdAtMs: number
  entryId: string
}

export function encodeV3BookQAHistoryCursor(cursor: V3BookQAHistoryCursor): string {
  try {
    const parsed = cursorSchema.parse(cursor)
    return Buffer.from(JSON.stringify(parsed), "utf8").toString("base64url")
  } catch (error) {
    throw validationError(error)
  }
}

export function decodeV3BookQAHistoryCursor(
  cursor: string | null | undefined,
): V3BookQAHistoryCursor | null {
  if (!cursor) return null
  try {
    const bytes = Buffer.from(cursor, "base64url")
    if (bytes.toString("base64url") !== cursor) return null
    return cursorSchema.parse(JSON.parse(bytes.toString("utf8")))
  } catch {
    return null
  }
}

export interface NormalizedV3BookQAHistoryCreateInput {
  source: "v3"
  docId: string
  qaCorpusId: string
  question: string
  readerPosition: V3BookReaderPosition
  answer_snapshot: V3BookQAHistoryAnswerSnapshot
}

function tupleKey(chapterId: string, pid: number): string {
  return `${chapterId}\u0000${pid}`
}

function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new V3BookQAHistoryValidationError(`${label} must be unique`)
  }
}

function requiredHitSpan(hit: V3BookQARetrievalHit): { start_pid: number; end_pid: number } {
  if (!hit.text_span) {
    throw new V3BookQAHistoryValidationError(
      `Retrieval hit is missing an available text span: ${hit.record_id}`,
    )
  }
  return hit.text_span
}

function assertAnswerInvariant(snapshot: V3BookQAHistoryAnswerSnapshot): void {
  const { answer } = snapshot
  if (answer.status === "insufficient_evidence") {
    if (answer.text !== "" || answer.citations.length > 0 || answer.used_evidence.length > 0) {
      throw new V3BookQAHistoryValidationError(
        "Insufficient-evidence history must contain an empty answer, citations, and used evidence",
      )
    }
    return
  }
  if (!answer.text.trim() || answer.citations.length === 0 || answer.used_evidence.length === 0) {
    throw new V3BookQAHistoryValidationError(
      "Answered book history requires answer text, citations, and used evidence",
    )
  }
}

function assertSnapshotInternalConsistency(snapshot: V3BookQAHistoryAnswerSnapshot): void {
  assertAnswerInvariant(snapshot)
  const { hits, stats } = snapshot.retrieval
  if (stats.returned_hits !== hits.length) {
    throw new V3BookQAHistoryValidationError(
      "Book history returned_hits must equal the stored retrieval hit count",
    )
  }
  if (stats.searched_records > stats.total_records) {
    throw new V3BookQAHistoryValidationError(
      "Book history searched_records cannot exceed total_records",
    )
  }

  assertUnique(hits.map((hit) => hit.record_id), "Retrieval record IDs")
  for (const hit of hits) {
    const span = requiredHitSpan(hit)
    if (hit.record_id !== `${hit.chapter_id}:${hit.local_record_id}`) {
      throw new V3BookQAHistoryValidationError(
        `Retrieval record ID is not namespaced by chapter: ${hit.record_id}`,
      )
    }
    if (span.start_pid > span.end_pid) {
      throw new V3BookQAHistoryValidationError(`Retrieval hit has an invalid span: ${hit.record_id}`)
    }
    if (hit.pid !== undefined
      && (span.start_pid !== span.end_pid || hit.pid !== span.start_pid)) {
      throw new V3BookQAHistoryValidationError(
        `Retrieval hit PID does not match its exact span: ${hit.record_id}`,
      )
    }
    for (const relatedId of [hit.scene_id, hit.event_id]) {
      if (relatedId !== undefined && !relatedId.startsWith(`${hit.chapter_id}:`)) {
        throw new V3BookQAHistoryValidationError(
          `Retrieval metadata is not namespaced by chapter: ${relatedId}`,
        )
      }
    }
  }

  const answer = snapshot.answer
  assertUnique(
    answer.citations.map((citation) => tupleKey(citation.chapter_id, citation.pid)),
    "Answer citations",
  )
  assertUnique(answer.used_evidence.map((evidence) => evidence.evidence_id), "Evidence IDs")
  assertUnique(answer.used_evidence.map((evidence) => evidence.record_id), "Used evidence records")

  if (answer.status !== "answered") return
  const hitByRecordId = new Map(hits.map((hit) => [hit.record_id, hit]))
  const usedHits = answer.used_evidence.map((evidence) => {
    const hit = hitByRecordId.get(evidence.record_id)
    if (!hit
      || evidence.record_type !== hit.record_type
      || evidence.label !== hit.label) {
      throw new V3BookQAHistoryValidationError(
        `Used evidence does not match a stored retrieval hit: ${evidence.evidence_id}`,
      )
    }
    return hit
  })
  const citationKeys = new Set(answer.citations.map((citation) =>
    tupleKey(citation.chapter_id, citation.pid)))
  if (!answer.citations.every((citation) => usedHits.some((hit) =>
    hit.chapter_id === citation.chapter_id
    && citation.pid >= requiredHitSpan(hit).start_pid
    && citation.pid <= requiredHitSpan(hit).end_pid))) {
    throw new V3BookQAHistoryValidationError(
      "Every answer citation must be supported by stored used evidence",
    )
  }
  if (!usedHits.every((hit) => answer.citations.some((citation) =>
    citationKeys.has(tupleKey(citation.chapter_id, citation.pid))
    && citation.chapter_id === hit.chapter_id
    && citation.pid >= requiredHitSpan(hit).start_pid
    && citation.pid <= requiredHitSpan(hit).end_pid))) {
    throw new V3BookQAHistoryValidationError(
      "Every stored used evidence record must support an answer citation",
    )
  }
}

function assertManifestIntegrity(manifest: V3BookQACorpusManifest): void {
  try {
    if (manifest.stage_id !== V3_BOOK_QA_STAGE_ID
      || manifest.artifact_version !== V3_BOOK_QA_CORPUS_VERSION) {
      throw new Error("Stored corpus is not an exact BOOK.1 manifest")
    }
    const orderedChapterIds = manifest.chapters.map((chapter) => chapter.chapter_id)
    if (JSON.stringify(manifest.ordered_chapter_ids) !== JSON.stringify(orderedChapterIds)) {
      throw new Error("BOOK.1 ordered chapter IDs do not match its chapter records")
    }
    const fingerprint = fingerprintV3BookQACorpus(manifest.doc_id, manifest.chapters)
    if (manifest.fingerprint !== fingerprint
      || manifest.qa_corpus_id !== `BOOK1_${fingerprint.slice(0, 32)}`) {
      throw new Error("BOOK.1 identity does not match its immutable chapter manifest")
    }
  } catch (error) {
    if (error instanceof V3BookQAHistoryCorpusIntegrityError) throw error
    throw new V3BookQAHistoryCorpusIntegrityError(
      error instanceof Error ? error.message : String(error),
    )
  }
}

function manifestFrom(
  corpus: V3BookQACorpusManifest | { manifest: V3BookQACorpusManifest },
): V3BookQACorpusManifest {
  return "manifest" in corpus ? corpus.manifest : corpus
}

export function validateV3BookQAHistoryCreateForCorpus(
  input: NormalizedV3BookQAHistoryCreateInput,
  corpus: V3BookQACorpusManifest | { manifest: V3BookQACorpusManifest },
): NormalizedV3BookQAHistoryCreateInput {
  const manifest = manifestFrom(corpus)
  assertManifestIntegrity(manifest)
  if (input.docId !== manifest.doc_id || input.qaCorpusId !== manifest.qa_corpus_id) {
    throw new V3BookQAHistoryValidationError(
      "Book history document and corpus IDs must match the exact BOOK.1 manifest",
    )
  }

  let readable
  try {
    readable = selectV3BookReadableChapters(manifest, input.readerPosition)
  } catch (error) {
    throw new V3BookQAHistoryValidationError(
      error instanceof Error ? error.message : String(error),
    )
  }
  const readableById = new Map(readable.map((chapter) => [chapter.chapter_id, chapter]))
  for (const hit of input.answer_snapshot.retrieval.hits) {
    const span = requiredHitSpan(hit)
    const chapter = readableById.get(hit.chapter_id)
    if (!chapter) {
      throw new V3BookQAHistoryValidationError(
        `Retrieval hit uses an unread or future chapter: ${hit.chapter_id}`,
      )
    }
    if (hit.chapter_title !== chapter.chapter_title || hit.chapter_index !== chapter.chapter_index) {
      throw new V3BookQAHistoryValidationError(
        `Retrieval hit chapter metadata does not match BOOK.1: ${hit.chapter_id}`,
      )
    }
    if (span.end_pid > chapter.readable_through_pid) {
      throw new V3BookQAHistoryValidationError(
        `Retrieval hit exceeds saved reading progress: ${hit.record_id}`,
      )
    }
  }
  for (const citation of input.answer_snapshot.answer.citations) {
    const chapter = readableById.get(citation.chapter_id)
    if (!chapter) {
      throw new V3BookQAHistoryValidationError(
        `Answer citation uses an unread or future chapter: ${citation.chapter_id}`,
      )
    }
    if (citation.chapter_title !== chapter.chapter_title) {
      throw new V3BookQAHistoryValidationError(
        `Answer citation title does not match BOOK.1: ${citation.chapter_id}`,
      )
    }
    if (citation.pid > chapter.readable_through_pid) {
      throw new V3BookQAHistoryValidationError(
        `Answer citation exceeds saved reading progress: ${citation.chapter_id}/P${citation.pid}`,
      )
    }
  }
  if (input.answer_snapshot.retrieval.stats.readable_chapters !== readable.length) {
    throw new V3BookQAHistoryValidationError(
      "Book history readable_chapters does not match the saved reader position",
    )
  }
  return input
}

function contentBytes(input: NormalizedV3BookQAHistoryCreateInput): number {
  return Buffer.byteLength(JSON.stringify({
    doc_id: input.docId,
    qa_corpus_id: input.qaCorpusId,
    question: input.question,
    reader_position: input.readerPosition,
    answer_snapshot: input.answer_snapshot,
  }), "utf8")
}

function assertContentBudget(input: NormalizedV3BookQAHistoryCreateInput): void {
  const bytes = contentBytes(input)
  if (bytes > V3_BOOK_QA_HISTORY_MAX_BYTES) {
    throw new V3BookQAHistoryValidationError(
      `Book QA history stored content is too large (${bytes} > ${V3_BOOK_QA_HISTORY_MAX_BYTES} bytes)`,
    )
  }
}

export function normalizeV3BookQAHistoryCreateInput(
  input: unknown,
  manifest?: V3BookQACorpusManifest,
): NormalizedV3BookQAHistoryCreateInput {
  try {
    const parsed = createRequestSchema.parse(input)
    const normalized: NormalizedV3BookQAHistoryCreateInput = {
      source: validateV3BookQAHistoryCreateSource(parsed.source),
      docId: parsed.docId,
      qaCorpusId: parsed.qaCorpusId,
      question: parsed.question,
      readerPosition: parsed.readerPosition,
      answer_snapshot: parsed.answerSnapshot,
    }
    assertContentBudget(normalized)
    assertSnapshotInternalConsistency(normalized.answer_snapshot)
    return manifest
      ? validateV3BookQAHistoryCreateForCorpus(normalized, manifest)
      : normalized
  } catch (error) {
    if (error instanceof V3BookQAHistoryCorpusIntegrityError) throw error
    throw validationError(error)
  }
}

export function normalizeV3BookQAHistoryScopeInput(
  input: unknown,
): V3BookQAHistoryScopeRequest & { source: "v3" } {
  try {
    const parsed = scopeRequestSchema.parse(input)
    if (parsed.cursor !== undefined && decodeV3BookQAHistoryCursor(parsed.cursor) === null) {
      throw new V3BookQAHistoryValidationError("Invalid book QA history cursor")
    }
    return {
      ...parsed,
      source: validateV3BookQAHistoryCreateSource(parsed.source),
    }
  } catch (error) {
    throw validationError(error)
  }
}

export function normalizeV3BookQAHistoryDeleteInput(
  input: unknown,
): V3BookQAHistoryDeleteRequest & { source: "v3" } {
  try {
    const parsed = deleteRequestSchema.parse(input)
    return {
      ...parsed,
      source: validateV3BookQAHistoryCreateSource(parsed.source),
    }
  } catch (error) {
    throw validationError(error)
  }
}

export function normalizeV3BookQAHistoryStoredEntry(
  input: unknown,
  manifest?: V3BookQACorpusManifest,
): V3BookQAHistoryEntry {
  try {
    const entry = storedEntrySchema.parse(input) as V3BookQAHistoryEntry
    const normalized: NormalizedV3BookQAHistoryCreateInput = {
      source: "v3",
      docId: entry.doc_id,
      qaCorpusId: entry.qa_corpus_id,
      question: entry.question,
      readerPosition: entry.reader_position,
      answer_snapshot: entry.answer_snapshot,
    }
    assertContentBudget(normalized)
    assertSnapshotInternalConsistency(entry.answer_snapshot)
    if (manifest) validateV3BookQAHistoryCreateForCorpus(normalized, manifest)
    return entry
  } catch (error) {
    if (error instanceof V3BookQAHistoryCorpusIntegrityError) throw error
    throw validationError(error)
  }
}

export function normalizeV3BookQAHistoryPage(
  orderedEntries: unknown[],
  pageSize = V3_BOOK_QA_HISTORY_PAGE_SIZE,
): V3BookQAHistoryPage {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new V3BookQAHistoryValidationError("Invalid book QA history page size")
  }
  const normalizedEntries = orderedEntries.slice(0, pageSize + 1).map((entry) =>
    normalizeV3BookQAHistoryStoredEntry(entry))
  const entries = normalizedEntries.slice(0, pageSize)
  const hasMore = normalizedEntries.length > pageSize
  const last = entries.at(-1)
  const createdAtMs = last ? Date.parse(last.created_at) : Number.NaN
  if (last && !Number.isFinite(createdAtMs)) {
    throw new V3BookQAHistoryValidationError("Invalid book QA history timestamp")
  }
  return {
    entries,
    has_more: hasMore,
    next_cursor: hasMore && last
      ? encodeV3BookQAHistoryCursor({ createdAtMs, entryId: last.entry_id })
      : null,
  }
}
