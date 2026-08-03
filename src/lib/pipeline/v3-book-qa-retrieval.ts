import type { V3MemoryContractArtifact, V3MemoryTextSpan } from "./v3-memory-contract-types"
import type { V3EventFramesArtifact, V3SceneSituationCardsArtifact } from "./v3-memory-frames-types"
import type {
  V3RetrievalGraphEdge,
  V3RetrievalIndexArtifact,
  V3RetrievalRecordType,
  V3RetrievalTextDocument,
} from "./v3-narrative-memory-types"
import { selectV3BookReadableChapters } from "./v3-book-qa-corpus"
import {
  normalizeV3BookEntityIdentityKey,
  visibleV3BookEntityGroup,
} from "./v3-book-entity-grouping"
import type {
  V3BookEntityGroup,
  V3BookQACorpusManifest,
  V3BookQAReadableChapter,
  V3BookReaderPosition,
  V3BookVisibleEntityGroup,
} from "./v3-book-qa-types"
import { rankV3QARecords } from "./v3-qa-ranking"
import { retrievalRecordIdForTextDocument } from "./v3-semantic-index"

export const V3_BOOK_QA_RETRIEVAL_VERSION = "v3-book-qa-retrieval-0.1" as const
export const V3_BOOK_QA_RETRIEVAL_PROFILE = "v3_book_qa_retrieval" as const

export type V3BookQARetrievalMode = "hybrid" | "lexical_fallback"
export type V3BookQAMatchKind = "hybrid" | "semantic" | "lexical" | "entity_group" | "graph_neighbor"

export interface V3BookQARetrievalChapterInput {
  chapter_id: string
  chapter_title: string
  chapter_index: number
  retrieval_index: V3RetrievalIndexArtifact
  text_documents: V3RetrievalTextDocument[]
  scene_cards: V3SceneSituationCardsArtifact
  event_frames: V3EventFramesArtifact
  memory_contract: V3MemoryContractArtifact
}

export interface V3BookQARetrievalHit {
  record_id: string
  local_record_id: string
  record_type: V3RetrievalRecordType
  chapter_id: string
  chapter_title: string
  chapter_index: number
  label: string
  text: string
  score: number
  match_kind: V3BookQAMatchKind
  scene_id?: string
  event_id?: string
  text_span?: V3MemoryTextSpan
  pid?: number
  progress_status: "available"
  evidence_refs: string[]
  matched_terms: string[]
  semantic_similarity?: number
  entity_group_ids?: string[]
}

export interface V3BookQARetrievalGraphEdge extends V3RetrievalGraphEdge {
  chapter_id: string
}

export interface V3BookQARetrievalResult {
  artifact_version: typeof V3_BOOK_QA_RETRIEVAL_VERSION
  extraction_profile: typeof V3_BOOK_QA_RETRIEVAL_PROFILE
  qa_corpus_id: string
  retrieval_mode: V3BookQARetrievalMode
  query: {
    question: string
    normalized_terms: string[]
    reader_position: V3BookReaderPosition
  }
  stats: {
    readable_chapters: number
    total_records: number
    searched_records: number
    blocked_ahead_records: number
    direct_hits: number
    lexical_hits: number
    semantic_hits: number
    entity_group_hits: number
    graph_neighbor_hits: number
    returned_hits: number
  }
  hits: V3BookQARetrievalHit[]
  graph_edges: V3BookQARetrievalGraphEdge[]
}

export interface RetrieveV3BookQAEvidenceParams {
  corpus: V3BookQACorpusManifest
  chapters: V3BookQARetrievalChapterInput[]
  entityGroups?: V3BookEntityGroup[]
  question: string
  readerPosition: V3BookReaderPosition
  limit?: number
  semanticScores?: Record<string, number>
}

interface FederatedSearchRecord {
  record_id: string
  local_record_id: string
  record_type: V3RetrievalRecordType
  chapter_id: string
  chapter_title: string
  chapter_index: number
  label: string
  text: string
  local_scene_id?: string
  local_event_id?: string
  evidence_refs: string[]
  entity_refs: string[]
  text_span?: V3MemoryTextSpan
}

interface ReadableFederatedData {
  records: FederatedSearchRecord[]
  graphEdges: V3BookQARetrievalGraphEdge[]
  totalRecords: number
  blockedRecords: number
}

function namespaced(chapterId: string, localId: string): string {
  return `${chapterId}:${localId}`
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function uniqueText(values: Array<string | undefined>): string[] {
  return unique(values.map((value) => value?.trim() ?? "").filter(Boolean))
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function compareRecords(left: FederatedSearchRecord, right: FederatedSearchRecord): number {
  return left.chapter_index - right.chapter_index
    || (left.text_span?.start_pid ?? Number.MAX_SAFE_INTEGER) - (right.text_span?.start_pid ?? Number.MAX_SAFE_INTEGER)
    || compareText(left.record_id, right.record_id)
}

function normalizedLimit(value: number | undefined): number {
  if (value === undefined) return 8
  if (!Number.isFinite(value) || value < 1) {
    throw new Error("Book QA retrieval limit must be a positive number")
  }
  return Math.floor(value)
}

function buildSpanResolvers(chapter: V3BookQARetrievalChapterInput): {
  sceneSpans: Map<string, V3MemoryTextSpan>
  eventSpans: Map<string, V3MemoryTextSpan>
} {
  return {
    sceneSpans: new Map(chapter.scene_cards.scene_cards.map((scene) => [scene.scene_id, scene.text_span])),
    eventSpans: new Map(chapter.memory_contract.events.map((event) => [event.event_id, event.text_span])),
  }
}

function spanForRecord(
  record: {
    scene_id?: string
    event_id?: string
    progress_start?: number
    progress_end?: number
  },
  sceneSpans: Map<string, V3MemoryTextSpan>,
  eventSpans: Map<string, V3MemoryTextSpan>,
): V3MemoryTextSpan | undefined {
  if (record.event_id && eventSpans.has(record.event_id)) return eventSpans.get(record.event_id)
  if (record.scene_id && sceneSpans.has(record.scene_id)) return sceneSpans.get(record.scene_id)
  if (typeof record.progress_start === "number" && typeof record.progress_end === "number") {
    return { start_pid: record.progress_start, end_pid: record.progress_end }
  }
  return undefined
}

function assertChapterInputMatches(
  chapter: V3BookQARetrievalChapterInput,
  readable: V3BookQAReadableChapter,
): void {
  if (
    chapter.chapter_id !== readable.chapter_id
    || chapter.chapter_title !== readable.chapter_title
    || chapter.chapter_index !== readable.chapter_index
  ) {
    throw new Error(`Book QA chapter metadata does not match BOOK.1 for ${readable.chapter_id}`)
  }
  for (const artifact of [
    chapter.retrieval_index,
    chapter.scene_cards,
    chapter.event_frames,
    chapter.memory_contract,
  ]) {
    if (artifact.doc_id !== chapter.retrieval_index.doc_id) {
      throw new Error(`Book QA chapter artifacts have inconsistent document IDs for ${readable.chapter_id}`)
    }
    if (artifact.chapter_id !== readable.chapter_id) {
      throw new Error(`Book QA chapter artifact mismatch for ${readable.chapter_id}`)
    }
  }
}

function buildChapterSearchRecords(
  chapter: V3BookQARetrievalChapterInput,
): FederatedSearchRecord[] {
  const { sceneSpans, eventSpans } = buildSpanResolvers(chapter)
  const byId = new Map<string, FederatedSearchRecord>()

  for (const record of chapter.retrieval_index.structured_records) {
    const textSpan = spanForRecord(record, sceneSpans, eventSpans)
    byId.set(record.record_id, {
      record_id: namespaced(chapter.chapter_id, record.record_id),
      local_record_id: record.record_id,
      record_type: record.record_type,
      chapter_id: chapter.chapter_id,
      chapter_title: chapter.chapter_title,
      chapter_index: chapter.chapter_index,
      label: record.label,
      text: record.label,
      local_scene_id: record.scene_id,
      local_event_id: record.event_id,
      evidence_refs: unique(record.evidence_refs).map((ref) => namespaced(chapter.chapter_id, ref)),
      entity_refs: unique(record.entity_refs ?? []),
      ...(textSpan ? { text_span: textSpan } : {}),
    })
  }

  for (const document of chapter.text_documents) {
    const localRecordId = retrievalRecordIdForTextDocument(document)
    const current = byId.get(localRecordId)
    const textSpan = spanForRecord(document, sceneSpans, eventSpans)
    byId.set(localRecordId, {
      record_id: namespaced(chapter.chapter_id, localRecordId),
      local_record_id: localRecordId,
      record_type: document.doc_type,
      chapter_id: chapter.chapter_id,
      chapter_title: chapter.chapter_title,
      chapter_index: chapter.chapter_index,
      label: current?.label ?? document.text,
      text: uniqueText([current?.text, document.text]).join(" "),
      local_scene_id: document.scene_id ?? current?.local_scene_id,
      local_event_id: document.event_id ?? current?.local_event_id,
      evidence_refs: unique([
        ...(current?.evidence_refs ?? []),
        ...document.evidence_refs.map((ref) => namespaced(chapter.chapter_id, ref)),
      ]),
      entity_refs: current?.entity_refs ?? [],
      ...(textSpan ?? current?.text_span ? { text_span: textSpan ?? current?.text_span } : {}),
    })
  }

  return [...byId.values()].sort(compareRecords)
}

function namespaceGraphEdge(
  chapterId: string,
  edge: V3RetrievalGraphEdge,
): V3BookQARetrievalGraphEdge {
  return {
    chapter_id: chapterId,
    edge_id: namespaced(chapterId, edge.edge_id),
    from: namespaced(chapterId, edge.from),
    to: namespaced(chapterId, edge.to),
    relation_type: edge.relation_type,
    evidence_refs: edge.evidence_refs.map((ref) => namespaced(chapterId, ref)),
  }
}

function buildReadableFederatedData(
  readableChapters: V3BookQAReadableChapter[],
  chaptersById: Map<string, V3BookQARetrievalChapterInput>,
): ReadableFederatedData {
  const records: FederatedSearchRecord[] = []
  const graphEdges: V3BookQARetrievalGraphEdge[] = []
  let totalRecords = 0
  let blockedRecords = 0

  for (const readable of readableChapters) {
    const chapter = chaptersById.get(readable.chapter_id)
    if (!chapter) throw new Error(`Missing readable BOOK.1 chapter input: ${readable.chapter_id}`)
    assertChapterInputMatches(chapter, readable)
    const chapterRecords = buildChapterSearchRecords(chapter)
    totalRecords += chapterRecords.length
    const available = chapterRecords.filter((record) => {
      const allowed = Boolean(record.text_span && record.text_span.end_pid <= readable.readable_through_pid)
      if (!allowed) blockedRecords += 1
      return allowed
    })
    const availableIds = new Set(available.map((record) => record.record_id))
    records.push(...available)
    graphEdges.push(...chapter.retrieval_index.graph_edges
      .map((edge) => namespaceGraphEdge(chapter.chapter_id, edge))
      .filter((edge) => availableIds.has(edge.from) && availableIds.has(edge.to)))
  }

  records.sort(compareRecords)
  graphEdges.sort((left, right) => compareText(left.edge_id, right.edge_id))
  return { records, graphEdges, totalRecords, blockedRecords }
}

function toHit(
  record: FederatedSearchRecord,
  score: number,
  matchedTerms: string[],
  matchKind: V3BookQAMatchKind,
  semanticSimilarity?: number,
  entityGroupIds?: string[],
): V3BookQARetrievalHit {
  const exactPid = record.text_span?.start_pid === record.text_span?.end_pid
    ? record.text_span?.start_pid
    : undefined
  return {
    record_id: record.record_id,
    local_record_id: record.local_record_id,
    record_type: record.record_type,
    chapter_id: record.chapter_id,
    chapter_title: record.chapter_title,
    chapter_index: record.chapter_index,
    label: record.label,
    text: record.text,
    score,
    match_kind: matchKind,
    ...(record.local_scene_id ? { scene_id: namespaced(record.chapter_id, record.local_scene_id) } : {}),
    ...(record.local_event_id ? { event_id: namespaced(record.chapter_id, record.local_event_id) } : {}),
    ...(record.text_span ? { text_span: record.text_span } : {}),
    ...(exactPid !== undefined ? { pid: exactPid } : {}),
    progress_status: "available",
    evidence_refs: record.evidence_refs,
    matched_terms: matchedTerms,
    ...(typeof semanticSimilarity === "number" ? { semantic_similarity: semanticSimilarity } : {}),
    ...(entityGroupIds && entityGroupIds.length > 0 ? { entity_group_ids: [...entityGroupIds].sort(compareText) } : {}),
  }
}

function visibleGroupMatchesQuestion(
  group: V3BookVisibleEntityGroup,
  question: string,
): { matches: boolean; visibleTerms: string[] } {
  const normalizedQuestion = ` ${normalizeV3BookEntityIdentityKey(question)} `
  const visibleTerms = unique([
    group.label,
    ...group.members.flatMap((member) => member.aliases.map((alias) => alias.value)),
  ]).filter((term) => {
    const normalized = normalizeV3BookEntityIdentityKey(term)
    return normalized.length > 0 && normalizedQuestion.includes(` ${normalized} `)
  })
  return { matches: visibleTerms.length > 0, visibleTerms }
}

function addEntityGroupHits(params: {
  question: string
  groups: V3BookEntityGroup[]
  position: V3BookReaderPosition
  orderedChapterIds: string[]
  records: FederatedSearchRecord[]
  hitsById: Map<string, V3BookQARetrievalHit>
  limit: number
}): void {
  let added = 0
  const visibleGroups = params.groups
    .map((group) => visibleV3BookEntityGroup(group, params.position, params.orderedChapterIds))
    .filter((group): group is V3BookVisibleEntityGroup => group !== null)
    .sort((left, right) => compareText(left.global_entity_id, right.global_entity_id))

  for (const group of visibleGroups) {
    const match = visibleGroupMatchesQuestion(group, params.question)
    if (!match.matches) continue
    const clusterIdsByChapter = new Map<string, Set<string>>()
    for (const member of group.members) {
      const clusterIds = clusterIdsByChapter.get(member.chapter_id) ?? new Set<string>()
      clusterIds.add(member.local_cluster_id)
      clusterIdsByChapter.set(member.chapter_id, clusterIds)
    }

    for (const record of params.records) {
      const clusterIds = clusterIdsByChapter.get(record.chapter_id)
      if (!clusterIds || !record.entity_refs.some((ref) => clusterIds.has(ref))) continue
      const current = params.hitsById.get(record.record_id)
      if (current) {
        current.entity_group_ids = unique([...(current.entity_group_ids ?? []), group.global_entity_id]).sort(compareText)
        continue
      }
      if (added >= params.limit) break
      params.hitsById.set(record.record_id, toHit(
        record,
        0,
        match.visibleTerms,
        "entity_group",
        undefined,
        [group.global_entity_id],
      ))
      added += 1
    }
    if (added >= params.limit) break
  }
}

function addGraphNeighborHits(params: {
  edges: V3BookQARetrievalGraphEdge[]
  recordsById: Map<string, FederatedSearchRecord>
  directIds: Set<string>
  hitsById: Map<string, V3BookQARetrievalHit>
  limit: number
}): V3BookQARetrievalGraphEdge[] {
  let added = 0
  const selectedEdges: V3BookQARetrievalGraphEdge[] = []
  for (const edge of params.edges) {
    if (!params.directIds.has(edge.from) && !params.directIds.has(edge.to)) continue
    if (selectedEdges.length < params.limit) selectedEdges.push(edge)
    for (const neighborId of [edge.from, edge.to]) {
      if (params.directIds.has(neighborId) || params.hitsById.has(neighborId)) continue
      if (added >= params.limit) break
      const neighbor = params.recordsById.get(neighborId)
      if (!neighbor) continue
      params.hitsById.set(neighborId, toHit(neighbor, 0, [], "graph_neighbor"))
      added += 1
    }
  }
  return selectedEdges
}

const MATCH_KIND_ORDER: Record<V3BookQAMatchKind, number> = {
  hybrid: 0,
  semantic: 1,
  lexical: 2,
  entity_group: 3,
  graph_neighbor: 4,
}

function compareHits(left: V3BookQARetrievalHit, right: V3BookQARetrievalHit): number {
  return right.score - left.score
    || MATCH_KIND_ORDER[left.match_kind] - MATCH_KIND_ORDER[right.match_kind]
    || left.chapter_index - right.chapter_index
    || (left.text_span?.start_pid ?? Number.MAX_SAFE_INTEGER) - (right.text_span?.start_pid ?? Number.MAX_SAFE_INTEGER)
    || compareText(left.record_id, right.record_id)
}

export function retrieveV3BookQAEvidence({
  corpus,
  chapters,
  entityGroups = [],
  question,
  readerPosition,
  limit,
  semanticScores,
}: RetrieveV3BookQAEvidenceParams): V3BookQARetrievalResult {
  const resultLimit = normalizedLimit(limit)
  const readableChapters = selectV3BookReadableChapters(corpus, readerPosition)
  const chaptersById = new Map<string, V3BookQARetrievalChapterInput>()
  for (const chapter of chapters) {
    if (chaptersById.has(chapter.chapter_id)) {
      throw new Error(`Duplicate book QA retrieval chapter input: ${chapter.chapter_id}`)
    }
    chaptersById.set(chapter.chapter_id, chapter)
  }
  const data = buildReadableFederatedData(readableChapters, chaptersById)

  // All readable chapter records participate in one shared lexical/semantic rank and one RRF pass.
  const ranking = rankV3QARecords({
    question,
    records: data.records,
    semanticScores,
  })
  const recordsById = new Map(data.records.map((record) => [record.record_id, record]))
  const hitsById = new Map<string, V3BookQARetrievalHit>()
  for (const ranked of ranking.rankedRecords) {
    hitsById.set(ranked.record.record_id, toHit(
      ranked.record,
      ranked.score,
      ranked.matchedTerms,
      ranked.matchKind,
      ranked.semanticSimilarity,
    ))
  }

  addEntityGroupHits({
    question,
    groups: entityGroups,
    position: readerPosition,
    orderedChapterIds: corpus.ordered_chapter_ids,
    records: data.records,
    hitsById,
    limit: resultLimit,
  })

  const directIds = new Set(ranking.rankedRecords.map((ranked) => ranked.record.record_id))
  const selectedEdges = addGraphNeighborHits({
    edges: data.graphEdges,
    recordsById,
    directIds,
    hitsById,
    limit: resultLimit,
  })
  const hits = [...hitsById.values()].sort(compareHits).slice(0, resultLimit)
  const returnedIds = new Set(hits.map((hit) => hit.record_id))
  const graphEdges = selectedEdges
    .filter((edge) => returnedIds.has(edge.from) && returnedIds.has(edge.to))
    .slice(0, resultLimit)

  return {
    artifact_version: V3_BOOK_QA_RETRIEVAL_VERSION,
    extraction_profile: V3_BOOK_QA_RETRIEVAL_PROFILE,
    qa_corpus_id: corpus.qa_corpus_id,
    retrieval_mode: semanticScores === undefined ? "lexical_fallback" : "hybrid",
    query: {
      question,
      normalized_terms: ranking.normalizedTerms,
      reader_position: { ...readerPosition },
    },
    stats: {
      readable_chapters: readableChapters.length,
      total_records: data.totalRecords,
      searched_records: data.records.length,
      blocked_ahead_records: data.blockedRecords,
      direct_hits: ranking.rankedRecords.length,
      lexical_hits: ranking.lexicalHits.length,
      semantic_hits: ranking.semanticHits.length,
      entity_group_hits: hits.filter((hit) => hit.match_kind === "entity_group").length,
      graph_neighbor_hits: hits.filter((hit) => hit.match_kind === "graph_neighbor").length,
      returned_hits: hits.length,
    },
    hits,
    graph_edges: graphEdges,
  }
}
