import { embedTexts } from "@/lib/embedding-client"
import { loadStageResultByArtifactId, stageKey } from "@/lib/firestore"
import {
  fingerprintV3BookQACorpus,
  selectV3BookReadableChapters,
  V3BookReaderPositionValidationError,
} from "@/lib/pipeline/v3-book-qa-corpus"
import {
  retrieveV3BookQAEvidence,
  type V3BookQARetrievalChapterInput,
  type V3BookQARetrievalResult,
} from "@/lib/pipeline/v3-book-qa-retrieval"
import {
  V3_BOOK_QA_CORPUS_VERSION,
  V3_BOOK_QA_PINNED_STAGE_IDS,
  V3_BOOK_QA_STAGE_ID,
  type V3BookQAPinnedStageId,
  type V3BookQAReadableChapter,
  type V3BookReaderPosition,
} from "@/lib/pipeline/v3-book-qa-types"
import type { V3MemoryContractArtifact } from "@/lib/pipeline/v3-memory-contract-types"
import type { V3EventFramesArtifact, V3SceneSituationCardsArtifact } from "@/lib/pipeline/v3-memory-frames-types"
import {
  V3_RETRIEVAL_INDEX_VERSION,
  type V3RetrievalIndexArtifact,
  type V3RetrievalTextDocument,
} from "@/lib/pipeline/v3-narrative-memory-types"
import { hydrateV3RetrievalDocuments } from "@/lib/pipeline/v3-retrieval-documents"
import {
  fingerprintRetrievalDocuments,
  semanticScoresByRecordId,
  validateV3SemanticVectorPayload,
} from "@/lib/pipeline/v3-semantic-index"
import {
  V3_SEMANTIC_INDEX_VERSION,
  V3_SEMANTIC_VECTOR_VERSION,
  type V3SemanticIndexArtifact,
  type V3SemanticVectorPayload,
} from "@/lib/pipeline/v3-semantic-index-types"
import {
  downloadV3SemanticVectors,
  V3SemanticVectorIntegrityError,
} from "@/lib/storage"
import type { PipelineArtifact, PreparedChapter } from "@/types/schema"
import {
  createV3BookQACorpusStore,
  V3BookQACorpusImmutableConflictError,
  type StoredV3BookQACorpus,
} from "./v3-book-qa-corpus-store"

const REQUIRED_BOOK_RETRIEVAL_STAGES: readonly V3BookQAPinnedStageId[] = V3_BOOK_QA_PINNED_STAGE_IDS

export interface V3BookQARetrievalRequest {
  docId: string
  qaCorpusId: string
  question: string
  readerPosition: V3BookReaderPosition
  limit?: number
}

export interface V3BookQARequestDiagnostic {
  code: string
  message: string
  chapter_id?: string
  run_id?: string
  stage_id?: V3BookQAPinnedStageId
}

export interface V3BookQARetrievalServiceDependencies {
  loadCorpus(docId: string, qaCorpusId: string): Promise<StoredV3BookQACorpus | null>
  loadStageResultByArtifactId(
    docId: string,
    chapterId: string,
    artifactId: string,
    expectedStageKey: string,
    options: { source: "v3" },
  ): Promise<PipelineArtifact | null>
  downloadVectors: typeof downloadV3SemanticVectors
  embedTexts: typeof embedTexts
}

export class V3BookQARequestError extends Error {
  readonly status: number
  readonly statusCode: number
  readonly code: string
  readonly diagnostics: V3BookQARequestDiagnostic[]

  constructor(params: {
    status: number
    code: string
    message: string
    diagnostics?: V3BookQARequestDiagnostic[]
    chapterOrder?: string[]
  }) {
    super(params.message)
    this.name = "V3BookQARequestError"
    this.status = params.status
    this.statusCode = params.status
    this.code = params.code
    this.diagnostics = sortDiagnostics(params.diagnostics ?? [], params.chapterOrder ?? [])
  }
}

interface LoadedChapterRetrieval {
  readable: V3BookQAReadableChapter
  input: V3BookQARetrievalChapterInput
  semanticIndex: V3SemanticIndexArtifact
  vectorPayload: V3SemanticVectorPayload
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function sortDiagnostics(
  diagnostics: V3BookQARequestDiagnostic[],
  orderedChapterIds: string[],
): V3BookQARequestDiagnostic[] {
  const chapterOrder = new Map(orderedChapterIds.map((chapterId, index) => [chapterId, index]))
  return diagnostics
    .map((diagnostic) => ({ ...diagnostic }))
    .sort((left, right) =>
      (chapterOrder.get(left.chapter_id ?? "") ?? Number.MAX_SAFE_INTEGER)
      - (chapterOrder.get(right.chapter_id ?? "") ?? Number.MAX_SAFE_INTEGER)
      || V3_BOOK_QA_PINNED_STAGE_IDS.indexOf(left.stage_id ?? "PRE.1")
      - V3_BOOK_QA_PINNED_STAGE_IDS.indexOf(right.stage_id ?? "PRE.1")
      || compareText(left.code, right.code)
      || compareText(left.run_id ?? "", right.run_id ?? "")
      || compareText(left.message, right.message))
}

function requestError(params: ConstructorParameters<typeof V3BookQARequestError>[0]): V3BookQARequestError {
  return new V3BookQARequestError(params)
}

function diagnostic(params: V3BookQARequestDiagnostic): V3BookQARequestDiagnostic {
  return params
}

function defaultDependencies(): V3BookQARetrievalServiceDependencies {
  const store = createV3BookQACorpusStore()
  return {
    loadCorpus: (docId, qaCorpusId) => store.load(docId, qaCorpusId),
    loadStageResultByArtifactId: (docId, chapterId, artifactId, expectedStageKey, options) =>
      loadStageResultByArtifactId<PipelineArtifact>(
        docId,
        chapterId,
        artifactId,
        expectedStageKey,
        options,
      ),
    downloadVectors: downloadV3SemanticVectors,
    embedTexts,
  }
}

function validateRequest(params: V3BookQARetrievalRequest): void {
  if (!params.docId || params.docId.trim() !== params.docId) {
    throw requestError({ status: 400, code: "invalid_request", message: "docId is required" })
  }
  if (!params.qaCorpusId || params.qaCorpusId.trim() !== params.qaCorpusId) {
    throw requestError({ status: 400, code: "invalid_request", message: "qaCorpusId is required" })
  }
  if (!params.question || params.question.trim() !== params.question) {
    throw requestError({ status: 400, code: "invalid_request", message: "question must be non-empty and trimmed" })
  }
}

function validateStoredCorpus(
  stored: StoredV3BookQACorpus,
  request: V3BookQARetrievalRequest,
): void {
  const { manifest } = stored
  let recomputedFingerprint = ""
  try {
    recomputedFingerprint = fingerprintV3BookQACorpus(manifest.doc_id, manifest.chapters)
  } catch {
    throw requestError({
      status: 409,
      code: "corpus_integrity_mismatch",
      message: "BOOK.1 manifest structure is invalid; rebuild the corpus",
      diagnostics: [diagnostic({
        code: "corpus_integrity_mismatch",
        message: "BOOK.1 chapter identity cannot be recomputed.",
      })],
      chapterOrder: manifest.ordered_chapter_ids,
    })
  }
  const expectedCorpusId = `BOOK1_${recomputedFingerprint.slice(0, 32)}`
  const orderedIds = manifest.chapters.map((chapter) => chapter.chapter_id)
  const consistent = manifest.stage_id === V3_BOOK_QA_STAGE_ID
    && manifest.artifact_version === V3_BOOK_QA_CORPUS_VERSION
    && manifest.doc_id === request.docId
    && manifest.qa_corpus_id === request.qaCorpusId
    && manifest.fingerprint === recomputedFingerprint
    && manifest.qa_corpus_id === expectedCorpusId
    && Array.isArray(manifest.readiness)
    && Array.isArray(stored.groups)
    && JSON.stringify(manifest.ordered_chapter_ids) === JSON.stringify(orderedIds)
  if (!consistent) {
    throw requestError({
      status: 409,
      code: "corpus_integrity_mismatch",
      message: "BOOK.1 manifest identity does not match the requested immutable corpus",
      diagnostics: [diagnostic({
        code: "corpus_integrity_mismatch",
        message: "Stored BOOK.1 document, ID, fingerprint, or chapter order is inconsistent.",
      })],
      chapterOrder: manifest.ordered_chapter_ids,
    })
  }
}

function readableChaptersOrRequestError(
  stored: StoredV3BookQACorpus,
  position: V3BookReaderPosition,
): V3BookQAReadableChapter[] {
  try {
    return selectV3BookReadableChapters(stored.manifest, position)
  } catch (error) {
    if (error instanceof V3BookReaderPositionValidationError) {
      throw requestError({
        status: 400,
        code: "invalid_reader_position",
        message: error.message,
        diagnostics: [diagnostic({ code: error.code, message: error.message })],
        chapterOrder: stored.manifest.ordered_chapter_ids,
      })
    }
    throw error
  }
}

function preflightReadinessDiagnostics(
  stored: StoredV3BookQACorpus,
  readableChapters: V3BookQAReadableChapter[],
): V3BookQARequestDiagnostic[] {
  const readableIds = new Set(readableChapters.map((chapter) => chapter.chapter_id))
  const diagnostics: V3BookQARequestDiagnostic[] = stored.manifest.readiness
    .filter((item) => readableIds.has(item.chapter_id))
    .map((item) => ({ ...item }))
  for (const chapter of readableChapters) {
    for (const stageId of REQUIRED_BOOK_RETRIEVAL_STAGES) {
      const artifactId = chapter.artifact_ids[stageId]
      if (typeof artifactId !== "string" || artifactId.length === 0) {
        diagnostics.push(diagnostic({
          code: "missing_pinned_ref",
          message: `${stageId} has no pinned content-addressed artifact reference.`,
          chapter_id: chapter.chapter_id,
          run_id: chapter.run_id,
          stage_id: stageId,
        }))
      }
    }
  }
  return diagnostics
}

function artifactIdentityDiagnostic(params: {
  artifact: PipelineArtifact
  chapter: V3BookQAReadableChapter
  stageId: V3BookQAPinnedStageId
  artifactId: string
  docId: string
}): V3BookQARequestDiagnostic | null {
  const { artifact, artifactId, chapter, stageId, docId } = params
  if (
    artifact.doc_id === docId
    && artifact.chapter_id === chapter.chapter_id
    && artifact.run_id === chapter.run_id
    && artifact.stage_id === stageId
    && (artifact.artifact_id === undefined || artifact.artifact_id === artifactId)
  ) return null
  return diagnostic({
    code: "artifact_identity_mismatch",
    message: `${stageId} does not match its pinned document, chapter, run, or stage identity.`,
    chapter_id: chapter.chapter_id,
    run_id: chapter.run_id,
    stage_id: stageId,
  })
}

async function loadPinnedArtifacts(params: {
  dependencies: V3BookQARetrievalServiceDependencies
  docId: string
  chapters: V3BookQAReadableChapter[]
  chapterOrder: string[]
}): Promise<Map<string, Map<V3BookQAPinnedStageId, PipelineArtifact>>> {
  const loadedByChapter = new Map<string, Map<V3BookQAPinnedStageId, PipelineArtifact>>()
  const diagnostics: V3BookQARequestDiagnostic[] = []
  for (const chapter of params.chapters) {
    const loaded = new Map<V3BookQAPinnedStageId, PipelineArtifact>()
    for (const stageId of REQUIRED_BOOK_RETRIEVAL_STAGES) {
      const artifactId = chapter.artifact_ids[stageId]!
      let artifact: PipelineArtifact | null
      try {
        artifact = await params.dependencies.loadStageResultByArtifactId(
          params.docId,
          chapter.chapter_id,
          artifactId,
          stageKey(stageId),
          { source: "v3" },
        )
      } catch (error) {
        if (error instanceof Error && /does not match expected stage/i.test(error.message)) {
          diagnostics.push(diagnostic({
            code: "artifact_identity_mismatch",
            message: error.message,
            chapter_id: chapter.chapter_id,
            run_id: chapter.run_id,
            stage_id: stageId,
          }))
          continue
        }
        throw error
      }
      if (!artifact) {
        diagnostics.push(diagnostic({
          code: "artifact_missing",
          message: `${stageId} pinned artifact ${artifactId} was not found.`,
          chapter_id: chapter.chapter_id,
          run_id: chapter.run_id,
          stage_id: stageId,
        }))
        continue
      }
      const identityProblem = artifactIdentityDiagnostic({
        artifact,
        chapter,
        stageId,
        artifactId,
        docId: params.docId,
      })
      if (identityProblem) {
        diagnostics.push(identityProblem)
        continue
      }
      loaded.set(stageId, artifact)
    }
    loadedByChapter.set(chapter.chapter_id, loaded)
  }
  if (diagnostics.length > 0) {
    throw requestError({
      status: 409,
      code: "book_retrieval_not_ready",
      message: "Readable BOOK.1 chapters have missing or inconsistent pinned artifacts",
      diagnostics,
      chapterOrder: params.chapterOrder,
    })
  }
  return loadedByChapter
}

function idx2Diagnostic(
  chapter: V3BookQAReadableChapter,
  code: string,
  message: string,
): V3BookQARequestDiagnostic {
  return diagnostic({
    code,
    message,
    chapter_id: chapter.chapter_id,
    run_id: chapter.run_id,
    stage_id: "IDX.2",
  })
}

function validateVectorDocumentIds(
  documents: V3RetrievalTextDocument[],
  payload: V3SemanticVectorPayload,
): boolean {
  const expectedIds = documents.map((document) => document.text_doc_id).sort(compareText)
  const vectorIds = payload.vectors.map((row) => row.text_doc_id).sort(compareText)
  return new Set(vectorIds).size === vectorIds.length
    && JSON.stringify(expectedIds) === JSON.stringify(vectorIds)
}

async function prepareReadableChapter(params: {
  dependencies: V3BookQARetrievalServiceDependencies
  docId: string
  chapter: V3BookQAReadableChapter
  artifacts: Map<V3BookQAPinnedStageId, PipelineArtifact>
}): Promise<{ loaded?: LoadedChapterRetrieval; diagnostics: V3BookQARequestDiagnostic[] }> {
  const { chapter, artifacts } = params
  const diagnostics: V3BookQARequestDiagnostic[] = []
  const preparedChapter = artifacts.get("PRE.1") as PreparedChapter
  const retrievalIndex = artifacts.get("IDX.1") as V3RetrievalIndexArtifact
  const memoryContract = artifacts.get("MEM.0") as V3MemoryContractArtifact
  const sceneCards = artifacts.get("MEM.1") as V3SceneSituationCardsArtifact
  const eventFrames = artifacts.get("EVENT.2") as V3EventFramesArtifact
  const semanticIndex = artifacts.get("IDX.2") as V3SemanticIndexArtifact

  if (
    retrievalIndex.artifact_version !== V3_RETRIEVAL_INDEX_VERSION
    || !Array.isArray(retrievalIndex.structured_records)
    || !retrievalIndex.structured_records.some((record) => record.record_type === "paragraph")
  ) {
    diagnostics.push(diagnostic({
      code: "idx1_not_book_ready",
      message: "IDX.1 must use the current paragraph-capable artifact version.",
      chapter_id: chapter.chapter_id,
      run_id: chapter.run_id,
      stage_id: "IDX.1",
    }))
    return { diagnostics }
  }
  if (!Array.isArray(memoryContract.events) || !Array.isArray(sceneCards.scene_cards) || !Array.isArray(eventFrames.event_frames)) {
    diagnostics.push(diagnostic({
      code: "retrieval_artifact_corrupt",
      message: "MEM.0, MEM.1, or EVENT.2 has an invalid retrieval structure.",
      chapter_id: chapter.chapter_id,
      run_id: chapter.run_id,
      stage_id: "MEM.0",
    }))
    return { diagnostics }
  }

  let textDocuments: V3RetrievalTextDocument[]
  try {
    textDocuments = hydrateV3RetrievalDocuments({ retrievalIndex, preparedChapter })
  } catch (error) {
    diagnostics.push(diagnostic({
      code: "idx1_not_book_ready",
      message: error instanceof Error ? error.message : String(error),
      chapter_id: chapter.chapter_id,
      run_id: chapter.run_id,
      stage_id: "IDX.1",
    }))
    return { diagnostics }
  }

  const currentFingerprint = fingerprintRetrievalDocuments(textDocuments)
  if (
    semanticIndex.artifact_version !== V3_SEMANTIC_INDEX_VERSION
    || semanticIndex.source_text_fingerprint !== currentFingerprint
    || semanticIndex.vector_stats?.vectors !== textDocuments.length
    || !Number.isSafeInteger(semanticIndex.vector_stats?.dimensions)
    || semanticIndex.vector_stats.dimensions < 1
    || typeof semanticIndex.embedding_model !== "string"
    || semanticIndex.embedding_model.length === 0
    || typeof semanticIndex.vector_blob?.storage_path !== "string"
    || semanticIndex.vector_blob.storage_path.length === 0
    || typeof semanticIndex.vector_blob?.content_hash !== "string"
    || semanticIndex.vector_blob.content_hash.length === 0
  ) {
    diagnostics.push(idx2Diagnostic(
      chapter,
      semanticIndex.artifact_version !== V3_SEMANTIC_INDEX_VERSION ? "idx2_not_book_ready" : "idx2_stale_or_corrupt",
      "IDX.2 is old, stale, or inconsistent with hydrated retrieval documents.",
    ))
    return { diagnostics }
  }

  let vectorPayload: V3SemanticVectorPayload
  try {
    vectorPayload = await params.dependencies.downloadVectors({
      storagePath: semanticIndex.vector_blob.storage_path,
      expectedContentHash: semanticIndex.vector_blob.content_hash,
    })
  } catch (error) {
    if (error instanceof V3SemanticVectorIntegrityError) {
      diagnostics.push(idx2Diagnostic(chapter, "idx2_vector_integrity", error.message))
      return { diagnostics }
    }
    throw error
  }

  try {
    if (vectorPayload.artifact_version !== V3_SEMANTIC_VECTOR_VERSION) {
      throw new Error(`Semantic vectors must use ${V3_SEMANTIC_VECTOR_VERSION}`)
    }
    validateV3SemanticVectorPayload(vectorPayload, {
      model: semanticIndex.embedding_model,
      dimensions: semanticIndex.vector_stats.dimensions,
      vectorCount: semanticIndex.vector_stats.vectors,
      sourceTextFingerprint: semanticIndex.source_text_fingerprint,
    })
    if (!validateVectorDocumentIds(textDocuments, vectorPayload)) {
      throw new Error("Semantic vector document IDs do not match hydrated IDX.1 documents")
    }
    if (vectorPayload.vectors.some((row) => row.embedding.some((value) => !Number.isFinite(value)))) {
      throw new Error("Semantic vector rows must contain only finite numeric values")
    }
  } catch (error) {
    diagnostics.push(idx2Diagnostic(
      chapter,
      "idx2_vector_invalid",
      error instanceof Error ? error.message : String(error),
    ))
    return { diagnostics }
  }

  return {
    loaded: {
      readable: chapter,
      input: {
        chapter_id: chapter.chapter_id,
        chapter_title: chapter.chapter_title,
        chapter_index: chapter.chapter_index,
        retrieval_index: retrievalIndex,
        text_documents: textDocuments,
        scene_cards: sceneCards,
        event_frames: eventFrames,
        memory_contract: memoryContract,
      },
      semanticIndex,
      vectorPayload,
    },
    diagnostics,
  }
}

function compatibilityDiagnostics(chapters: LoadedChapterRetrieval[]): V3BookQARequestDiagnostic[] {
  const first = chapters[0]
  if (!first) return []
  const diagnostics: V3BookQARequestDiagnostic[] = []
  for (const chapter of chapters.slice(1)) {
    if (chapter.semanticIndex.embedding_model !== first.semanticIndex.embedding_model) {
      diagnostics.push(idx2Diagnostic(
        chapter.readable,
        "mixed_embedding_models",
        `IDX.2 model ${chapter.semanticIndex.embedding_model} does not match ${first.semanticIndex.embedding_model}.`,
      ))
    }
    if (chapter.semanticIndex.vector_stats.dimensions !== first.semanticIndex.vector_stats.dimensions) {
      diagnostics.push(idx2Diagnostic(
        chapter.readable,
        "mixed_embedding_dimensions",
        `IDX.2 dimensions ${chapter.semanticIndex.vector_stats.dimensions} do not match ${first.semanticIndex.vector_stats.dimensions}.`,
      ))
    }
  }
  return diagnostics
}

function validateQueryEmbedding(params: {
  response: Awaited<ReturnType<typeof embedTexts>>
  model: string
  dimensions: number
}): number[] {
  const vector = params.response.embeddings[0]
  if (
    params.response.model !== params.model
    || params.response.dimensions !== params.dimensions
    || params.response.embeddings.length !== 1
    || !vector
    || vector.length !== params.dimensions
    || vector.some((value) => !Number.isFinite(value))
  ) {
    throw requestError({
      status: 409,
      code: "invalid_query_embedding",
      message: "Embedding provider returned an incompatible query vector",
      diagnostics: [diagnostic({
        code: "invalid_query_embedding",
        message: "Query vector model, count, dimensions, or values are invalid.",
        stage_id: "IDX.2",
      })],
    })
  }
  return vector
}

export class V3BookQARetrievalService {
  constructor(private readonly dependencies: V3BookQARetrievalServiceDependencies = defaultDependencies()) {}

  async retrieve(request: V3BookQARetrievalRequest): Promise<V3BookQARetrievalResult> {
    validateRequest(request)
    let stored: StoredV3BookQACorpus | null
    try {
      stored = await this.dependencies.loadCorpus(request.docId, request.qaCorpusId)
    } catch (error) {
      if (error instanceof V3BookQACorpusImmutableConflictError) {
        throw requestError({
          status: 409,
          code: "corpus_integrity_mismatch",
          message: error.message,
          diagnostics: [diagnostic({ code: "corpus_integrity_mismatch", message: error.message })],
        })
      }
      throw error
    }
    if (!stored) {
      throw requestError({
        status: 404,
        code: "corpus_not_found",
        message: `BOOK.1 corpus ${request.qaCorpusId} was not found for ${request.docId}`,
        diagnostics: [diagnostic({ code: "corpus_not_found", message: "Build BOOK.1 before querying book QA." })],
      })
    }
    validateStoredCorpus(stored, request)
    const readableChapters = readableChaptersOrRequestError(stored, request.readerPosition)
    const preflightDiagnostics = preflightReadinessDiagnostics(stored, readableChapters)
    if (preflightDiagnostics.length > 0) {
      throw requestError({
        status: 409,
        code: "book_retrieval_not_ready",
        message: "Readable BOOK.1 chapters are not query-ready",
        diagnostics: preflightDiagnostics,
        chapterOrder: stored.manifest.ordered_chapter_ids,
      })
    }

    const artifacts = await loadPinnedArtifacts({
      dependencies: this.dependencies,
      docId: request.docId,
      chapters: readableChapters,
      chapterOrder: stored.manifest.ordered_chapter_ids,
    })
    const prepared: LoadedChapterRetrieval[] = []
    const preparationDiagnostics: V3BookQARequestDiagnostic[] = []
    for (const chapter of readableChapters) {
      const result = await prepareReadableChapter({
        dependencies: this.dependencies,
        docId: request.docId,
        chapter,
        artifacts: artifacts.get(chapter.chapter_id)!,
      })
      if (result.loaded) prepared.push(result.loaded)
      preparationDiagnostics.push(...result.diagnostics)
    }
    if (preparationDiagnostics.length > 0) {
      throw requestError({
        status: 409,
        code: "book_retrieval_not_ready",
        message: "Readable BOOK.1 retrieval indexes are invalid or unavailable",
        diagnostics: preparationDiagnostics,
        chapterOrder: stored.manifest.ordered_chapter_ids,
      })
    }

    const mixedDiagnostics = compatibilityDiagnostics(prepared)
    if (mixedDiagnostics.length > 0) {
      throw requestError({
        status: 409,
        code: "incompatible_semantic_indexes",
        message: "Readable chapters do not share one embedding model and dimension pair",
        diagnostics: mixedDiagnostics,
        chapterOrder: stored.manifest.ordered_chapter_ids,
      })
    }
    const first = prepared[0]
    if (!first) {
      throw requestError({ status: 409, code: "book_retrieval_not_ready", message: "No readable chapter index is available" })
    }
    const model = first.semanticIndex.embedding_model
    const dimensions = first.semanticIndex.vector_stats.dimensions
    const embeddingResponse = await this.dependencies.embedTexts([request.question], { model, dimensions })
    const queryEmbedding = validateQueryEmbedding({ response: embeddingResponse, model, dimensions })
    const semanticScores: Record<string, number> = {}
    for (const chapter of prepared) {
      const localScores = semanticScoresByRecordId(queryEmbedding, chapter.vectorPayload)
      for (const [localRecordId, score] of Object.entries(localScores)) {
        semanticScores[`${chapter.readable.chapter_id}:${localRecordId}`] = score
      }
    }

    return retrieveV3BookQAEvidence({
      corpus: stored.manifest,
      chapters: prepared.map((chapter) => chapter.input),
      entityGroups: stored.groups,
      question: request.question,
      readerPosition: request.readerPosition,
      limit: request.limit,
      semanticScores,
    })
  }
}

export function createV3BookQARetrievalService(
  dependencies?: V3BookQARetrievalServiceDependencies,
): V3BookQARetrievalService {
  return new V3BookQARetrievalService(dependencies)
}

export async function retrieveV3BookQAEvidenceForCorpus(
  request: V3BookQARetrievalRequest,
): Promise<V3BookQARetrievalResult> {
  return createV3BookQARetrievalService().retrieve(request)
}
