import { parseFirestoreDataSource } from "@/lib/data-source"
import { loadStageResult, saveStageResult, stageKey } from "@/lib/firestore"
import { runV3SceneGrouping } from "@/lib/pipeline/v3-scene-grouping"
import {
  attachLLMDebug,
  createLLMClient,
  errorResponse,
  okResponse,
  progressStreamResponse,
  wantsProgressStream,
  type BaseRequestBody,
  type ProgressReporter,
} from "@/lib/api-utils"
import type { V3EventGroupingArtifact } from "@/lib/pipeline/v3-event-types"
import type { V3SceneGroupingArtifact } from "@/lib/pipeline/v3-scene-types"

export const maxDuration = 300

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as BaseRequestBody
    const { docId, chapterId, runId, parents = {} } = body
    const source = parseFirestoreDataSource(body.source)

    const eventGrouping = await loadStageResult<V3EventGroupingArtifact>(
      docId,
      chapterId,
      runId,
      stageKey("EVENT.1"),
      { source },
    )
    if (!eventGrouping) return errorResponse("EVENT.1 result not found - run EVENT.1 first", 400)

    const execute = async (progress?: ProgressReporter): Promise<V3SceneGroupingArtifact> => {
      const llm = createLLMClient(body)
      const result = attachLLMDebug(
        await runV3SceneGrouping(
          eventGrouping,
          llm,
          docId,
          chapterId,
          parents,
          progress,
        ),
        llm,
      )

      await saveStageResult(docId, chapterId, runId, stageKey("SCENE.0"), result, { source })
      return result
    }

    if (wantsProgressStream(request)) {
      return progressStreamResponse((progress) => execute(progress))
    }

    return okResponse(await execute())
  } catch (e) {
    return errorResponse(String(e))
  }
}
