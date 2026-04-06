/**
 * SUB.2 — Subscene State Extraction (LLM)
 * Port of Story-Decomposition/src/viewer/subscene_state.py
 */

import type {
  SubsceneProposals,
  ScenePackets,
  GroundedSceneModel,
  SubsceneStates,
  SubsceneStateItem,
} from "@/types/schema"
import type { LLMClient } from "@/lib/llm-client"
import { formatJsonParam } from "@/lib/prompt-loader"

function mergeSceneCast(sceneIndex: Record<string, unknown>): unknown[] {
  const combined = [
    ...(((sceneIndex.onstage_cast as unknown[]) ?? [])),
    ...(((sceneIndex.mentioned_offstage_cast as unknown[]) ?? [])),
  ]
  const seen = new Set<string>()
  const result: unknown[] = []

  for (const item of combined) {
    const record = item as Record<string, unknown>
    const name = typeof record.name === "string" ? record.name.trim() : ""
    const key = name || JSON.stringify(item)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }

  return result
}

export async function runSubsceneStateExtraction(
  proposalLog: SubsceneProposals,
  packetLog: ScenePackets,
  validatedLog: GroundedSceneModel,
  llmClient: LLMClient,
  docId: string,
  chapterId: string,
  parents: Record<string, string> = {},
  onProgress?: (msg: string) => void,
): Promise<SubsceneStates> {
  const packets: SubsceneStateItem[] = []

  for (let i = 0; i < proposalLog.packets.length; i++) {
    const proposalItem = proposalLog.packets[i]
    const packet = packetLog.packets[i]
    const entry = validatedLog.validated[i]
    if (!proposalItem || !packet || !entry) continue

    onProgress?.(`SUB.2: extracting subscene states for ${packet.scene_id}...`)

    const sceneIndex = entry.validated_scene_index
    const mergedCast = mergeSceneCast(sceneIndex as Record<string, unknown>)

    const result = await llmClient.extractSubsceneState({
      scene_id: packet.scene_id,
      start_pid: String(packet.start_pid),
      end_pid: String(packet.end_pid),
      scene_text: packet.scene_text_with_pid_markers,
      scene_summary: ((sceneIndex as Record<string, unknown>).scene_summary as string) ?? "",
      start_state_json: formatJsonParam(packet.start_state),
      end_state_json: formatJsonParam(packet.end_state),
      cast_json: formatJsonParam(mergedCast),
      current_places_json: formatJsonParam(packet.scene_current_places),
      candidates_json: formatJsonParam(proposalItem.candidate_subscenes),
    })

    packets.push({
      scene_id: packet.scene_id,
      records: (result.records as SubsceneStateItem["records"]) ?? [],
    })
  }

  const runId = `subscene_state__${docId}__${chapterId}`
  return {
    run_id: runId,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: "SUB.2",
    method: "llm",
    parents,
    packets,
  }
}
