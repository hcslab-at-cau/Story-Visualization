import type { V3MemoryContractArtifact, V3MemoryTextSpan } from "./v3-memory-contract-types"
import type { V3EventFramesArtifact, V3SceneSituationCardsArtifact } from "./v3-memory-frames-types"
import type {
  V3RetrievalIndexArtifact,
  V3RetrievalRecordType,
  V3RetrievalTextDocument,
} from "./v3-narrative-memory-types"
import type { V3QARetrievalHit, V3QARetrievalResult } from "./v3-qa-retrieval-types"

const V3_QA_RETRIEVAL_PROFILE = "v3_qa_retrieval"
const V3_QA_RETRIEVAL_VERSION = "v3-qa-retrieval-0.1"

interface RetrieveV3QAEvidenceParams {
  question: string
  progressEndPid: number
  retrievalIndex: V3RetrievalIndexArtifact
  sceneCards: V3SceneSituationCardsArtifact
  eventFrames: V3EventFramesArtifact
  memoryContract: V3MemoryContractArtifact
  limit?: number
  semanticScores?: Record<string, number>
}

interface SearchRecord {
  record_id: string
  record_type: V3RetrievalRecordType
  label: string
  text: string
  scene_id?: string
  event_id?: string
  evidence_refs: string[]
  text_span?: V3MemoryTextSpan
}

const STOP_TERMS = new Set([
  "a",
  "an",
  "and",
  "did",
  "do",
  "does",
  "for",
  "help",
  "how",
  "is",
  "it",
  "of",
  "the",
  "to",
  "what",
  "when",
  "where",
  "who",
  "why",
  "with",
])

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^\p{Letter}\p{Number}\s]/gu, " ").replace(/\s+/g, " ").trim()
}

function queryTerms(question: string): string[] {
  return Array.from(new Set(normalizeText(question).split(" ").filter((term) => term.length > 1 && !STOP_TERMS.has(term))))
}

function spanAllowed(span: V3MemoryTextSpan | undefined, progressEndPid: number): boolean {
  if (!span) return false
  return span.end_pid <= progressEndPid
}

function buildSpanResolvers(
  sceneCards: V3SceneSituationCardsArtifact,
  eventFrames: V3EventFramesArtifact,
  memoryContract: V3MemoryContractArtifact,
): {
  sceneSpan: Map<string, V3MemoryTextSpan>
  eventSpan: Map<string, V3MemoryTextSpan>
  eventScene: Map<string, string>
} {
  const sceneSpan = new Map(sceneCards.scene_cards.map((scene) => [scene.scene_id, scene.text_span]))
  const eventSpan = new Map(memoryContract.events.map((event) => [event.event_id, event.text_span]))
  const eventScene = new Map<string, string>()
  for (const frame of eventFrames.event_frames) {
    if (frame.scene_id) eventScene.set(frame.event_id, frame.scene_id)
  }
  for (const event of memoryContract.events) {
    if (event.scene_id && !eventScene.has(event.event_id)) eventScene.set(event.event_id, event.scene_id)
  }
  return { sceneSpan, eventSpan, eventScene }
}

function spanForRecord(
  record: Pick<SearchRecord, "scene_id" | "event_id"> & { progress_start?: number; progress_end?: number },
  sceneSpan: Map<string, V3MemoryTextSpan>,
  eventSpan: Map<string, V3MemoryTextSpan>,
): V3MemoryTextSpan | undefined {
  if (record.event_id && eventSpan.has(record.event_id)) return eventSpan.get(record.event_id)
  if (record.scene_id && sceneSpan.has(record.scene_id)) return sceneSpan.get(record.scene_id)
  if (typeof record.progress_start === "number" && typeof record.progress_end === "number") {
    return { start_pid: record.progress_start, end_pid: record.progress_end }
  }
  return undefined
}

function buildSearchRecords(
  retrievalIndex: V3RetrievalIndexArtifact,
  sceneCards: V3SceneSituationCardsArtifact,
  eventFrames: V3EventFramesArtifact,
  memoryContract: V3MemoryContractArtifact,
): SearchRecord[] {
  const { sceneSpan, eventSpan } = buildSpanResolvers(sceneCards, eventFrames, memoryContract)
  const byId = new Map<string, SearchRecord>()

  for (const record of retrievalIndex.structured_records) {
    const textSpan = spanForRecord(record, sceneSpan, eventSpan)
    byId.set(record.record_id, {
      record_id: record.record_id,
      record_type: record.record_type,
      label: record.label,
      text: record.label,
      scene_id: record.scene_id,
      event_id: record.event_id,
      evidence_refs: record.evidence_refs,
      ...(textSpan ? { text_span: textSpan } : {}),
    })
  }

  for (const doc of retrievalIndex.text_documents) {
    const recordId = recordIdForTextDocument(doc)
    const current = byId.get(recordId)
    const textSpan = spanForRecord(doc, sceneSpan, eventSpan)
    byId.set(recordId, {
      record_id: recordId,
      record_type: doc.doc_type,
      label: current?.label ?? doc.text,
      text: uniqueText([current?.text, doc.text]).join(" "),
      scene_id: doc.scene_id ?? current?.scene_id,
      event_id: doc.event_id ?? current?.event_id,
      evidence_refs: unique([...(current?.evidence_refs ?? []), ...doc.evidence_refs]),
      ...(textSpan ?? current?.text_span ? { text_span: textSpan ?? current?.text_span } : {}),
    })
  }

  return [...byId.values()]
}

function recordIdForTextDocument(doc: V3RetrievalTextDocument): string {
  if (doc.event_id) return doc.event_id
  if (doc.scene_id) return doc.scene_id
  return doc.text_doc_id.replace(/^TEXT_/, "")
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function uniqueText(values: Array<string | undefined>): string[] {
  return unique(values.map((value) => value?.trim() ?? "").filter(Boolean))
}

function scoreRecord(record: SearchRecord, terms: string[]): { score: number; matchedTerms: string[] } {
  const haystack = normalizeText(`${record.label} ${record.text}`)
  const matchedTerms = terms.filter((term) => haystack.includes(term))
  const exactBonus = terms.length > 0 && haystack.includes(terms.join(" ")) ? 20 : 0
  return {
    score: matchedTerms.length * 10 + exactBonus,
    matchedTerms,
  }
}

function toHit(
  record: SearchRecord,
  score: number,
  matchedTerms: string[],
  matchKind: V3QARetrievalHit["match_kind"],
  semanticSimilarity?: number,
): V3QARetrievalHit {
  return {
    record_id: record.record_id,
    record_type: record.record_type,
    label: record.label,
    text: record.text,
    score,
    match_kind: matchKind,
    scene_id: record.scene_id,
    event_id: record.event_id,
    text_span: record.text_span,
    progress_status: "available",
    evidence_refs: record.evidence_refs,
    matched_terms: matchedTerms,
    ...(typeof semanticSimilarity === "number" ? { semantic_similarity: semanticSimilarity } : {}),
  }
}

const RRF_K = 60

function reciprocalRank(rank: number): number {
  return 1 / (RRF_K + rank + 1)
}

export function retrieveV3QAEvidence({
  question,
  progressEndPid,
  retrievalIndex,
  sceneCards,
  eventFrames,
  memoryContract,
  limit = 8,
  semanticScores,
}: RetrieveV3QAEvidenceParams): V3QARetrievalResult {
  const terms = queryTerms(question)
  const records = buildSearchRecords(retrievalIndex, sceneCards, eventFrames, memoryContract)
  const available = records.filter((record) => spanAllowed(record.text_span, progressEndPid))
  const blockedAhead = records.length - available.length

  const directHits = available
    .map((record) => {
      const { score, matchedTerms } = scoreRecord(record, terms)
      return { record, score, matchedTerms }
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.record.record_id.localeCompare(b.record.record_id))

  const semanticHits = semanticScores === undefined
    ? []
    : available
      .flatMap((record) => {
        const similarity = semanticScores[record.record_id]
        return Number.isFinite(similarity) ? [{ record, similarity }] : []
      })
      .sort((a, b) => b.similarity - a.similarity || a.record.record_id.localeCompare(b.record.record_id))

  const lexicalById = new Map(directHits.map((hit, rank) => [hit.record.record_id, { ...hit, rank }]))
  const semanticById = new Map(semanticHits.map((hit, rank) => [hit.record.record_id, { ...hit, rank }]))
  const rankedIds = semanticScores === undefined
    ? directHits.map((hit) => hit.record.record_id)
    : unique([...lexicalById.keys(), ...semanticById.keys()]).sort((left, right) => {
      const leftScore = (lexicalById.has(left) ? reciprocalRank(lexicalById.get(left)?.rank ?? 0) : 0)
        + (semanticById.has(left) ? reciprocalRank(semanticById.get(left)?.rank ?? 0) : 0)
      const rightScore = (lexicalById.has(right) ? reciprocalRank(lexicalById.get(right)?.rank ?? 0) : 0)
        + (semanticById.has(right) ? reciprocalRank(semanticById.get(right)?.rank ?? 0) : 0)
      return rightScore - leftScore || left.localeCompare(right)
    })

  const availableById = new Map(available.map((record) => [record.record_id, record]))
  const hitMap = new Map<string, V3QARetrievalHit>()
  for (const recordId of rankedIds) {
    const record = availableById.get(recordId)
    if (!record) continue
    const lexical = lexicalById.get(recordId)
    const semantic = semanticById.get(recordId)
    const matchKind = lexical && semantic ? "hybrid" : semantic ? "semantic" : "lexical"
    const score = semanticScores === undefined
      ? (lexical?.score ?? 0)
      : (lexical ? reciprocalRank(lexical.rank) : 0) + (semantic ? reciprocalRank(semantic.rank) : 0)
    hitMap.set(recordId, toHit(record, score, lexical?.matchedTerms ?? [], matchKind, semantic?.similarity))
  }

  const directIds = new Set(rankedIds)
  const graphEdges = retrievalIndex.graph_edges.filter((edge) => directIds.has(edge.from) || directIds.has(edge.to))

  for (const edge of graphEdges) {
    for (const neighborId of [edge.from, edge.to]) {
      if (directIds.has(neighborId) || hitMap.has(neighborId)) continue
      const neighbor = availableById.get(neighborId)
      if (!neighbor) continue
      hitMap.set(neighborId, toHit(neighbor, 0, [], "graph_neighbor"))
    }
  }

  const hits = [...hitMap.values()]
    .sort((a, b) => b.score - a.score || a.record_id.localeCompare(b.record_id))
    .slice(0, limit)

  return {
    artifact_version: V3_QA_RETRIEVAL_VERSION,
    extraction_profile: V3_QA_RETRIEVAL_PROFILE,
    retrieval_mode: semanticScores === undefined ? "lexical_fallback" : "hybrid",
    query: {
      question,
      normalized_terms: terms,
      progress_end_pid: progressEndPid,
    },
    stats: {
      total_records: records.length,
      searched_records: available.length,
      blocked_ahead_records: blockedAhead,
      direct_hits: directHits.length,
      lexical_hits: directHits.length,
      semantic_hits: semanticHits.length,
      graph_neighbor_hits: hits.filter((hit) => hit.match_kind === "graph_neighbor").length,
      returned_hits: hits.length,
    },
    hits,
    graph_edges: graphEdges.filter((edge) => hits.some((hit) => hit.record_id === edge.from || hit.record_id === edge.to)),
  }
}
