/**
 * SUB.4 — Intervention Packaging (LLM)
 * Port of Story-Decomposition/src/viewer/intervention_packaging.py
 */

import type {
  ValidatedSubscenes,
  ScenePackets,
  GroundedSceneModel,
  InterventionPackages,
  InterventionPackageItem,
} from "@/types/schema"
import type { LLMClient } from "@/lib/llm-client"
import { formatJsonParam } from "@/lib/prompt-loader"

export async function runInterventionPackaging(
  validationLog: ValidatedSubscenes,
  packetLog: ScenePackets,
  validatedSceneLog: GroundedSceneModel,
  llmClient: LLMClient,
  docId: string,
  chapterId: string,
  parents: Record<string, string> = {},
  onProgress?: (msg: string) => void,
): Promise<InterventionPackages> {
  const packets: InterventionPackageItem[] = []

  for (let i = 0; i < validationLog.packets.length; i++) {
    const valItem = validationLog.packets[i]
    const packet = packetLog.packets[i]
    const entry = validatedSceneLog.validated[i]
    if (!valItem || !packet || !entry) continue

    onProgress?.(`SUB.4: packaging interventions for ${packet.scene_id}...`)

    const sceneIndex = entry.validated_scene_index
    const prevPacket = i > 0 ? packetLog.packets[i - 1] : undefined

    const result = await llmClient.packageInterventions({
      scene_id: packet.scene_id,
      scene_summary: ((sceneIndex as Record<string, unknown>).scene_summary as string) ?? "",
      onstage_cast_json: formatJsonParam((sceneIndex as Record<string, unknown>).onstage_cast ?? []),
      prev_end_state_json: formatJsonParam(prevPacket?.end_state ?? {}),
      subscenes_json: formatJsonParam(valItem.validated_subscenes),
    })

    packets.push({
      scene_id: packet.scene_id,
      subscene_ui_units:
        (result.subscene_ui_units as InterventionPackageItem["subscene_ui_units"]) ??
        (result.units as InterventionPackageItem["subscene_ui_units"]) ??
        [],
    })
  }

  const runId = `intervention_packages__${docId}__${chapterId}`
  return {
    run_id: runId,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: "SUB.4",
    method: "llm",
    parents,
    packets,
  }
}
