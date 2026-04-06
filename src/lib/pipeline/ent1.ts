/**
 * ENT.1 — Mention Extraction (LLM path only)
 * Port of Story-Decomposition/src/viewer/mention_extraction.py
 */

import type { RawChapter, ContentUnits, MentionCandidates, Mention } from "@/types/schema"
import type { LLMClient } from "@/lib/llm-client"
import { hasExactMentionLocation, resolveMentionLocation } from "@/lib/mention-locations"
import { formatParagraphsForLLM, normalizePidKey } from "@/lib/prompt-loader"

const MENTION_EXTRACTION_BATCH_PARAGRAPHS = 8
const MENTION_EXTRACTION_BATCH_CHARS = 6000

function resolveContentUnitPid(
  unit: ContentUnits["units"][number] | undefined,
  fallbackParagraphPid?: unknown,
): string {
  return normalizePidKey(unit?.pid ?? fallbackParagraphPid)
}

function chunkParagraphsForMentionExtraction(
  paragraphs: RawChapter["paragraphs"],
): Array<RawChapter["paragraphs"]> {
  const batches: Array<RawChapter["paragraphs"]> = []
  let currentBatch: RawChapter["paragraphs"] = []
  let currentChars = 0

  for (const paragraph of paragraphs) {
    const paragraphChars = paragraph.text.length
    const wouldOverflowCount = currentBatch.length >= MENTION_EXTRACTION_BATCH_PARAGRAPHS
    const wouldOverflowChars =
      currentBatch.length > 0 &&
      currentChars + paragraphChars > MENTION_EXTRACTION_BATCH_CHARS

    if (wouldOverflowCount || wouldOverflowChars) {
      batches.push(currentBatch)
      currentBatch = []
      currentChars = 0
    }

    currentBatch.push(paragraph)
    currentChars += paragraphChars
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch)
  }

  return batches
}

function isLikelyTruncatedJsonError(error: unknown): boolean {
  return String(error).includes("Unexpected end of JSON input")
}

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
    classifyLog.units
      .filter((u) => u.is_story_text)
      .map((u, index) => resolveContentUnitPid(u, chapter.paragraphs[index]?.pid)),
  )

  const narrativeParagraphs = chapter.paragraphs.filter((paragraph) =>
    narrativePids.has(normalizePidKey(paragraph.pid)),
  )
  const paragraphBatches = chunkParagraphsForMentionExtraction(narrativeParagraphs)

  const paragraphTextByPid = new Map(chapter.paragraphs.map((paragraph) => [paragraph.pid, paragraph.text]))
  const fallbackOccurrenceByPidSpan = new Map<string, number>()
  let mentionCounter = 0
  const mentions: Mention[] = []

  async function extractBatchMentions(
    batch: RawChapter["paragraphs"],
    batchLabel: string,
  ): Promise<Mention[]> {
    onProgress?.(`ENT.1: ${batchLabel}...`)

    try {
      const chapterTextWithPids = formatParagraphsForLLM(batch)
      const result = await llmClient.extractMentions({
        chapter_text_with_pids: chapterTextWithPids,
      })

      return ((result.mentions as Mention[]) ?? [])
        .flatMap((mention) => {
          if (typeof mention.pid !== "number") return []
          if (typeof mention.span !== "string" || !mention.span.trim()) return []

          const paragraphText = paragraphTextByPid.get(mention.pid)
          if (!paragraphText) return []

          const locationKey = `${mention.pid}::${mention.span}`
          const fallbackOccurrenceIndex = (fallbackOccurrenceByPidSpan.get(locationKey) ?? 0) + 1

          const resolvedLocation = hasExactMentionLocation(
            paragraphText,
            mention.span,
            mention.start_char,
            mention.end_char,
          )
            ? {
                start_char: mention.start_char as number,
                end_char: mention.end_char as number,
              }
            : resolveMentionLocation(paragraphText, mention.span, fallbackOccurrenceIndex)

          if (!resolvedLocation) return []

          fallbackOccurrenceByPidSpan.set(locationKey, fallbackOccurrenceIndex)
          mentionCounter += 1

          return [{
            ...mention,
            mention_id:
              typeof mention.mention_id === "string" && mention.mention_id.trim()
                ? mention.mention_id
                : `${chapterId}_m${String(mentionCounter).padStart(4, "0")}`,
            start_char: resolvedLocation.start_char,
            end_char: resolvedLocation.end_char,
          }]
        })
    } catch (error) {
      if (batch.length > 1 && isLikelyTruncatedJsonError(error)) {
        const midpoint = Math.ceil(batch.length / 2)
        const left = batch.slice(0, midpoint)
        const right = batch.slice(midpoint)
        const leftMentions = await extractBatchMentions(left, `${batchLabel}.1`)
        const rightMentions = await extractBatchMentions(right, `${batchLabel}.2`)
        return [...leftMentions, ...rightMentions]
      }
      throw error
    }
  }

  for (let batchIndex = 0; batchIndex < paragraphBatches.length; batchIndex++) {
    const batch = paragraphBatches[batchIndex]
    const batchMentions = await extractBatchMentions(
      batch,
      `batch ${batchIndex + 1}/${paragraphBatches.length}`,
    )
    mentions.push(...batchMentions)
  }

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
