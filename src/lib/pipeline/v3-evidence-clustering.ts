import type { V3EvidenceCandidateType } from "@/lib/pipeline/v3-evidence-types"
import type {
  V3EvidenceRefinementArtifact,
  V3RefinedEvidenceCandidate,
} from "@/lib/pipeline/v3-evidence-refinement-types"
import type { V3EvidenceGateArtifact } from "@/lib/pipeline/v3-evidence-gate-types"
import type {
  V3ClusteredEntityType,
  V3EvidenceClusteringArtifact,
  V3EvidenceEntityCluster,
} from "@/lib/pipeline/v3-evidence-clustering-types"

const CLUSTERED_ENTITY_TYPES = new Set<V3EvidenceCandidateType>(["cast", "place", "time", "object"])
const EVIDENCE_CLUSTERING_PROFILE = "v3_evidence_entity_clustering"
const ENGLISH_CAST_PRONOUNS = new Set([
  "i",
  "me",
  "my",
  "mine",
  "myself",
  "you",
  "your",
  "yours",
  "yourself",
  "he",
  "him",
  "his",
  "himself",
  "she",
  "her",
  "hers",
  "herself",
  "it",
  "its",
  "itself",
  "we",
  "us",
  "our",
  "ours",
  "ourselves",
  "they",
  "them",
  "their",
  "theirs",
  "themselves",
])

interface BuildParams {
  docId: string
  chapterId: string
  evidenceRefinement: V3EvidenceRefinementArtifact
  evidenceGate: V3EvidenceGateArtifact
  parents?: Record<string, string>
}

interface ClusterDraft {
  entityType: V3ClusteredEntityType
  key: string
  members: V3RefinedEvidenceCandidate[]
}

type ClusterableEvidenceCandidate = V3RefinedEvidenceCandidate & {
  candidate_type: V3ClusteredEntityType
}

export function isV3ClusteredEntityType(value: V3EvidenceCandidateType): value is V3ClusteredEntityType {
  return CLUSTERED_ENTITY_TYPES.has(value)
}

function isClusterableEvidenceCandidate(
  candidate: V3RefinedEvidenceCandidate,
): candidate is ClusterableEvidenceCandidate {
  return isV3ClusteredEntityType(candidate.candidate_type)
}

function cleanSpan(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/[,/]+/g, " ")
    .replace(/^[\s"'`([{<]+/, "")
    .replace(/[\s"'`\])}>.,!?;:]+$/, "")
    .replace(/\s+/g, " ")
}

function stripDeterminer(value: string): string {
  return value
    .replace(/^(the|a|an|this|that|these|those)\s+/, "")
    .replace(/'s\b/g, "")
    .trim()
}

function stripLeadingModifiers(value: string, modifiers: Set<string>): string {
  const words = value.split(" ").filter(Boolean)
  while (words.length > 1 && modifiers.has(words[0])) {
    words.shift()
  }
  return words.join(" ")
}

const PLACE_COMPATIBLE_MODIFIERS = new Set([
  "another",
  "beautiful",
  "dark",
  "deep",
  "large",
  "little",
  "long",
  "loveliest",
  "lovely",
  "low",
  "small",
  "very",
])
const PLACE_ALIAS_HEADS = new Set(["garden", "hall", "rabbit hole", "well"])
const OBJECT_SIZE_MODIFIERS = new Set(["little", "small", "tiny", "very"])
const CONTEXT_DEPENDENT_TIME_KEYS = new Set([
  "a moment",
  "after a while",
  "afterwards",
  "at the time",
  "moment",
  "the second time round",
  "this time",
  "time",
])

function normalizePlaceKey(value: string): string {
  const withoutModifiers = stripLeadingModifiers(value, PLACE_COMPATIBLE_MODIFIERS)
  return PLACE_ALIAS_HEADS.has(withoutModifiers) ? withoutModifiers : value
}

function normalizeObjectKey(value: string): string {
  return stripLeadingModifiers(value, OBJECT_SIZE_MODIFIERS)
}

function normalizeEntityKey(value: string, candidateType: V3EvidenceCandidateType): string {
  const base = stripDeterminer(cleanSpan(value))
  if (candidateType === "place") return normalizePlaceKey(base)
  if (candidateType === "object") return normalizeObjectKey(base)
  return base
}

function isEnglishCastPronoun(value: string): boolean {
  return ENGLISH_CAST_PRONOUNS.has(cleanSpan(value))
}

function clusterKeyForCandidate(candidate: V3RefinedEvidenceCandidate): string {
  const normalized = normalizeEntityKey(candidate.normalized ?? "", candidate.candidate_type)
  const span = normalizeEntityKey(candidate.span, candidate.candidate_type)
  const key = normalized || span

  if (
    candidate.candidate_type === "cast" &&
    isEnglishCastPronoun(candidate.span) &&
    (!normalized || normalized === span)
  ) {
    return `${candidate.candidate_type}::pronoun::${candidate.refined_candidate_id}`
  }

  if (candidate.candidate_type === "time" && CONTEXT_DEPENDENT_TIME_KEYS.has(key)) {
    return `${candidate.candidate_type}::context::${candidate.refined_candidate_id}`
  }

  return `${candidate.candidate_type}::${key || candidate.refined_candidate_id}`
}

function displayValue(value: string | undefined): string | undefined {
  const cleaned = value?.trim().replace(/\s+/g, " ")
  return cleaned || undefined
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const display = displayValue(value)
    if (!display) continue
    const key = cleanSpan(display)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(display)
  }
  return result
}

function canonicalLabel(members: V3RefinedEvidenceCandidate[]): string {
  const nonPronounNormalized = members
    .map((member) => displayValue(member.normalized))
    .find((value) => value && !isEnglishCastPronoun(value))
  if (nonPronounNormalized) return nonPronounNormalized

  const nonPronounSpan = members
    .map((member) => displayValue(member.span))
    .find((value) => value && !isEnglishCastPronoun(value))
  if (nonPronounSpan) return nonPronounSpan

  return displayValue(members[0]?.normalized) ?? displayValue(members[0]?.span) ?? "unnamed"
}

function toEntityCluster(
  draft: ClusterDraft,
  chapterId: string,
  index: number,
): V3EvidenceEntityCluster {
  const members = [...draft.members].sort((a, b) => (
    a.pid - b.pid ||
    a.start_char - b.start_char ||
    a.refined_candidate_id.localeCompare(b.refined_candidate_id)
  ))
  const aliases = uniqueStrings(members.flatMap((member) => [member.normalized, member.span]))

  return {
    cluster_id: `${chapterId}_evid4_${String(index + 1).padStart(4, "0")}`,
    entity_type: draft.entityType,
    canonical_label: canonicalLabel(members),
    aliases,
    refined_candidate_ids: members.map((member) => member.refined_candidate_id),
    source_candidate_ids: Array.from(new Set(members.flatMap((member) => member.source_candidate_ids))),
    evidence_pids: Array.from(new Set(members.map((member) => member.pid))).sort((a, b) => a - b),
    mention_count: members.length,
  }
}

function countByType(clusters: V3EvidenceEntityCluster[]): Partial<Record<V3ClusteredEntityType, number>> {
  const counts: Partial<Record<V3ClusteredEntityType, number>> = {}
  for (const cluster of clusters) {
    counts[cluster.entity_type] = (counts[cluster.entity_type] ?? 0) + 1
  }
  return counts
}

export function buildV3EvidenceClusters({
  docId,
  chapterId,
  evidenceRefinement,
  evidenceGate,
  parents = {},
}: BuildParams): V3EvidenceClusteringArtifact {
  const drafts = new Map<string, ClusterDraft>()
  const nonDroppedCandidates = evidenceRefinement.refined_candidates
    .filter((candidate) => evidenceGate.gate_map[candidate.refined_candidate_id] !== "drop")
  const entityLikeCandidates = nonDroppedCandidates.filter(isClusterableEvidenceCandidate)

  for (const candidate of entityLikeCandidates) {
    const entityType = candidate.candidate_type
    const key = clusterKeyForCandidate(candidate)
    const draft = drafts.get(key)
    if (draft) {
      draft.members.push(candidate)
    } else {
      drafts.set(key, { entityType, key, members: [candidate] })
    }
  }

  const clusters = Array.from(drafts.values())
    .sort((a, b) => {
      const firstA = a.members[0]
      const firstB = b.members[0]
      return (
        (firstA?.pid ?? 0) - (firstB?.pid ?? 0) ||
        (firstA?.start_char ?? 0) - (firstB?.start_char ?? 0) ||
        a.key.localeCompare(b.key)
      )
    })
    .map((draft, index) => toEntityCluster(draft, chapterId, index))

  const candidateClusterMap = Object.fromEntries(
    clusters.flatMap((cluster) =>
      cluster.refined_candidate_ids.map((candidateId) => [candidateId, cluster.cluster_id] as const),
    ),
  )

  return {
    run_id: `v3_evidence_clustering__${docId}__${chapterId}`,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: "EVID.4",
    method: "rule",
    parents,
    extraction_profile: EVIDENCE_CLUSTERING_PROFILE,
    source_stage_ids: ["EVID.3"],
    cluster_stats: {
      input_refined_candidates: evidenceRefinement.refined_candidates.length,
      entity_like_candidates: entityLikeCandidates.length,
      entity_clusters: clusters.length,
      singleton_clusters: clusters.filter((cluster) => cluster.mention_count === 1).length,
      unclustered_candidates: nonDroppedCandidates.length - entityLikeCandidates.length,
      by_type: countByType(clusters),
    },
    entity_clusters: clusters,
    candidate_cluster_map: candidateClusterMap,
  }
}
