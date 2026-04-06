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
import { hasExactMentionLocation, hasStandaloneBoundary } from "@/lib/mention-locations"
import { formatJsonParam } from "@/lib/prompt-loader"

const VALIDATION_BATCH_PARAGRAPHS = 8
const VALIDATION_BATCH_CHARS = 5000
const VALIDATION_BATCH_MENTIONS = 36

function normalizeMentionId(
  mention: MentionCandidates["mentions"][number],
  chapterId: string,
  index: number,
): string {
  return typeof mention.mention_id === "string" && mention.mention_id.trim()
    ? mention.mention_id
    : `${chapterId}_m${String(index + 1).padStart(4, "0")}`
}

function hasStandaloneOccurrence(paragraphText: string, span: string): boolean {
  if (!span.trim()) return false

  let fromIndex = 0
  while (fromIndex <= paragraphText.length) {
    const start = paragraphText.indexOf(span, fromIndex)
    if (start < 0) return false

    if (hasStandaloneBoundary(paragraphText, start, span.length)) {
      return true
    }

    fromIndex = start + Math.max(1, span.length)
  }

  return false
}

function getRuleBasedMentionRejection(
  mention: MentionCandidates["mentions"][number],
  paragraphText: string,
): string | null {
  if (typeof mention.span !== "string" || !mention.span.trim()) {
    return "Invalid mention span: empty or non-string span."
  }

  if (
    hasExactMentionLocation(
      paragraphText,
      mention.span,
      mention.start_char,
      mention.end_char,
    )
  ) {
    return null
  }

  if (!paragraphText.includes(mention.span)) {
    return "Span not found in source paragraph text."
  }

  if (!hasStandaloneOccurrence(paragraphText, mention.span)) {
    return "Substring of a word, not a standalone token or phrase."
  }

  return null
}

function formatRuleBasedReason(reason: string): string {
  return `Rule-based rejection: ${reason}`
}

function isLikelyTruncatedJsonError(error: unknown): boolean {
  return String(error).includes("Unexpected end of JSON input")
}

function chunkPidsForMentionValidation(
  allPids: number[],
  pidToText: Map<number, string>,
  mentionsByPid: Map<number, MentionCandidates["mentions"]>,
): number[][] {
  const batches: number[][] = []
  let currentBatch: number[] = []
  let currentChars = 0
  let currentMentions = 0

  for (const pid of allPids) {
    const paragraphChars = (pidToText.get(pid) ?? "").length
    const paragraphMentions = (mentionsByPid.get(pid) ?? []).length
    const wouldOverflowCount = currentBatch.length >= VALIDATION_BATCH_PARAGRAPHS
    const wouldOverflowChars =
      currentBatch.length > 0 &&
      currentChars + paragraphChars > VALIDATION_BATCH_CHARS
    const wouldOverflowMentions =
      currentBatch.length > 0 &&
      currentMentions + paragraphMentions > VALIDATION_BATCH_MENTIONS

    if (wouldOverflowCount || wouldOverflowChars || wouldOverflowMentions) {
      batches.push(currentBatch)
      currentBatch = []
      currentChars = 0
      currentMentions = 0
    }

    currentBatch.push(pid)
    currentChars += paragraphChars
    currentMentions += paragraphMentions
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch)
  }

  return batches
}

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

  const normalizedMentions = mentionLog.mentions.map((mention, index) => ({
    ...mention,
    mention_id: normalizeMentionId(mention, chapterId, index),
  }))

  // Group mentions by paragraph
  const mentionsByPid = new Map<number, typeof normalizedMentions>()
  for (const m of normalizedMentions) {
    const list = mentionsByPid.get(m.pid) ?? []
    list.push(m)
    mentionsByPid.set(m.pid, list)
  }

  // Collect unique paragraph pids in order
  const allPids = chapter.paragraphs.map((p) => p.pid)
  const pidToText = new Map(chapter.paragraphs.map((p) => [p.pid, p.text]))
  const pidBatches = chunkPidsForMentionValidation(allPids, pidToText, mentionsByPid)

  const validated: ValidatedMention[] = []

  async function validateBatch(
    batchPids: number[],
    batchLabel: string,
  ): Promise<ValidatedMention[]> {
    const batchParas = batchPids.map((pid) => ({
      pid,
      text: pidToText.get(pid) ?? "",
    }))
    const batchMentions = batchPids.flatMap((pid) => mentionsByPid.get(pid) ?? [])

    if (batchMentions.length === 0) return []

    onProgress?.(`ENT.2: ${batchLabel}...`)

    const precheckedMentions = batchMentions.map((mention) => ({
      mention,
      ruleRejection: getRuleBasedMentionRejection(
        mention,
        pidToText.get(mention.pid) ?? "",
      ),
    }))
    const llmBatchMentions = precheckedMentions
      .filter((entry) => entry.ruleRejection === null)
      .map((entry) => entry.mention)

    if (llmBatchMentions.length === 0) {
      return precheckedMentions.map((entry) => ({
        ...entry.mention,
        valid: false,
        reason: formatRuleBasedReason(
          entry.ruleRejection ?? "Mention was rejected before LLM validation.",
        ),
      }))
    }

    try {
      const result = await llmClient.validateMentions({
        paragraphs_json: formatJsonParam(batchParas),
        mentions_json: formatJsonParam(llmBatchMentions),
      })

      const batchValidated = ((result.validated ?? result.validations) as Array<{
        mention_id: string
        pid?: number
        span?: string
        valid: boolean
        reason?: string
      }>) ?? []

      const validationMap = new Map(
        batchValidated
          .filter((item) => typeof item.mention_id === "string" && item.mention_id.trim())
          .map((v) => [v.mention_id, v]),
      )
      const validationFallbackMap = new Map(
        batchValidated
          .filter(
            (item) =>
              typeof item.pid === "number" &&
              typeof item.span === "string" &&
              item.span.trim(),
          )
          .map((item) => [`${item.pid}::${item.span}`, item]),
      )

      return precheckedMentions.map((entry) => {
        if (entry.ruleRejection) {
          return {
            ...entry.mention,
            valid: false,
            reason: formatRuleBasedReason(entry.ruleRejection),
          }
        }

        const v = validationMap.get(entry.mention.mention_id) ??
          validationFallbackMap.get(`${entry.mention.pid}::${entry.mention.span}`)
        return {
          ...entry.mention,
          valid: v?.valid ?? false,
          reason:
            v?.valid === false
              ? (v.reason?.trim() || "Model returned invalid without a reason.")
              : v
                ? v.reason
                : "Model did not return a validation result for this mention.",
        }
      })
    } catch (error) {
      if (batchPids.length > 1 && isLikelyTruncatedJsonError(error)) {
        const midpoint = Math.ceil(batchPids.length / 2)
        const left = await validateBatch(batchPids.slice(0, midpoint), `${batchLabel}.1`)
        const right = await validateBatch(batchPids.slice(midpoint), `${batchLabel}.2`)
        return [...left, ...right]
      }
      throw error
    }
  }

  for (let batchIndex = 0; batchIndex < pidBatches.length; batchIndex++) {
    const batchValidated = await validateBatch(
      pidBatches[batchIndex],
      `batch ${batchIndex + 1}/${pidBatches.length}`,
    )
    validated.push(...batchValidated)
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
      start_char: m.start_char,
      end_char: m.end_char,
      mention_type: m.mention_type,
      normalized: m.normalized,
    })),
  }
}
