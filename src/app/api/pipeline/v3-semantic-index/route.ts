import { errorResponse, okResponse, type BaseRequestBody } from "@/lib/api-utils"
import { parseRequiredV3DataSource } from "@/lib/data-source"
import { embedTexts } from "@/lib/embedding-client"
import { loadStageResult, saveStageResult, stageKey } from "@/lib/firestore"
import type { V3RetrievalIndexArtifact } from "@/lib/pipeline/v3-narrative-memory-types"
import {
  buildV3SemanticIndexArtifact,
  createV3SemanticVectorPayload,
} from "@/lib/pipeline/v3-semantic-index"
import { uploadV3SemanticVectors } from "@/lib/storage"

export const maxDuration = 300

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as BaseRequestBody
    const { docId, chapterId, runId, parents = {} } = body
    const source = parseRequiredV3DataSource(body.source)
    if (!source) return errorResponse("IDX.2 can only be written to the V3 data source", 400)

    const retrievalIndex = await loadStageResult<V3RetrievalIndexArtifact>(
      docId,
      chapterId,
      runId,
      stageKey("IDX.1"),
      { source },
    )
    if (!retrievalIndex) return errorResponse("IDX.1 result not found - run IDX.1 first", 400)
    if (retrievalIndex.text_documents.length === 0) return errorResponse("IDX.1 contains no text documents to embed", 400)

    const embedded = await embedTexts(retrievalIndex.text_documents.map((document) => document.text))
    const vectorPayload = createV3SemanticVectorPayload({
      model: embedded.model,
      documents: retrievalIndex.text_documents,
      embeddings: embedded.embeddings,
    })
    const blob = await uploadV3SemanticVectors({
      docId,
      chapterId,
      runId,
      payload: vectorPayload,
      source,
    })
    const result = buildV3SemanticIndexArtifact({
      docId,
      chapterId,
      parents,
      model: embedded.model,
      dimensions: embedded.dimensions,
      vectorCount: vectorPayload.vectors.length,
      sourceTextFingerprint: vectorPayload.source_text_fingerprint,
      promptTokens: embedded.promptTokens,
      blob,
    })

    await saveStageResult(docId, chapterId, runId, stageKey("IDX.2"), result, { source })
    return okResponse(result)
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error))
  }
}
