/**
 * SCENE.3 — Scene Validation (rule precheck + LLM)
 * Port of Story-Decomposition/src/viewer/scene_validation.py
 */

import type {
  ScenePackets,
  SceneIndexDraft,
  EntityGraph,
  RefinedStateFrames,
  GroundedSceneModel,
  GroundedSceneEntry,
  ScenePacket,
  SceneIndex,
} from "@/types/schema"
import type { LLMClient } from "@/lib/llm-client"
import { formatJsonParam } from "@/lib/prompt-loader"

// ---------------------------------------------------------------------------
// Rule pre-check
// ---------------------------------------------------------------------------

interface PrecheckIssue {
  type: string
  field: string
  detail: string
}

function precheck(
  sceneIndex: SceneIndex,
  packet: ScenePacket,
): PrecheckIssue[] {
  const issues: PrecheckIssue[] = []
  const validPids = new Set(packet.pids)

  // 1. Check evidence_pid ranges
  const checkGroundedItems = (field: string, items: Array<{ evidence_pids: number[] }>) => {
    for (const item of items) {
      for (const pid of item.evidence_pids) {
        if (!validPids.has(pid)) {
          issues.push({ type: "out_of_range_evidence", field, detail: `pid ${pid} not in scene` })
        }
      }
    }
  }

  checkGroundedItems("onstage_cast", sceneIndex.onstage_cast)
  checkGroundedItems("main_actions", sceneIndex.main_actions)
  checkGroundedItems("goals", sceneIndex.goals)

  // 2. onstage_cast vs scene_cast_union
  const castUnionSet = new Set(packet.scene_cast_union)
  for (const c of sceneIndex.onstage_cast) {
    if (!castUnionSet.has(c.name)) {
      issues.push({
        type: "cast_not_in_union",
        field: "onstage_cast",
        detail: `${c.name} not in scene_cast_union`,
      })
    }
  }

  // 3. actual_place vs mentioned_places confusion
  const scenePlace = sceneIndex.scene_place as Record<string, unknown>
  const actualPlace = scenePlace?.actual_place as string | undefined
  if (actualPlace && !packet.scene_current_places.includes(actualPlace)) {
    if (packet.scene_mentioned_places.includes(actualPlace)) {
      issues.push({
        type: "actual_place_is_mentioned_only",
        field: "scene_place",
        detail: `${actualPlace} is only mentioned, not the current place`,
      })
    }
  }

  return issues
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runSceneIndexValidation(
  packetLog: ScenePackets,
  indexLog: SceneIndexDraft,
  entityLog: EntityGraph,
  validatedLog: RefinedStateFrames,
  llmClient: LLMClient,
  docId: string,
  chapterId: string,
  parents: Record<string, string> = {},
  onProgress?: (msg: string) => void,
): Promise<GroundedSceneModel> {
  const validated: GroundedSceneEntry[] = []

  for (let i = 0; i < packetLog.packets.length; i++) {
    const packet = packetLog.packets[i]
    const sceneIndex = indexLog.indices[i]
    if (!sceneIndex) continue

    onProgress?.(`SCENE.3: validating ${packet.scene_id}...`)

    const precheckIssues = precheck(sceneIndex, packet)

    const result = await llmClient.validateSceneIndex({
      scene_id: packet.scene_id,
      start_pid: String(packet.start_pid),
      end_pid: String(packet.end_pid),
      entity_registry_json: formatJsonParam(packet.entity_registry),
      start_state_json: formatJsonParam(packet.start_state),
      end_state_json: formatJsonParam(packet.end_state),
      scene_text: packet.scene_text_with_pid_markers,
      scene_index_json: formatJsonParam(sceneIndex),
      precheck_issues_json: formatJsonParam(precheckIssues),
    })

    validated.push(result as unknown as GroundedSceneEntry)
  }

  const runId = `scene_validated__${docId}__${chapterId}`
  return {
    run_id: runId,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: "SCENE.3",
    method: "rule+llm",
    parents,
    validated,
  }
}
