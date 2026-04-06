/**
 * ENT.3 — Entity Resolution (rule-based + optional LLM pronoun resolution)
 * Port of Story-Decomposition/src/viewer/entity_resolution.py
 */

import type {
  RawChapter,
  MentionCandidates,
  EntityGraph,
  Entity,
  EntityMention,
  Mention,
} from "@/types/schema"
import type { LLMClient } from "@/lib/llm-client"
import { formatJsonParam, formatParagraphsForLLM } from "@/lib/prompt-loader"

// ---------------------------------------------------------------------------
// Cast pronouns
// ---------------------------------------------------------------------------

const CAST_PRONOUNS = new Set([
  "i", "me", "my", "myself",
  "you", "your", "yourself",
  "he", "him", "his", "himself",
  "she", "her", "hers", "herself",
  "we", "us", "our", "ourselves",
  "they", "them", "their", "theirs", "themselves",
])

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

function normalizeSpan(span: string): string {
  return span
    .trim()
    .toLowerCase()
    .replace(/^(the|a|an)\s+/, "")
    .trim()
}

function similarity(a: string, b: string): number {
  if (a === b) return 1.0
  if (a.length < 2 || b.length < 2) return 0.0
  // Trigram similarity (simple approximation of SequenceMatcher)
  const longer = a.length > b.length ? a : b
  const shorter = a.length > b.length ? b : a
  if (longer.includes(shorter)) return shorter.length / longer.length
  let matches = 0
  for (let i = 0; i < shorter.length - 1; i++) {
    if (longer.includes(shorter.slice(i, i + 2))) matches++
  }
  return (2 * matches) / (longer.length + shorter.length - 2)
}

function selectCanonical(spans: string[]): string {
  const nonPronoun = spans.filter(
    (s) => !CAST_PRONOUNS.has(normalizeSpan(s)),
  )
  const pool = nonPronoun.length > 0 ? nonPronoun : spans
  return pool.reduce((a, b) => (a.length >= b.length ? a : b))
}

// ---------------------------------------------------------------------------
// Rule-based clustering
// ---------------------------------------------------------------------------

interface Cluster {
  name: string
  rawSpans: string[]
  members: Mention[]
}

function clusterMentions(
  mentions: Mention[],
  isCast: boolean,
): { clusters: Cluster[]; unresolved: Mention[] } {
  const clusters: Cluster[] = []
  const unresolved: Mention[] = []

  for (const m of mentions) {
    const norm = normalizeSpan(m.span)
    if (isCast && CAST_PRONOUNS.has(norm)) {
      unresolved.push(m)
      continue
    }

    let matched: Cluster | undefined
    for (const cluster of clusters) {
      if (norm === cluster.name) { matched = cluster; break }
      if (norm.length > 4 && similarity(norm, cluster.name) > 0.8) {
        matched = cluster; break
      }
    }

    if (matched) {
      matched.members.push(m)
      matched.rawSpans.push(m.span)
    } else {
      clusters.push({ name: norm, rawSpans: [m.span], members: [m] })
    }
  }
  return { clusters, unresolved }
}

// ---------------------------------------------------------------------------
// Rule-based resolution
// ---------------------------------------------------------------------------

function runRuleEntityResolution(
  mentionLog: MentionCandidates,
  docId: string,
  chapterId: string,
  parents: Record<string, string>,
): EntityGraph {
  const cast = mentionLog.mentions.filter((m) => m.mention_type === "cast")
  const place = mentionLog.mentions.filter((m) => m.mention_type === "place")
  const time = mentionLog.mentions.filter((m) => m.mention_type === "time")

  const entities: Entity[] = []
  let counter = 1
  const allUnresolved: Mention[] = []

  for (const [group, isCast] of [
    [cast, true],
    [place, false],
    [time, false],
  ] as const) {
    const { clusters, unresolved } = clusterMentions(group, isCast)
    if (isCast) allUnresolved.push(...unresolved)

    for (const cluster of clusters) {
      const canonical = selectCanonical(cluster.rawSpans)
      const entityId = `${group[0]?.mention_type ?? "cast"}_${String(counter).padStart(3, "0")}`
      counter++
      const ems: EntityMention[] = cluster.members.map((m) => ({
        mention_id: m.mention_id,
        pid: m.pid,
        span: m.span,
        start_char: m.start_char,
        end_char: m.end_char,
      }))
      entities.push({
        entity_id: entityId,
        canonical_name: canonical,
        mention_type: cluster.members[0]?.mention_type ?? "cast",
        mentions: ems,
      })
    }
  }

  const runId = `entities_rule__${docId}__${chapterId}`
  return {
    run_id: runId,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: "ENT.3",
    method: "rule",
    parents,
    entities,
    unresolved_mentions: allUnresolved.map((m) => ({
      mention_id: m.mention_id,
      pid: m.pid,
      span: m.span,
      start_char: m.start_char,
      end_char: m.end_char,
    })),
  }
}

// ---------------------------------------------------------------------------
// LLM-assisted resolution (pronoun resolution + alias merging)
// ---------------------------------------------------------------------------

export async function runEntityResolution(
  chapter: RawChapter,
  mentionLog: MentionCandidates,
  llmClient: LLMClient,
  docId: string,
  chapterId: string,
  parents: Record<string, string> = {},
  onProgress?: (msg: string) => void,
): Promise<EntityGraph> {
  onProgress?.("ENT.3: resolving entities (rule-based)...")

  const ruleResult = runRuleEntityResolution(mentionLog, docId, chapterId, parents)

  if (ruleResult.unresolved_mentions.length === 0) {
    return ruleResult
  }

  onProgress?.("ENT.3: resolving pronouns (LLM)...")

  const chapterText = formatParagraphsForLLM(chapter.paragraphs)
  const entitiesJson = formatJsonParam(
    ruleResult.entities.map((e) => ({
      entity_id: e.entity_id,
      canonical_name: e.canonical_name,
      type: e.mention_type,
      spans: e.mentions.map((m) => m.span),
    })),
  )
  const unresolvedJson = formatJsonParam(ruleResult.unresolved_mentions)

  const result = await llmClient.resolveEntities({
    chapter_text: chapterText,
    entities_json: entitiesJson,
    unresolved_json: unresolvedJson,
  })

  const resolutions = (result.resolutions as Array<{
    mention_id: string
    entity_id: string
  }>) ?? []

  const merges = (result.merges as Array<{
    keep: string
    absorb: string
  }>) ?? []

  // Build mutable entity map
  const entityMap = new Map(ruleResult.entities.map((e) => [e.entity_id, { ...e, mentions: [...e.mentions] }]))

  // Apply pronoun resolutions
  for (const res of resolutions) {
    const entity = entityMap.get(res.entity_id)
    const mention = ruleResult.unresolved_mentions.find(
      (m) => m.mention_id === res.mention_id,
    )
    if (entity && mention) {
      entity.mentions.push(mention)
    }
  }

  // Apply alias merges
  for (const merge of merges) {
    const keep = entityMap.get(merge.keep)
    const absorb = entityMap.get(merge.absorb)
    if (keep && absorb) {
      keep.mentions.push(...absorb.mentions)
      entityMap.delete(merge.absorb)
    }
  }

  const runId = `entities_llm__${docId}__${chapterId}`
  return {
    run_id: runId,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: "ENT.3",
    method: "llm",
    parents,
    entities: Array.from(entityMap.values()),
    unresolved_mentions: [],
  }
}
