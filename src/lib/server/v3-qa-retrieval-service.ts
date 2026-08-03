import type { FirestoreDataSource } from "@/lib/data-source"
import { embedTexts } from "@/lib/embedding-client"
import { loadStageResult, stageKey } from "@/lib/firestore"
import type { V3MemoryContractArtifact } from "@/lib/pipeline/v3-memory-contract-types"
import type { V3EventFramesArtifact, V3SceneSituationCardsArtifact } from "@/lib/pipeline/v3-memory-frames-types"
import type { V3RetrievalIndexArtifact, V3RetrievalTextDocument } from "@/lib/pipeline/v3-narrative-memory-types"
import { retrieveV3QAEvidence } from "@/lib/pipeline/v3-qa-retrieval"
import type { V3QARetrievalResult } from "@/lib/pipeline/v3-qa-retrieval-types"
import { hydrateV3RetrievalDocuments } from "@/lib/pipeline/v3-retrieval-documents"
import {
  fingerprintRetrievalDocuments,
  semanticScoresByRecordId,
  validateV3SemanticVectorPayload,
} from "@/lib/pipeline/v3-semantic-index"
import type {
  V3SemanticIndexArtifact,
  V3SemanticVectorPayload,
} from "@/lib/pipeline/v3-semantic-index-types"
import { downloadV3SemanticVectors } from "@/lib/storage"
import type { PreparedChapter } from "@/types/schema"

export class V3QAPrerequisiteError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

function invalidV3SemanticIndexError(error: unknown): V3QAPrerequisiteError {
  const detail = error instanceof Error ? error.message : String(error)
  return new V3QAPrerequisiteError(
    `IDX.2 semantic vectors are invalid or unavailable; rerun IDX.2 to rebuild the semantic index. ${detail}`,
    409,
  )
}

export async function loadValidatedV3SemanticVectorPayload(params: {
  semanticIndex: V3SemanticIndexArtifact
  downloadVectors?: typeof downloadV3SemanticVectors
}): Promise<V3SemanticVectorPayload> {
  const downloadVectors = params.downloadVectors ?? downloadV3SemanticVectors
  try {
    const payload = await downloadVectors({
      storagePath: params.semanticIndex.vector_blob.storage_path,
      expectedContentHash: params.semanticIndex.vector_blob.content_hash,
    })
    validateV3SemanticVectorPayload(payload, {
      model: params.semanticIndex.embedding_model,
      dimensions: params.semanticIndex.vector_stats.dimensions,
      vectorCount: params.semanticIndex.vector_stats.vectors,
      sourceTextFingerprint: params.semanticIndex.source_text_fingerprint,
    })
    return payload
  } catch (error) {
    throw invalidV3SemanticIndexError(error)
  }
}

export function resolveV3QARetrievalDocuments(params: {
  retrievalIndex: V3RetrievalIndexArtifact
  preparedChapter?: PreparedChapter | null
}): V3RetrievalTextDocument[] {
  try {
    return hydrateV3RetrievalDocuments(params)
  } catch (error) {
    throw new V3QAPrerequisiteError(error instanceof Error ? error.message : String(error))
  }
}

export async function retrieveV3QAEvidenceForRun(params: {
  docId: string
  chapterId: string
  runId: string
  source: FirestoreDataSource
  question: string
  progressEndPid: number
  limit?: number
}): Promise<V3QARetrievalResult> {
  const { docId, chapterId, runId, source, question, progressEndPid, limit } = params
  const [memoryContract, sceneCards, eventFrames, retrievalIndex, semanticIndex, preparedChapter] = await Promise.all([
    loadStageResult<V3MemoryContractArtifact>(docId, chapterId, runId, stageKey("MEM.0"), { source }),
    loadStageResult<V3SceneSituationCardsArtifact>(docId, chapterId, runId, stageKey("MEM.1"), { source }),
    loadStageResult<V3EventFramesArtifact>(docId, chapterId, runId, stageKey("EVENT.2"), { source }),
    loadStageResult<V3RetrievalIndexArtifact>(docId, chapterId, runId, stageKey("IDX.1"), { source }),
    loadStageResult<V3SemanticIndexArtifact>(docId, chapterId, runId, stageKey("IDX.2"), { source }),
    loadStageResult<PreparedChapter>(docId, chapterId, runId, stageKey("PRE.1"), { source }),
  ])
  if (!memoryContract) throw new V3QAPrerequisiteError("MEM.0 result not found - run MEM.0 first")
  if (!sceneCards) throw new V3QAPrerequisiteError("MEM.1 result not found - run MEM.1 first")
  if (!eventFrames) throw new V3QAPrerequisiteError("EVENT.2 result not found - run EVENT.2 first")
  if (!retrievalIndex) throw new V3QAPrerequisiteError("IDX.1 result not found - run IDX.1 first")
  const textDocuments = resolveV3QARetrievalDocuments({ retrievalIndex, preparedChapter })

  let semanticScores: Record<string, number> | undefined
  if (semanticIndex) {
    const currentFingerprint = fingerprintRetrievalDocuments(textDocuments)
    if (currentFingerprint !== semanticIndex.source_text_fingerprint) {
      throw new V3QAPrerequisiteError("IDX.2 is stale for the current IDX.1 result - rerun IDX.2", 409)
    }
    const vectorPayload = await loadValidatedV3SemanticVectorPayload({ semanticIndex })
    const queryEmbedding = await embedTexts([question], {
      model: semanticIndex.embedding_model,
      dimensions: semanticIndex.vector_stats.dimensions,
    })
    try {
      semanticScores = semanticScoresByRecordId(queryEmbedding.embeddings[0], vectorPayload)
    } catch (error) {
      throw invalidV3SemanticIndexError(error)
    }
  }

  return retrieveV3QAEvidence({
    question,
    progressEndPid,
    limit,
    retrievalIndex,
    textDocuments,
    sceneCards,
    eventFrames,
    memoryContract,
    semanticScores,
  })
}
