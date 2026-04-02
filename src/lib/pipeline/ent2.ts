/**
 * ENT.2 — Mention Validation
 * Port of Story-Decomposition/src/viewer/mention_validation.py
 */

import type {
  RawChapter,
  MentionCandidates,
  FilteredMentions,
  ValidatedMention,
} from "@/types/schema"
import type { LLMClient } from "@/lib/llm-client"
import { formatJsonParam } from "@/lib/prompt-loader"

const BATCH_SIZE = 20

export async function runMentionValidation(
  chapter: RawChapter,
  mentionLog: MentionCandidates,
  llmClient: LLMClient,
  docId: string,
  chapterId: string,
  parents: Record<string, string> = {},
  onProgress?: (msg: string) => void,
): Promise<FilteredMentions> {
  onProgress?.("ENT.2: validating mentions...")

  // Group mentions by paragraph
  const mentionsByPid = new Map<number, typeof mentionLog.mentions>()
  for (const m of mentionLog.mentions) {
    const list = mentionsByPid.get(m.pid) ?? []
    list.push(m)
    mentionsByPid.set(m.pid, list)
  }

  // Collect unique paragraph pids in order
  const allPids = chapter.paragraphs.map((p) => p.pid)
  const pidToText = new Map(chapter.paragraphs.map((p) => [p.pid, p.text]))

  const validated: ValidatedMention[] = []

  // Process in batches of BATCH_SIZE paragraphs
  for (let start = 0; start < allPids.length; start += BATCH_SIZE) {
    const batchPids = allPids.slice(start, start + BATCH_SIZE)
    const batchParas = batchPids.map((pid) => ({
      pid,
      text: pidToText.get(pid) ?? "",
    }))
    const batchMentions = batchPids.flatMap((pid) => mentionsByPid.get(pid) ?? [])

    if (batchMentions.length === 0) continue

    onProgress?.(`ENT.2: batch ${start / BATCH_SIZE + 1}...`)

    const result = await llmClient.validateMentions({
      paragraphs_json: formatJsonParam(batchParas),
      mentions_json: formatJsonParam(batchMentions),
    })

    const batchValidated = (result.validated as Array<{
      mention_id: string
      valid: boolean
      reason?: string
    }>) ?? []

    // Merge validation results with original mention data
    const validationMap = new Map(batchValidated.map((v) => [v.mention_id, v]))
    for (const m of batchMentions) {
      const v = validationMap.get(m.mention_id)
      validated.push({
        ...m,
        valid: v?.valid ?? true,
        reason: v?.reason,
      })
    }
  }

  const runId = `validated_llm__${docId}__${chapterId}`
  return {
    run_id: runId,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: "ENT.2",
    method: "llm",
    parents,
    validated,
  }
}

/** Helper: extract only valid mentions as MentionCandidates. */
export function toFilteredCandidates(log: FilteredMentions): MentionCandidates {
  return {
    ...log,
    stage_id: "ENT.1",
    method: "llm",
    mentions: log.validated.filter((m) => m.valid).map((m) => ({
      mention_id: m.mention_id,
      pid: m.pid,
      span: m.span,
      mention_type: m.mention_type,
      normalized: m.normalized,
    })),
  }
}
