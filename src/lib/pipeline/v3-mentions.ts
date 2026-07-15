import type { ContentUnits, Mention, MentionType, RawChapter } from "@/types/schema"
import type { LLMClient } from "@/lib/llm-client"
import { hasExactMentionLocation, resolveMentionLocation } from "@/lib/mention-locations"
import { formatParagraphsForLLM, normalizePidKey } from "@/lib/prompt-loader"
import {
  V3_SCENE_MENTION_PROFILE,
  countV3Mentions,
  isMentionType,
  normalizeSceneBoundaryRelevance,
  normalizeSceneMentionRole,
  normalizeV3SceneMention,
  type SceneBoundaryMentionRole,
  type V3DroppedMention,
  type V3MentionCandidates,
  type V3SceneMention,
} from "@/lib/pipeline/v3-mention-normalization"

const V3_MENTION_BATCH_PARAGRAPHS = 4
const V3_MENTION_BATCH_CHARS = 3000
const V3_MENTION_PARALLELISM = 4

interface RawV3Mention {
  pid?: unknown
  span?: unknown
  start_char?: unknown
  end_char?: unknown
  mention_type?: unknown
  normalized?: unknown
  scene_role?: unknown
  boundary_relevance?: unknown
  boundary_signal?: unknown
  rationale?: unknown
}

interface BatchResult {
  mentions: V3SceneMention[]
  drops: V3DroppedMention[]
  attempted: number
}

function chunkParagraphs(paragraphs: RawChapter["paragraphs"]): Array<RawChapter["paragraphs"]> {
  const batches: Array<RawChapter["paragraphs"]> = []
  let current: RawChapter["paragraphs"] = []
  let currentChars = 0

  for (const paragraph of paragraphs) {
    const wouldOverflowCount = current.length >= V3_MENTION_BATCH_PARAGRAPHS
    const wouldOverflowChars =
      current.length > 0 && currentChars + paragraph.text.length > V3_MENTION_BATCH_CHARS

    if (wouldOverflowCount || wouldOverflowChars) {
      batches.push(current)
      current = []
      currentChars = 0
    }

    current.push(paragraph)
    currentChars += paragraph.text.length
  }

  if (current.length > 0) batches.push(current)
  return batches
}

function isLikelyTruncatedJsonError(error: unknown): boolean {
  const message = error instanceof Error
    ? `${error.message} ${String((error as { cause?: unknown }).cause ?? "")}`
    : String(error)

  return /Unexpected end of JSON input|finish_reason=length|truncated|unterminated/i.test(message)
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

function narrativeParagraphsFromContentUnits(
  chapter: RawChapter,
  classifyLog: ContentUnits,
): RawChapter["paragraphs"] {
  const narrativePids = new Set(
    classifyLog.units
      .filter((unit) => unit.is_story_text)
      .map((unit) => normalizePidKey(unit.pid)),
  )

  return chapter.paragraphs.filter((paragraph) =>
    narrativePids.has(normalizePidKey(paragraph.pid)),
  )
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function droppedCandidate(
  reason: string,
  candidate: RawV3Mention,
  role?: SceneBoundaryMentionRole,
): V3DroppedMention {
  const mentionType = isMentionType(candidate.mention_type) ? candidate.mention_type : undefined
  const relevance = mentionType && role
    ? normalizeSceneBoundaryRelevance(mentionType, role, candidate.boundary_relevance)
    : undefined

  return {
    reason,
    pid: typeof candidate.pid === "number" ? candidate.pid : undefined,
    span: textValue(candidate.span),
    mention_type: mentionType,
    start_char: typeof candidate.start_char === "number" ? candidate.start_char : undefined,
    end_char: typeof candidate.end_char === "number" ? candidate.end_char : undefined,
    normalized: textValue(candidate.normalized),
    scene_role: role,
    boundary_relevance: relevance,
    rationale: textValue(candidate.rationale),
  }
}

function countDropReason(counts: Map<string, number>, reason: string): void {
  counts.set(reason, (counts.get(reason) ?? 0) + 1)
}

function finalizeMentionIds(mentions: V3SceneMention[], chapterId: string): void {
  const mentionIdCounts = new Map<string, number>()

  mentions.forEach((mention, index) => {
    if (typeof mention.mention_id === "string" && mention.mention_id.trim()) {
      const count = (mentionIdCounts.get(mention.mention_id) ?? 0) + 1
      mentionIdCounts.set(mention.mention_id, count)
      if (count === 1) return
    }

    mention.mention_id = `${chapterId}_v3m${String(index + 1).padStart(4, "0")}`
  })
}

export async function runV3MentionExtraction(
  chapter: RawChapter,
  llmClient: LLMClient,
  docId: string,
  chapterId: string,
  classifyLog: ContentUnits,
  parents: Record<string, string> = {},
  onProgress?: (progress: string) => void,
): Promise<V3MentionCandidates> {
  onProgress?.("ENT.1: extracting v3 scene-boundary mentions...")

  const narrativeParagraphs = narrativeParagraphsFromContentUnits(chapter, classifyLog)
  const paragraphTextByPid = new Map(chapter.paragraphs.map((paragraph) => [paragraph.pid, paragraph.text]))
  const paragraphBatches = chunkParagraphs(narrativeParagraphs)
  const droppedByReason = new Map<string, number>()
  let completedParagraphs = 0

  async function extractBatch(batch: RawChapter["paragraphs"], batchLabel: string): Promise<BatchResult> {
    onProgress?.(`ENT.1: ${batchLabel} running (${batch.length} paragraphs)`)

    try {
      const result = await llmClient.extractSceneBoundaryMentions({
        chapter_text_with_pids: formatParagraphsForLLM(batch),
      })
      const rawMentions = Array.isArray(result.mentions) ? result.mentions as RawV3Mention[] : []
      const excludedCandidates = Array.isArray(result.excluded_candidates)
        ? result.excluded_candidates as RawV3Mention[]
        : []
      const fallbackOccurrenceByPidSpan = new Map<string, number>()
      const mentions: V3SceneMention[] = []
      const drops: V3DroppedMention[] = excludedCandidates.map((candidate) => {
        const mentionType = isMentionType(candidate.mention_type) ? candidate.mention_type : "place"
        const role = normalizeSceneMentionRole(mentionType, candidate.scene_role)
        return droppedCandidate("excluded candidate", candidate, role)
      })

      for (const candidate of rawMentions) {
        if (typeof candidate.pid !== "number") {
          drops.push(droppedCandidate("invalid pid", candidate))
          continue
        }
        if (!isMentionType(candidate.mention_type)) {
          drops.push(droppedCandidate("invalid mention type", candidate))
          continue
        }

        const span = textValue(candidate.span)
        if (!span) {
          drops.push(droppedCandidate("empty span", candidate))
          continue
        }

        const paragraphText = paragraphTextByPid.get(candidate.pid)
        if (!paragraphText) {
          drops.push(droppedCandidate("paragraph not found", candidate))
          continue
        }

        const locationKey = `${candidate.pid}::${span}`
        const fallbackOccurrenceIndex = (fallbackOccurrenceByPidSpan.get(locationKey) ?? 0) + 1
        const rawStartChar = typeof candidate.start_char === "number" ? candidate.start_char : undefined
        const rawEndChar = typeof candidate.end_char === "number" ? candidate.end_char : undefined
        const resolvedLocation = hasExactMentionLocation(
          paragraphText,
          span,
          rawStartChar,
          rawEndChar,
        )
          ? {
              start_char: rawStartChar as number,
              end_char: rawEndChar as number,
            }
          : resolveMentionLocation(paragraphText, span, fallbackOccurrenceIndex)

        if (!resolvedLocation) {
          drops.push(droppedCandidate("span location not resolved", candidate))
          continue
        }

        fallbackOccurrenceByPidSpan.set(locationKey, fallbackOccurrenceIndex)

        const mention: Mention = {
          mention_id: textValue((candidate as { mention_id?: unknown }).mention_id) ?? "",
          pid: candidate.pid,
          span,
          start_char: resolvedLocation.start_char,
          end_char: resolvedLocation.end_char,
          mention_type: candidate.mention_type as MentionType,
          normalized: textValue(candidate.normalized),
        }
        const sceneMention = normalizeV3SceneMention(mention, candidate)
        if (sceneMention.boundary_relevance === "excluded") {
          drops.push(droppedCandidate("excluded from scene-boundary mention set", candidate, sceneMention.scene_role))
          continue
        }

        mentions.push(sceneMention)
      }

      completedParagraphs += batch.length
      onProgress?.(`ENT.1: processed ${completedParagraphs}/${narrativeParagraphs.length} narrative paragraphs`)

      return {
        mentions,
        drops,
        attempted: rawMentions.length + excludedCandidates.length,
      }
    } catch (error) {
      if (batch.length > 1 && isLikelyTruncatedJsonError(error)) {
        const midpoint = Math.ceil(batch.length / 2)
        const left = await extractBatch(batch.slice(0, midpoint), `${batchLabel}.1`)
        const right = await extractBatch(batch.slice(midpoint), `${batchLabel}.2`)
        return {
          mentions: [...left.mentions, ...right.mentions],
          drops: [...left.drops, ...right.drops],
          attempted: left.attempted + right.attempted,
        }
      }

      const pidRange = batch.map((paragraph) => `P${paragraph.pid}`).join(", ")
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`ENT.1 ${batchLabel} failed for ${pidRange}: ${message}`, { cause: error })
    }
  }

  onProgress?.(`ENT.1: 0/${narrativeParagraphs.length} narrative paragraphs processed`)

  const batchResults = await mapWithConcurrency(
    paragraphBatches,
    V3_MENTION_PARALLELISM,
    (batch, batchIndex) => extractBatch(batch, `batch ${batchIndex + 1}/${paragraphBatches.length}`),
  )

  const mentions = batchResults.flatMap((batchResult) => batchResult.mentions)
  mentions.sort((a, b) => (
    a.pid - b.pid ||
    (a.start_char ?? 0) - (b.start_char ?? 0) ||
    (a.end_char ?? 0) - (b.end_char ?? 0) ||
    a.mention_type.localeCompare(b.mention_type) ||
    a.span.localeCompare(b.span)
  ))
  finalizeMentionIds(mentions, chapterId)

  const droppedMentions = batchResults.flatMap((batchResult) => batchResult.drops)
  for (const drop of droppedMentions) {
    countDropReason(droppedByReason, drop.reason)
  }

  const attemptedRawMentions = batchResults.reduce((sum, result) => sum + result.attempted, 0)
  const mentionCounts = countV3Mentions(mentions)

  return {
    run_id: `v3_scene_mentions__${docId}__${chapterId}`,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: "ENT.1",
    method: "llm",
    parents,
    extraction_profile: V3_SCENE_MENTION_PROFILE,
    scene_boundary_dimensions: ["time", "space", "character_constellation"],
    deferred_dimensions: ["action_focus", "event_sequence", "focalization"],
    extraction_stats: {
      narrative_paragraphs: narrativeParagraphs.length,
      attempted_raw_mentions: attemptedRawMentions,
      accepted_mentions: mentions.length,
      dropped_mentions: droppedMentions.length,
      dropped_by_reason: Object.fromEntries(droppedByReason.entries()),
      excluded_candidates: droppedMentions.length,
      ...mentionCounts,
    },
    dropped_mentions: droppedMentions,
    mentions,
  }
}
