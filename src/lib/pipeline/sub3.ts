/**
 * SUB.3 — Subscene Validation (LLM)
 * Port of Story-Decomposition/src/viewer/subscene_validation.py
 */

import type {
  SubsceneProposals,
  SubsceneStates,
  ScenePackets,
  GroundedSceneModel,
  ValidatedSubscenes,
  ValidatedSubsceneItem,
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

export async function runSubsceneValidation(
  proposalLog: SubsceneProposals,
  stateLog: SubsceneStates,
  packetLog: ScenePackets,
  validatedLog: GroundedSceneModel,
  llmClient: LLMClient,
  docId: string,
  chapterId: string,
  parents: Record<string, string> = {},
  onProgress?: (msg: string) => void,
): Promise<ValidatedSubscenes> {
  const packets: ValidatedSubsceneItem[] = []

  for (let i = 0; i < proposalLog.packets.length; i++) {
    const proposalItem = proposalLog.packets[i]
    const stateItem = stateLog.packets[i]
    const packet = packetLog.packets[i]
    const entry = validatedLog.validated[i]
    if (!proposalItem || !stateItem || !packet || !entry) continue

    onProgress?.(`SUB.3: validating subscenes for ${packet.scene_id}...`)

    const sceneIndex = entry.validated_scene_index
    const mergedCast = mergeSceneCast(sceneIndex as Record<string, unknown>)

    const result = await llmClient.validateSubscenes({
      scene_id: packet.scene_id,
      start_pid: String(packet.start_pid),
      end_pid: String(packet.end_pid),
      scene_text: packet.scene_text_with_pid_markers,
      scene_summary: ((sceneIndex as Record<string, unknown>).scene_summary as string) ?? "",
      start_state_json: formatJsonParam(packet.start_state),
      end_state_json: formatJsonParam(packet.end_state),
      cast_json: formatJsonParam(mergedCast),
      candidates_json: formatJsonParam(proposalItem.candidate_subscenes),
      state_records_json: formatJsonParam(stateItem.records),
    })

    packets.push({
      scene_id: packet.scene_id,
      validated_subscenes: (result.validated_subscenes as ValidatedSubsceneItem["validated_subscenes"]) ?? [],
      original_count: (result.original_count as number) ?? 0,
      accepted_count: (result.accepted_count as number) ?? 0,
      merged_count: (result.merged_count as number) ?? 0,
      rejected_count: (result.rejected_count as number) ?? 0,
    })
  }

  const runId = `subscene_validated__${docId}__${chapterId}`
  return {
    run_id: runId,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: "SUB.3",
    method: "llm",
    parents,
    packets,
  }
}
