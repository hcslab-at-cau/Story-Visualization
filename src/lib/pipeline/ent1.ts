/**
 * ENT.1 — Mention Extraction (LLM path only)
 * Port of Story-Decomposition/src/viewer/mention_extraction.py
 */

import type { RawChapter, ContentUnits, MentionCandidates, Mention } from "@/types/schema"
import type { LLMClient } from "@/lib/llm-client"
import { hasExactMentionLocation, resolveMentionLocation } from "@/lib/mention-locations"
import { formatParagraphsForLLM, normalizePidKey } from "@/lib/prompt-loader"

const MENTION_EXTRACTION_BATCH_PARAGRAPHS = 4
const MENTION_EXTRACTION_BATCH_CHARS = 3000
const MENTION_EXTRACTION_PARALLELISM = 4

interface MentionExtractionProgress {
  message: string
  completed?: number
  total?: number
  unit?: "paragraphs"
}

type MentionExtractionProgressReporter = (progress: string | MentionExtractionProgress) => void

interface MentionExtractionDrop {
  reason: string
  mention?: Partial<Mention>
}

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
  const message = error instanceof Error
    ? `${error.message} ${String((error as { cause?: unknown }).cause ?? "")}`
    : String(error)

  return /Unexpected end of JSON input|finish_reason=length|truncated|unterminated/i.test(message)
}

function countDropReason(
  counts: Map<string, number>,
  reason: string,
): void {
  counts.set(reason, (counts.get(reason) ?? 0) + 1)
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await worker(items[index], index)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()),
  )

  return results
}

export async function runMentionExtraction(
  chapter: RawChapter,
  llmClient: LLMClient,
  docId: string,
  chapterId: string,
  classifyLog: ContentUnits,
  parents: Record<string, string> = {},
  onProgress?: MentionExtractionProgressReporter,
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
  const droppedByReason = new Map<string, number>()
  let attemptedRawMentions = 0
  let completedParagraphs = 0
  const mentions: Mention[] = []

  async function extractBatchMentions(
    batch: RawChapter["paragraphs"],
    batchLabel: string,
  ): Promise<{ mentions: Mention[]; drops: MentionExtractionDrop[]; attempted: number }> {
    onProgress?.({
      message: `ENT.1: ${batchLabel} running (${batch.length} paragraphs)...`,
      completed: completedParagraphs,
      total: narrativeParagraphs.length,
      unit: "paragraphs",
    })

    try {
      const chapterTextWithPids = formatParagraphsForLLM(batch)
      const result = await llmClient.extractMentions({
        chapter_text_with_pids: chapterTextWithPids,
      })
      const rawMentions = ((result.mentions as Mention[]) ?? [])
      const fallbackOccurrenceByPidSpan = new Map<string, number>()
      const drops: MentionExtractionDrop[] = []
      const batchMentions = rawMentions
        .flatMap((mention) => {
          if (typeof mention.pid !== "number") {
            drops.push({ reason: "invalid pid", mention })
            return []
          }
          if (typeof mention.span !== "string" || !mention.span.trim()) {
            drops.push({ reason: "empty span", mention })
            return []
          }

          const paragraphText = paragraphTextByPid.get(mention.pid)
          if (!paragraphText) {
            drops.push({ reason: "paragraph not found", mention })
            return []
          }

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

          if (!resolvedLocation) {
            drops.push({ reason: "span location not resolved", mention })
            return []
          }

          fallbackOccurrenceByPidSpan.set(locationKey, fallbackOccurrenceIndex)

          return [{
            ...mention,
            start_char: resolvedLocation.start_char,
            end_char: resolvedLocation.end_char,
          }]
        })
      completedParagraphs += batch.length
      onProgress?.({
        message: `ENT.1: processed ${completedParagraphs}/${narrativeParagraphs.length} narrative paragraphs`,
        completed: completedParagraphs,
        total: narrativeParagraphs.length,
        unit: "paragraphs",
      })
      return { mentions: batchMentions, drops, attempted: rawMentions.length }
    } catch (error) {
      if (batch.length > 1 && isLikelyTruncatedJsonError(error)) {
        const midpoint = Math.ceil(batch.length / 2)
        const left = batch.slice(0, midpoint)
        const right = batch.slice(midpoint)
        const leftMentions = await extractBatchMentions(left, `${batchLabel}.1`)
        const rightMentions = await extractBatchMentions(right, `${batchLabel}.2`)
        return {
          mentions: [...leftMentions.mentions, ...rightMentions.mentions],
          drops: [...leftMentions.drops, ...rightMentions.drops],
          attempted: leftMentions.attempted + rightMentions.attempted,
        }
      }
      throw error
    }
  }

  onProgress?.({
    message: `ENT.1: 0/${narrativeParagraphs.length} narrative paragraphs processed`,
    completed: 0,
    total: narrativeParagraphs.length,
    unit: "paragraphs",
  })

  const batchResults = await mapWithConcurrency(
    paragraphBatches,
    MENTION_EXTRACTION_PARALLELISM,
    (batch, batchIndex) => extractBatchMentions(
      batch,
      `batch ${batchIndex + 1}/${paragraphBatches.length}`,
    ),
  )

  for (const batchResult of batchResults) {
    attemptedRawMentions += batchResult.attempted
    mentions.push(...batchResult.mentions)
    for (const drop of batchResult.drops) {
      countDropReason(droppedByReason, drop.reason)
    }
  }

  mentions.sort((a, b) => (
    a.pid - b.pid ||
    (a.start_char ?? 0) - (b.start_char ?? 0) ||
    (a.end_char ?? 0) - (b.end_char ?? 0) ||
    String(a.mention_type).localeCompare(String(b.mention_type)) ||
    String(a.span).localeCompare(String(b.span))
  ))
  const mentionIdCounts = new Map<string, number>()
  mentions.forEach((mention, index) => {
    if (typeof mention.mention_id === "string" && mention.mention_id.trim()) {
      const count = (mentionIdCounts.get(mention.mention_id) ?? 0) + 1
      mentionIdCounts.set(mention.mention_id, count)
      if (count === 1) return
    }

    mention.mention_id = `${chapterId}_m${String(index + 1).padStart(4, "0")}`
  })

  const runId = `mentions_llm__${docId}__${chapterId}`
  return {
    run_id: runId,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: "ENT.1",
    method: "llm",
    parents,
    extraction_stats: {
      narrative_paragraphs: narrativeParagraphs.length,
      attempted_raw_mentions: attemptedRawMentions,
      accepted_mentions: mentions.length,
      dropped_mentions: Math.max(0, attemptedRawMentions - mentions.length),
      dropped_by_reason: Object.fromEntries(droppedByReason.entries()),
    },
    dropped_mentions: batchResults.flatMap((batchResult) =>
      batchResult.drops.map((drop) => ({
        reason: drop.reason,
        pid: typeof drop.mention?.pid === "number" ? drop.mention.pid : undefined,
        span: typeof drop.mention?.span === "string" ? drop.mention.span : undefined,
        mention_type: drop.mention?.mention_type,
        start_char: typeof drop.mention?.start_char === "number" ? drop.mention.start_char : undefined,
        end_char: typeof drop.mention?.end_char === "number" ? drop.mention.end_char : undefined,
        normalized: typeof drop.mention?.normalized === "string" ? drop.mention.normalized : undefined,
      })),
    ),
    mentions,
  }
}
