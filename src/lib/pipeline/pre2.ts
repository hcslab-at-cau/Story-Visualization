/**
 * PRE.2 — Content Classification
 * Port of Story-Decomposition/src/viewer/content_classify.py
 */

import type { RawChapter, ContentUnits, ContentUnit } from "@/types/schema"
import type { LLMClient } from "@/lib/llm-client"
import { formatJsonParam } from "@/lib/prompt-loader"

export async function runContentClassification(
  chapter: RawChapter,
  llmClient: LLMClient,
  docId: string,
  chapterId: string,
  parents: Record<string, string> = {},
  onProgress?: (msg: string) => void,
): Promise<ContentUnits> {
  onProgress?.("PRE.2: classifying content...")

  const paragraphsJson = formatJsonParam(
    chapter.paragraphs.map((p) => ({ pid: p.pid, text: p.text })),
  )

  const result = await llmClient.classifyContent({
    buffer_sentences: paragraphsJson,
  })

  const units = (result.units as ContentUnit[]) ?? []

  const runId = `classify__${docId}__${chapterId}`
  return {
    run_id: runId,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: "PRE.2",
    parents,
    units,
  }
}
