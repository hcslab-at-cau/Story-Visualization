/**
 * SUB.1 — Subscene Proposal (LLM)
 * Port of Story-Decomposition/src/viewer/subscene_proposal.py
 */

import type {
  GroundedSceneModel,
  ScenePackets,
  SubsceneProposals,
  SubsceneProposalItem,
} from "@/types/schema"
import type { LLMClient } from "@/lib/llm-client"
import { formatJsonParam } from "@/lib/prompt-loader"

export async function runSubsceneProposal(
  validatedLog: GroundedSceneModel,
  packetLog: ScenePackets,
  llmClient: LLMClient,
  docId: string,
  chapterId: string,
  parents: Record<string, string> = {},
  onProgress?: (msg: string) => void,
): Promise<SubsceneProposals> {
  const packets: SubsceneProposalItem[] = []

  for (let i = 0; i < validatedLog.validated.length; i++) {
    const entry = validatedLog.validated[i]
    const packet = packetLog.packets[i]
    if (!entry || !packet) continue

    onProgress?.(`SUB.1: proposing subscenes for ${packet.scene_id}...`)

    const sceneIndex = entry.validated_scene_index

    const result = await llmClient.proposeSubscenes({
      scene_id: packet.scene_id,
      start_pid: String(packet.start_pid),
      end_pid: String(packet.end_pid),
      scene_text: packet.scene_text_with_pid_markers,
      current_places_json: formatJsonParam(packet.scene_current_places),
      start_state_json: formatJsonParam(packet.start_state),
      end_state_json: formatJsonParam(packet.end_state),
      onstage_cast_json: formatJsonParam((sceneIndex as Record<string, unknown>).onstage_cast ?? []),
      main_actions_json: formatJsonParam((sceneIndex as Record<string, unknown>).main_actions ?? []),
      goals_json: formatJsonParam((sceneIndex as Record<string, unknown>).goals ?? []),
      objects_json: formatJsonParam((sceneIndex as Record<string, unknown>).objects ?? []),
      scene_summary: ((sceneIndex as Record<string, unknown>).scene_summary as string) ?? "",
    })

    packets.push({
      scene_id: packet.scene_id,
      candidate_subscenes:
        (result.candidate_subscenes as SubsceneProposalItem["candidate_subscenes"]) ??
        (result.candidates as SubsceneProposalItem["candidate_subscenes"]) ??
        [],
    })
  }

  const runId = `subscene_proposal__${docId}__${chapterId}`
  return {
    run_id: runId,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: "SUB.1",
    method: "llm",
    parents,
    packets,
  }
}
