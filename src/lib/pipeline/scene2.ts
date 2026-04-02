/**
 * SCENE.2 — Scene Index Extraction (LLM)
 * Port of Story-Decomposition/src/viewer/scene_index.py
 */

import type {
  ScenePackets,
  SceneIndexDraft,
  SceneIndex,
} from "@/types/schema"
import type { LLMClient } from "@/lib/llm-client"
import { formatJsonParam } from "@/lib/prompt-loader"

export async function runSceneIndexExtraction(
  packetLog: ScenePackets,
  llmClient: LLMClient,
  docId: string,
  chapterId: string,
  parents: Record<string, string> = {},
  onProgress?: (msg: string) => void,
): Promise<SceneIndexDraft> {
  const indices: SceneIndex[] = []

  for (const packet of packetLog.packets) {
    onProgress?.(`SCENE.2: indexing ${packet.scene_id}...`)

    const result = await llmClient.extractSceneIndex({
      scene_id: packet.scene_id,
      start_pid: String(packet.start_pid),
      end_pid: String(packet.end_pid),
      start_state_json: formatJsonParam(packet.start_state),
      end_state_json: formatJsonParam(packet.end_state),
      cast_union: packet.scene_cast_union.join(", "),
      current_places: packet.scene_current_places.join(", "),
      mentioned_places: packet.scene_mentioned_places.join(", "),
      time_signals: packet.scene_time_signals.join(", "),
      scene_text: packet.scene_text_with_pid_markers,
    })

    indices.push(result as unknown as SceneIndex)
  }

  const runId = `scene_index__${docId}__${chapterId}`
  return {
    run_id: runId,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: "SCENE.2",
    method: "llm",
    parents,
    indices,
  }
}
