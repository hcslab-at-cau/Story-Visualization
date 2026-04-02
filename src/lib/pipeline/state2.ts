/**
 * STATE.2 — State Validation (LLM)
 * Port of Story-Decomposition/src/viewer/state_validation.py
 */

import type {
  StateFrames,
  EntityGraph,
  RawChapter,
  ContentUnits,
  RefinedStateFrames,
  ValidatedFrame,
} from "@/types/schema"
import type { LLMClient } from "@/lib/llm-client"
import { formatJsonParam, formatParagraphsForLLM } from "@/lib/prompt-loader"

export async function runStateValidation(
  stateLog: StateFrames,
  entityLog: EntityGraph,
  chapter: RawChapter,
  classifyLog: ContentUnits,
  llmClient: LLMClient,
  docId: string,
  chapterId: string,
  parents: Record<string, string> = {},
  onProgress?: (msg: string) => void,
): Promise<RefinedStateFrames> {
  onProgress?.("STATE.2: validating state frames...")

  // entity_id → canonical_name
  const eidToName = new Map(entityLog.entities.map((e) => [e.entity_id, e.canonical_name]))

  // narrative pid set
  const narrativePids = new Set(
    classifyLog.units.filter((u) => u.is_story_text).map((u) => u.pid),
  )

  // entity inventory for LLM context
  const entityInventory = entityLog.entities.map((e) => ({
    entity_id: e.entity_id,
    canonical_name: e.canonical_name,
    type: e.mention_type,
  }))

  // Convert STATE.1 frames to canonical names
  const proposedFrames = stateLog.frames.map((f) => ({
    pid: f.pid,
    is_narrative: narrativePids.has(f.pid),
    proposed_state: {
      current_place: f.state.primary_place
        ? eidToName.get(f.state.primary_place)
        : null,
      active_cast: f.state.active_cast.map((eid) => eidToName.get(eid) ?? eid),
      time_signals: f.transitions.time_signals,
    },
  }))

  const result = await llmClient.validateState({
    entity_inventory_json: formatJsonParam(entityInventory),
    chapter_text_with_pids: formatParagraphsForLLM(chapter.paragraphs),
    proposed_frames_json: formatJsonParam(proposedFrames),
  })

  const frames = (result.frames as ValidatedFrame[]) ?? []

  const runId = `state_validated__${docId}__${chapterId}`
  return {
    run_id: runId,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: "STATE.2",
    method: "llm",
    parents,
    frames,
  }
}
