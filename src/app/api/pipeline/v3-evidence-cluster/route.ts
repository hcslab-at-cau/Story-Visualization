import { parseFirestoreDataSource } from "@/lib/data-source"
import { loadStageResult, saveStageResult, stageKey } from "@/lib/firestore"
import { buildV3EvidenceClusters } from "@/lib/pipeline/v3-evidence-clustering"
import { errorResponse, okResponse, type BaseRequestBody } from "@/lib/api-utils"
import type { V3EvidenceClusteringArtifact } from "@/lib/pipeline/v3-evidence-clustering-types"
import type { V3EvidenceGateArtifact } from "@/lib/pipeline/v3-evidence-gate-types"
import type { V3EvidenceRefinementArtifact } from "@/lib/pipeline/v3-evidence-refinement-types"

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as BaseRequestBody
    const { docId, chapterId, runId, parents = {} } = body
    const source = parseFirestoreDataSource(body.source)

    const evidenceRefinement = await loadStageResult<V3EvidenceRefinementArtifact>(
      docId,
      chapterId,
      runId,
      stageKey("EVID.2"),
      { source },
    )
    if (!evidenceRefinement) return errorResponse("EVID.2 result not found - run EVID.2 first", 400)

    const evidenceGate = await loadStageResult<V3EvidenceGateArtifact>(
      docId,
      chapterId,
      runId,
      stageKey("EVID.3"),
      { source },
    )
    if (!evidenceGate) return errorResponse("EVID.3 result not found - run EVID.3 first", 400)

    const result: V3EvidenceClusteringArtifact = buildV3EvidenceClusters({
      docId,
      chapterId,
      evidenceRefinement,
      evidenceGate,
      parents,
    })

    await saveStageResult(docId, chapterId, runId, stageKey("EVID.4"), result, { source })
    return okResponse(result)
  } catch (e) {
    return errorResponse(String(e))
  }
}
