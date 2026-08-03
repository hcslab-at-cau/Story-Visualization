import { createHash } from "node:crypto"
import type { V3EvidenceEntityCluster } from "./v3-evidence-clustering-types"
import type { V3GatedEvidenceCandidate } from "./v3-evidence-gate-types"
import type {
  V3BookEntityAlias,
  V3BookEntityGroup,
  V3BookEntityGroupMember,
  V3BookEntityGroupingChapterInput,
  V3BookEntityGroupingDiagnostic,
  V3BookEntityGroupingResult,
  V3BookEntityType,
  V3BookReaderPosition,
  V3BookVisibleEntityGroup,
  V3BookVisibleEntityGroupMember,
} from "./v3-book-qa-types"

const DENIED_IDENTITY_KEYS = new Set([
  "i", "me", "my", "mine", "myself",
  "we", "us", "our", "ours", "ourselves",
  "you", "your", "yours", "yourself", "yourselves",
  "he", "him", "his", "himself",
  "she", "her", "hers", "herself",
  "it", "its", "itself",
  "they", "them", "their", "theirs", "themselves",
  "who", "whom", "whose", "whoever",
  "this", "that", "these", "those",
  "anyone", "anybody", "everyone", "everybody", "nobody", "no one",
  "someone", "somebody", "person", "stranger",
  "man", "the man", "woman", "the woman", "boy", "girl",
])

interface ProvenancedOccurrence {
  pid: number
  span: string
  span_key: string
  normalized_key?: string
  keys: Set<string>
}

interface MemberDraft extends V3BookEntityGroupMember {
  node_id: string
  entity_type: V3BookEntityType
  key_pids: Map<string, number[]>
}

function compareText(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function uniqueSortedNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right)
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}

export function normalizeV3BookEntityIdentityKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/^[\p{P}\s]+/gu, "")
    .replace(/[\p{P}\s]+$/gu, "")
    .trim()
}

function isBookEntityType(value: V3EvidenceEntityCluster["entity_type"]): value is V3BookEntityType {
  return value === "cast" || value === "place" || value === "object"
}

function validOccurrence(candidate: V3GatedEvidenceCandidate): candidate is V3GatedEvidenceCandidate & {
  pid: number
  span: string
} {
  return Number.isInteger(candidate.pid)
    && (candidate.pid ?? -1) >= 0
    && typeof candidate.span === "string"
    && candidate.span.trim().length > 0
}

function provenancedOccurrence(
  candidate: V3GatedEvidenceCandidate & { pid: number; span: string },
): ProvenancedOccurrence {
  const spanKey = normalizeV3BookEntityIdentityKey(candidate.span)
  const normalized = typeof candidate.normalized === "string" && candidate.normalized.trim()
    ? candidate.normalized
    : undefined
  const normalizedKey = normalized ? normalizeV3BookEntityIdentityKey(normalized) : undefined
  return {
    pid: candidate.pid,
    span: candidate.span,
    span_key: spanKey,
    normalized_key: normalizedKey,
    keys: new Set([spanKey, normalizedKey].filter((key): key is string => Boolean(key))),
  }
}

function makeNodeId(chapterId: string, clusterId: string): string {
  return `${chapterId}\u0000${clusterId}`
}

function diagnosticSortKey(diagnostic: V3BookEntityGroupingDiagnostic): string[] {
  return [
    diagnostic.code,
    diagnostic.entity_type ?? "",
    diagnostic.identity_key ?? "",
    diagnostic.chapter_id ?? "",
    diagnostic.local_cluster_id ?? "",
    diagnostic.refined_candidate_id ?? "",
    diagnostic.alias ?? "",
    diagnostic.run_id ?? "",
    diagnostic.message,
  ]
}

function compareStringTuples(left: string[], right: string[]): number {
  for (let index = 0; index < left.length; index += 1) {
    const result = compareText(left[index] ?? "", right[index] ?? "")
    if (result !== 0) return result
  }
  return 0
}

function sortDiagnostics(
  diagnostics: V3BookEntityGroupingDiagnostic[],
): V3BookEntityGroupingDiagnostic[] {
  return diagnostics.sort((left, right) =>
    compareStringTuples(diagnosticSortKey(left), diagnosticSortKey(right)))
}

function buildMemberDrafts(
  chapters: V3BookEntityGroupingChapterInput[],
  diagnostics: V3BookEntityGroupingDiagnostic[],
): MemberDraft[] {
  const drafts: MemberDraft[] = []

  for (const chapter of [...chapters].sort((left, right) =>
    left.chapterIndex - right.chapterIndex || compareText(left.chapterId, right.chapterId))) {
    const allClustersById = new Map(
      chapter.evidenceClusters.entity_clusters.map((cluster) => [cluster.cluster_id, cluster]),
    )
    const allowedClusters = chapter.evidenceClusters.entity_clusters
      .filter((cluster) => {
        if (isBookEntityType(cluster.entity_type)) return true
        diagnostics.push({
          code: "excluded_entity_type",
          message: `Excluded ${cluster.entity_type} cluster ${cluster.cluster_id} from BOOK.1 grouping.`,
          chapter_id: chapter.chapterId,
          run_id: chapter.runId,
          local_cluster_id: cluster.cluster_id,
          entity_type: "time",
        })
        return false
      })
      .sort((left, right) => compareText(left.cluster_id, right.cluster_id))
    const candidatesById = new Map(
      chapter.evidenceGate.gated_candidates.map((candidate) => [candidate.refined_candidate_id, candidate]),
    )
    const occurrencesByCluster = new Map<string, ProvenancedOccurrence[]>()

    for (const [candidateId, clusterId] of Object.entries(chapter.evidenceClusters.candidate_cluster_map)
      .sort(([left], [right]) => compareText(left, right))) {
      const cluster = allClustersById.get(clusterId)
      if (!cluster) {
        diagnostics.push({
          code: "candidate_cluster_not_found",
          message: `Candidate ${candidateId} maps to missing EVID.4 cluster ${clusterId}.`,
          chapter_id: chapter.chapterId,
          run_id: chapter.runId,
          local_cluster_id: clusterId,
          refined_candidate_id: candidateId,
        })
        continue
      }
      if (!isBookEntityType(cluster.entity_type)) continue

      const candidate = candidatesById.get(candidateId)
      if (!candidate || !validOccurrence(candidate)) {
        diagnostics.push({
          code: "missing_candidate_provenance",
          message: `Candidate ${candidateId} lacks EVID.3 pid/span provenance.`,
          chapter_id: chapter.chapterId,
          run_id: chapter.runId,
          local_cluster_id: clusterId,
          refined_candidate_id: candidateId,
          entity_type: cluster.entity_type,
        })
        continue
      }
      if (candidate.candidate_type !== cluster.entity_type) {
        diagnostics.push({
          code: "candidate_type_mismatch",
          message: `Candidate ${candidateId} type does not match EVID.4 cluster ${clusterId}.`,
          chapter_id: chapter.chapterId,
          run_id: chapter.runId,
          local_cluster_id: clusterId,
          refined_candidate_id: candidateId,
          entity_type: cluster.entity_type,
        })
        continue
      }

      const occurrences = occurrencesByCluster.get(clusterId) ?? []
      occurrences.push(provenancedOccurrence(candidate))
      occurrencesByCluster.set(clusterId, occurrences)
    }

    for (const cluster of allowedClusters) {
      const occurrences = occurrencesByCluster.get(cluster.cluster_id) ?? []
      const aliases: V3BookEntityAlias[] = []
      const keyPids = new Map<string, number[]>()
      const declaredAliasesByKey = new Map<string, string[]>()

      for (const alias of uniqueStrings([cluster.canonical_label, ...cluster.aliases])) {
        const key = normalizeV3BookEntityIdentityKey(alias)
        const declaredAliases = declaredAliasesByKey.get(key) ?? []
        declaredAliases.push(alias)
        declaredAliasesByKey.set(key, declaredAliases)
      }

      for (const [key, declaredAliases] of [...declaredAliasesByKey.entries()]
        .sort(([left], [right]) => compareText(left, right))) {
        const matchingOccurrences = occurrences.filter((occurrence) => occurrence.keys.has(key))
        const evidencePids = uniqueSortedNumbers(
          matchingOccurrences.map((occurrence) => occurrence.pid),
        )
        if (evidencePids.length === 0) {
          const alias = [...declaredAliases].sort(compareText)[0]
          diagnostics.push({
            code: "unprovenanced_alias",
            message: `Alias ${JSON.stringify(alias)} has no mapped EVID.3 occurrence.`,
            chapter_id: chapter.chapterId,
            run_id: chapter.runId,
            local_cluster_id: cluster.cluster_id,
            entity_type: cluster.entity_type,
            alias,
            identity_key: key || undefined,
          })
          continue
        }
        const surfaces = matchingOccurrences.map((occurrence) => ({
          pid: occurrence.pid,
          value: occurrence.span,
        }))
        surfaces.sort((left, right) => left.pid - right.pid || compareText(left.value, right.value))
        aliases.push({
          value: surfaces[0].value,
          evidence_pids: evidencePids,
          available_from_pid: evidencePids[0],
        })
        keyPids.set(key, uniqueSortedNumbers([...(keyPids.get(key) ?? []), ...evidencePids]))
      }

      aliases.sort((left, right) => compareText(left.value, right.value))
      const entityType = cluster.entity_type
      if (!isBookEntityType(entityType)) {
        diagnostics.push({
          code: "excluded_entity_type",
          message: `Cluster ${JSON.stringify(cluster.cluster_id)} uses unsupported entity type ${JSON.stringify(entityType)}.`,
          chapter_id: chapter.chapterId,
          run_id: chapter.runId,
          local_cluster_id: cluster.cluster_id,
          entity_type: entityType,
        })
        continue
      }
      drafts.push({
        node_id: makeNodeId(chapter.chapterId, cluster.cluster_id),
        entity_type: entityType,
        chapter_id: chapter.chapterId,
        chapter_index: chapter.chapterIndex,
        run_id: chapter.runId,
        local_cluster_id: cluster.cluster_id,
        canonical_label: cluster.canonical_label,
        aliases,
        evidence_pids: uniqueSortedNumbers(occurrences.map((occurrence) => occurrence.pid)),
        link_available_from_pid: Number.MAX_SAFE_INTEGER,
        key_pids: keyPids,
      })
    }
  }

  return drafts
}

class DisjointEntityGroups {
  private readonly parent = new Map<string, string>()

  constructor(nodeIds: string[]) {
    for (const nodeId of nodeIds) this.parent.set(nodeId, nodeId)
  }

  find(nodeId: string): string {
    const parent = this.parent.get(nodeId) ?? nodeId
    if (parent === nodeId) return nodeId
    const root = this.find(parent)
    this.parent.set(nodeId, root)
    return root
  }

  unionRoots(roots: string[]): void {
    const sortedRoots = [...new Set(roots.map((root) => this.find(root)))].sort(compareText)
    const target = sortedRoots[0]
    for (const root of sortedRoots.slice(1)) this.parent.set(root, target)
  }
}

function hashGlobalEntityId(params: {
  qaCorpusId: string
  entityType: V3BookEntityType
  linkingKey: string
  memberRefs: string[]
}): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([
      params.qaCorpusId,
      params.entityType,
      params.linkingKey,
      [...params.memberRefs].sort(compareText),
    ]))
    .digest("hex")
  return `BOOK_ENTITY_${digest.slice(0, 32)}`
}

export function buildV3BookEntityGroups(params: {
  qaCorpusId: string
  chapters: V3BookEntityGroupingChapterInput[]
}): V3BookEntityGroupingResult {
  const diagnostics: V3BookEntityGroupingDiagnostic[] = []
  const drafts = buildMemberDrafts(params.chapters, diagnostics)
  const draftById = new Map(drafts.map((draft) => [draft.node_id, draft]))
  const occurrencesByTypeKey = new Map<string, { entityType: V3BookEntityType; key: string; nodeIds: Set<string> }>()
  const deniedTypeKeys = new Map<string, { entityType: V3BookEntityType; key: string }>()

  for (const draft of drafts) {
    for (const key of draft.key_pids.keys()) {
      const typeKey = `${draft.entity_type}\u0000${key}`
      if (!key || DENIED_IDENTITY_KEYS.has(key)) {
        deniedTypeKeys.set(typeKey, { entityType: draft.entity_type, key })
        continue
      }
      const occurrence = occurrencesByTypeKey.get(typeKey) ?? {
        entityType: draft.entity_type,
        key,
        nodeIds: new Set<string>(),
      }
      occurrence.nodeIds.add(draft.node_id)
      occurrencesByTypeKey.set(typeKey, occurrence)
    }
  }

  for (const { entityType, key } of [...deniedTypeKeys.values()]
    .sort((left, right) => compareText(left.entityType, right.entityType) || compareText(left.key, right.key))) {
    diagnostics.push({
      code: "denied_identity_key",
      message: `Identity key ${JSON.stringify(key)} is denied for cross-chapter grouping.`,
      entity_type: entityType,
      identity_key: key,
    })
  }

  const usableOccurrences: Array<{ entityType: V3BookEntityType; key: string; nodeIds: string[] }> = []
  for (const occurrence of [...occurrencesByTypeKey.values()]
    .sort((left, right) => compareText(left.entityType, right.entityType) || compareText(left.key, right.key))) {
    const nodesByChapter = new Map<string, string[]>()
    for (const nodeId of [...occurrence.nodeIds].sort(compareText)) {
      const chapterId = draftById.get(nodeId)?.chapter_id ?? ""
      const chapterNodes = nodesByChapter.get(chapterId) ?? []
      chapterNodes.push(nodeId)
      nodesByChapter.set(chapterId, chapterNodes)
    }
    const ambiguousChapters = [...nodesByChapter.entries()]
      .filter(([, nodeIds]) => nodeIds.length > 1)
      .map(([chapterId]) => chapterId)
      .sort(compareText)
    if (ambiguousChapters.length > 0) {
      for (const chapterId of ambiguousChapters) {
        diagnostics.push({
          code: "ambiguous_identity_key",
          message: `Identity key ${JSON.stringify(occurrence.key)} identifies multiple clusters in ${chapterId}.`,
          chapter_id: chapterId,
          entity_type: occurrence.entityType,
          identity_key: occurrence.key,
        })
      }
      continue
    }
    if (nodesByChapter.size >= 2) {
      usableOccurrences.push({
        entityType: occurrence.entityType,
        key: occurrence.key,
        nodeIds: [...occurrence.nodeIds].sort(compareText),
      })
    }
  }

  const disjoint = new DisjointEntityGroups(drafts.map((draft) => draft.node_id))
  const acceptedKeys = new Map<string, string[]>()

  for (const occurrence of usableOccurrences) {
    const roots = [...new Set(occurrence.nodeIds.map((nodeId) => disjoint.find(nodeId)))]
    const chapterOwners = new Map<string, string>()
    let conflict = false
    for (const root of roots) {
      const rootMembers = drafts.filter((draft) => disjoint.find(draft.node_id) === root)
      for (const member of rootMembers) {
        const previousRoot = chapterOwners.get(member.chapter_id)
        if (previousRoot && previousRoot !== root) conflict = true
        chapterOwners.set(member.chapter_id, root)
      }
    }
    if (conflict) {
      diagnostics.push({
        code: "transitive_chapter_conflict",
        message: `Identity key ${JSON.stringify(occurrence.key)} would place two clusters from one chapter in a group.`,
        entity_type: occurrence.entityType,
        identity_key: occurrence.key,
      })
      continue
    }
    disjoint.unionRoots(roots)
    acceptedKeys.set(`${occurrence.entityType}\u0000${occurrence.key}`, occurrence.nodeIds)
  }

  const components = new Map<string, MemberDraft[]>()
  for (const draft of drafts) {
    const root = disjoint.find(draft.node_id)
    const members = components.get(root) ?? []
    members.push(draft)
    components.set(root, members)
  }

  const groupedNodeIds = new Set<string>()
  const groups: V3BookEntityGroup[] = []
  for (const members of components.values()) {
    members.sort((left, right) =>
      left.chapter_index - right.chapter_index
      || compareText(left.chapter_id, right.chapter_id)
      || compareText(left.local_cluster_id, right.local_cluster_id))
    if (new Set(members.map((member) => member.chapter_id)).size < 2) continue

    const entityType = members[0].entity_type
    const memberNodeIds = new Set(members.map((member) => member.node_id))
    const linkingKeys = [...acceptedKeys.entries()]
      .filter(([typeKey, nodeIds]) =>
        typeKey.startsWith(`${entityType}\u0000`)
        && nodeIds.filter((nodeId) => memberNodeIds.has(nodeId)).length >= 2)
      .map(([typeKey]) => typeKey.slice(typeKey.indexOf("\u0000") + 1))
      .sort(compareText)
    if (linkingKeys.length === 0) continue

    const outputMembers = members.map((member): V3BookEntityGroupMember => {
      const linkPids = linkingKeys.flatMap((key) => member.key_pids.get(key) ?? [])
      return {
        chapter_id: member.chapter_id,
        chapter_index: member.chapter_index,
        run_id: member.run_id,
        local_cluster_id: member.local_cluster_id,
        canonical_label: member.canonical_label,
        aliases: member.aliases.map((alias) => ({ ...alias, evidence_pids: [...alias.evidence_pids] })),
        evidence_pids: [...member.evidence_pids],
        link_available_from_pid: Math.min(...linkPids),
      }
    })
    const memberRefs = outputMembers.map((member) => `${member.chapter_id}:${member.local_cluster_id}`)
    groups.push({
      global_entity_id: hashGlobalEntityId({
        qaCorpusId: params.qaCorpusId,
        entityType,
        linkingKey: linkingKeys[0],
        memberRefs,
      }),
      entity_type: entityType,
      canonical_label: outputMembers[0].canonical_label,
      members: outputMembers,
    })
    for (const member of members) groupedNodeIds.add(member.node_id)
  }

  for (const draft of drafts.filter((item) => !groupedNodeIds.has(item.node_id))) {
    diagnostics.push({
      code: "singleton_cluster",
      message: `Cluster ${draft.local_cluster_id} has no conservative cross-chapter entity link.`,
      chapter_id: draft.chapter_id,
      run_id: draft.run_id,
      local_cluster_id: draft.local_cluster_id,
      entity_type: draft.entity_type,
    })
  }

  groups.sort((left, right) => compareText(left.global_entity_id, right.global_entity_id))
  return { groups, diagnostics: sortDiagnostics(diagnostics) }
}

function currentChapterOrder(
  group: V3BookEntityGroup,
  position: V3BookReaderPosition,
  orderedChapterIds?: string[],
): number | undefined {
  if (orderedChapterIds) {
    const index = orderedChapterIds.indexOf(position.chapter_id)
    return index >= 0 ? index : undefined
  }
  return group.members.find((member) => member.chapter_id === position.chapter_id)?.chapter_index
}

function memberOrder(
  member: Pick<V3BookEntityGroupMember, "chapter_id" | "chapter_index">,
  orderedChapterIds?: string[],
): number {
  if (!orderedChapterIds) return member.chapter_index
  const index = orderedChapterIds.indexOf(member.chapter_id)
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER
}

export function visibleV3BookEntityGroup(
  group: V3BookEntityGroup,
  position: V3BookReaderPosition,
  orderedChapterIds?: string[],
): V3BookVisibleEntityGroup | null {
  if (!Number.isInteger(position.pid) || position.pid < 0) return null
  const currentOrder = currentChapterOrder(group, position, orderedChapterIds)
  if (currentOrder === undefined) return null

  const members: V3BookVisibleEntityGroupMember[] = []
  for (const member of group.members) {
    const order = memberOrder(member, orderedChapterIds)
    if (order > currentOrder) continue
    const isCurrent = member.chapter_id === position.chapter_id
    if (isCurrent && member.link_available_from_pid > position.pid) continue

    const aliases = member.aliases.flatMap((alias): V3BookEntityAlias[] => {
      if (isCurrent && alias.available_from_pid > position.pid) return []
      const evidencePids = isCurrent
        ? alias.evidence_pids.filter((pid) => pid <= position.pid)
        : [...alias.evidence_pids]
      if (evidencePids.length === 0) return []
      return [{
        value: alias.value,
        evidence_pids: evidencePids,
        available_from_pid: alias.available_from_pid,
      }]
    })
    if (aliases.length === 0) continue
    members.push({
      chapter_id: member.chapter_id,
      chapter_index: member.chapter_index,
      run_id: member.run_id,
      local_cluster_id: member.local_cluster_id,
      aliases,
      evidence_pids: isCurrent
        ? member.evidence_pids.filter((pid) => pid <= position.pid)
        : [...member.evidence_pids],
      link_available_from_pid: member.link_available_from_pid,
    })
  }

  if (members.length === 0 || members.every((member) => member.aliases.length === 0)) return null
  members.sort((left, right) =>
    memberOrder(left, orderedChapterIds) - memberOrder(right, orderedChapterIds)
    || compareText(left.local_cluster_id, right.local_cluster_id))
  const labels = members.flatMap((member) => member.aliases.map((alias) => ({
    value: alias.value,
    chapter_order: memberOrder(member, orderedChapterIds),
    pid: alias.available_from_pid,
  })))
  labels.sort((left, right) =>
    left.chapter_order - right.chapter_order
    || left.pid - right.pid
    || compareText(left.value, right.value))

  return {
    global_entity_id: group.global_entity_id,
    entity_type: group.entity_type,
    label: labels[0].value,
    members,
  }
}
