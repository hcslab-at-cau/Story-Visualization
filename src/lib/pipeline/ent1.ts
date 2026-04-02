/**
 * ENT.1 — Mention Extraction (LLM path only)
 * Port of Story-Decomposition/src/viewer/mention_extraction.py
 */

import type { RawChapter, ContentUnits, MentionCandidates, Mention } from "@/types/schema"
import type { LLMClient } from "@/lib/llm-client"
import { formatParagraphsForLLM } from "@/lib/prompt-loader"

export async function runMentionExtraction(
  chapter: RawChapter,
  llmClient: LLMClient,
  docId: string,
  chapterId: string,
  classifyLog: ContentUnits,
  parents: Record<string, string> = {},
  onProgress?: (msg: string) => void,
): Promise<MentionCandidates> {
  onProgress?.("ENT.1: extracting mentions...")

  const narrativePids = new Set(
    classifyLog.units.filter((u) => u.is_story_text).map((u) => u.pid),
  )

  const chapterTextWithPids = formatParagraphsForLLM(chapter.paragraphs, narrativePids)

  const result = await llmClient.extractMentions({
    chapter_text_with_pids: chapterTextWithPids,
  })

  const mentions = (result.mentions as Mention[]) ?? []

  const runId = `mentions_llm__${docId}__${chapterId}`
  return {
    run_id: runId,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: "ENT.1",
    method: "llm",
    parents,
    mentions,
  }
}
