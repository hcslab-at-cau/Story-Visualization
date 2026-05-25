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

const ENGLISH_RESOLVABLE_CAST_PRONOUNS = new Set([
  "i", "me", "my", "myself",
  "you", "your", "yourself",
  "he", "him", "his", "himself",
  "she", "her", "hers", "herself",
  "it", "its", "itself",
  "we", "us", "our", "ourselves",
  "they", "them", "their", "theirs", "themselves",
])

const KOREAN_SPEECH_PARTICIPANT_PRONOUNS = new Map([
  ["나", "나"], ["나는", "나"], ["난", "나"], ["내가", "나"], ["나를", "나"],
  ["날", "나"], ["나에게", "나"], ["내게", "나"], ["내겐", "나"], ["나의", "나"],
  ["내", "나"], ["나도", "나"], ["나만", "나"],
  ["저", "저"], ["저는", "저"], ["전", "저"], ["제가", "저"], ["저를", "저"],
  ["절", "저"], ["저에게", "저"], ["제게", "저"], ["제겐", "저"], ["저의", "저"],
  ["제", "저"], ["저도", "저"], ["저만", "저"],
  ["너", "너"], ["너는", "너"], ["넌", "너"], ["네가", "너"], ["니가", "너"],
  ["너를", "너"], ["널", "너"], ["너에게", "너"], ["네게", "너"], ["네겐", "너"],
  ["너의", "너"], ["네", "너"], ["니", "너"], ["너도", "너"], ["너만", "너"],
  ["우리", "우리"], ["우리는", "우리"], ["우린", "우리"], ["우리가", "우리"],
  ["우리를", "우리"], ["우릴", "우리"], ["우리에게", "우리"], ["우리에겐", "우리"],
  ["우리의", "우리"], ["우리도", "우리"], ["우리만", "우리"],
  ["저희", "저희"], ["저희는", "저희"], ["저흰", "저희"], ["저희가", "저희"],
  ["저희를", "저희"], ["저흴", "저희"], ["저희에게", "저희"], ["저희의", "저희"],
  ["당신", "당신"], ["당신은", "당신"], ["당신이", "당신"], ["당신을", "당신"],
])
const KOREAN_SPEECH_PARTICIPANT_CANONICALS = new Set(KOREAN_SPEECH_PARTICIPANT_PRONOUNS.values())

const KOREAN_RESOLVABLE_CAST_PRONOUNS = new Map([
  ["그", "그"], ["그가", "그"], ["그는", "그"], ["그를", "그"], ["그에게", "그"],
  ["그의", "그"], ["그도", "그"], ["그만", "그"],
  ["그녀", "그녀"], ["그녀가", "그녀"], ["그녀는", "그녀"], ["그녀를", "그녀"],
  ["그녀에게", "그녀"], ["그녀의", "그녀"], ["그녀도", "그녀"], ["그녀만", "그녀"],
  ["그들", "그들"], ["그들이", "그들"], ["그들은", "그들"], ["그들을", "그들"],
  ["그들에게", "그들"], ["그들의", "그들"], ["그들도", "그들"], ["그들만", "그들"],
  ["그것", "그것"], ["그것이", "그것"], ["그것은", "그것"], ["그것을", "그것"],
  ["자기", "자기"], ["자기가", "자기"], ["자기는", "자기"], ["자기를", "자기"],
  ["자기에게", "자기"], ["자기의", "자기"],
  ["자신", "자신"], ["자신이", "자신"], ["자신은", "자신"], ["자신을", "자신"],
  ["자신에게", "자신"], ["자신의", "자신"],
  ["본인", "본인"], ["본인이", "본인"], ["본인은", "본인"], ["본인을", "본인"],
])
const KOREAN_RESOLVABLE_CAST_PRONOUN_CANONICALS = new Set(KOREAN_RESOLVABLE_CAST_PRONOUNS.values())

const HANGUL_PATTERN = /\p{Script=Hangul}/u
const PRIMARY_KOREAN_PARTICLE_SUFFIXES = [
  "에게서", "한테서", "으로부터", "로부터", "에게", "한테", "께",
  "에서", "으로", "로", "부터", "까지", "보다", "처럼",
  "은", "는", "이", "가", "을", "를",
]
const SECONDARY_KOREAN_PARTICLE_SUFFIXES = [
  ...PRIMARY_KOREAN_PARTICLE_SUFFIXES,
  "와", "과", "랑", "이랑", "도", "만", "의", "야", "여",
]
const KOREAN_CAST_TITLE_SUFFIXES = ["선생님", "씨", "님", "군", "양"]

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

function cleanSpan(span: string): string {
  return span
    .trim()
    .toLowerCase()
    .replace(/^[\s"'“”‘’([{<]+/, "")
    .replace(/[\s"'“”‘’)\]}>.,!?;:]+$/, "")
    .replace(/\s+/g, " ")
}

function hasHangul(value: string): boolean {
  return HANGUL_PATTERN.test(value)
}

function stripKoreanSuffixFromLastToken(span: string, suffixes: string[]): string | null {
  if (!hasHangul(span)) return null

  const parts = span.split(" ")
  let last = parts[parts.length - 1]
  let changed = false

  for (let pass = 0; pass < 3; pass++) {
    let strippedInPass = false
    for (const suffix of suffixes) {
      if (!last.endsWith(suffix)) continue

      const stem = last.slice(0, -suffix.length)
      if (stem.length < 1 || !hasHangul(stem)) continue
      last = stem
      changed = true
      strippedInPass = true
      break
    }

    if (!strippedInPass) break
  }

  if (!changed) return null
  parts[parts.length - 1] = last
  return parts.join(" ")
}

function getKoreanHeadNounCandidate(span: string): string | null {
  if (!hasHangul(span) || !span.includes(" ")) return null
  const last = span.split(" ").at(-1)?.trim() ?? ""
  const stripped = stripKoreanSuffixFromLastToken(last, SECONDARY_KOREAN_PARTICLE_SUFFIXES)
  const head = stripped ?? last
  return head.length >= 2 ? head : null
}

function normalizeKoreanPronoun(span: string): string | null {
  return KOREAN_SPEECH_PARTICIPANT_PRONOUNS.get(span) ??
    KOREAN_RESOLVABLE_CAST_PRONOUNS.get(span) ??
    null
}

function normalizeSpan(span: string): string {
  const cleaned = cleanSpan(span)
  const pronoun = normalizeKoreanPronoun(cleaned)
  if (pronoun) return pronoun

  const primaryKoreanStem = stripKoreanSuffixFromLastToken(
    cleaned,
    PRIMARY_KOREAN_PARTICLE_SUFFIXES,
  )
  const stemPronoun = primaryKoreanStem ? normalizeKoreanPronoun(primaryKoreanStem) : null
  if (stemPronoun) return stemPronoun

  return (primaryKoreanStem ?? cleaned)
    .replace(/^(the|a|an)\s+/, "")
    .trim()
}

function normalizedSpanCandidates(mention: Mention): string[] {
  const candidates = new Set<string>()
  const add = (value: string | undefined) => {
    if (!value) return
    const cleaned = cleanSpan(value)
    if (!cleaned) return
    candidates.add(normalizeSpan(cleaned))
    candidates.add(cleaned)
    const secondaryStem = stripKoreanSuffixFromLastToken(
      cleaned,
      SECONDARY_KOREAN_PARTICLE_SUFFIXES,
    )
    if (secondaryStem) candidates.add(normalizeSpan(secondaryStem))
    const titleStem = stripKoreanSuffixFromLastToken(cleaned, KOREAN_CAST_TITLE_SUFFIXES)
    if (titleStem) candidates.add(normalizeSpan(titleStem))
    const head = getKoreanHeadNounCandidate(cleaned)
    if (head) candidates.add(normalizeSpan(head))
  }

  add(mention.normalized)
  add(mention.span)
  return Array.from(candidates).filter(Boolean)
}

function isResolvableCastPronoun(span: string): boolean {
  const cleaned = cleanSpan(span)
  const normalized = normalizeSpan(cleaned)
  if (ENGLISH_RESOLVABLE_CAST_PRONOUNS.has(normalized)) return true
  return KOREAN_RESOLVABLE_CAST_PRONOUNS.has(cleaned) ||
    KOREAN_RESOLVABLE_CAST_PRONOUN_CANONICALS.has(normalized)
}

function isSpeechParticipantPronoun(span: string): boolean {
  const cleaned = cleanSpan(span)
  return KOREAN_SPEECH_PARTICIPANT_PRONOUNS.has(cleaned) ||
    KOREAN_SPEECH_PARTICIPANT_CANONICALS.has(normalizeSpan(cleaned))
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

function selectCanonical(spans: string[], clusterName: string): string {
  if (KOREAN_SPEECH_PARTICIPANT_PRONOUNS.has(clusterName)) return clusterName

  const nonPronoun = spans.filter(
    (s) => !isResolvableCastPronoun(s),
  )
  const pool = nonPronoun.length > 0 ? nonPronoun : spans
  const exactNormalized = pool
    .map((span) => ({ span: cleanSpan(span), normalized: normalizeSpan(span) }))
    .find((item) => item.span === item.normalized)

  return exactNormalized?.span ?? normalizeSpan(pool[0] ?? clusterName)
}

// ---------------------------------------------------------------------------
// Rule-based clustering
// ---------------------------------------------------------------------------

interface Cluster {
  name: string
  keys: Set<string>
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
    const normCandidates = normalizedSpanCandidates(m)
    const norm = normCandidates[0] ?? normalizeSpan(m.span)
    if (isCast && isResolvableCastPronoun(m.span) && !isSpeechParticipantPronoun(m.span)) {
      unresolved.push(m)
      continue
    }

    let matched: Cluster | undefined
    for (const cluster of clusters) {
      if (normCandidates.some((candidate) => cluster.keys.has(candidate))) {
        matched = cluster
        break
      }
      if (norm.length > 4 && similarity(norm, cluster.name) > 0.8) {
        matched = cluster; break
      }
    }

    if (matched) {
      matched.members.push(m)
      matched.rawSpans.push(m.span)
      for (const candidate of normCandidates) matched.keys.add(candidate)
    } else {
      clusters.push({ name: norm, keys: new Set(normCandidates), rawSpans: [m.span], members: [m] })
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
      const canonical = selectCanonical(cluster.rawSpans, cluster.name)
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
      normalized_name: normalizeSpan(e.canonical_name),
      type: e.mention_type,
      spans: e.mentions.map((m) => m.span),
      normalized_spans: Array.from(new Set(e.mentions.map((m) => normalizeSpan(m.span)))),
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
  const resolvedMentionIds = new Set<string>()
  for (const res of resolutions) {
    const entity = entityMap.get(res.entity_id)
    const mention = ruleResult.unresolved_mentions.find(
      (m) => m.mention_id === res.mention_id,
    )
    if (entity && mention) {
      entity.mentions.push(mention)
      resolvedMentionIds.add(mention.mention_id)
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
  const unresolvedMentions = ruleResult.unresolved_mentions.filter(
    (mention) => !resolvedMentionIds.has(mention.mention_id),
  )
  return {
    run_id: runId,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: "ENT.3",
    method: "llm",
    parents,
    entities: Array.from(entityMap.values()),
    unresolved_mentions: unresolvedMentions,
  }
}
