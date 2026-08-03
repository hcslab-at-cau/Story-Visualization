export interface V3QARankableRecord {
  record_id: string
  label: string
  text: string
}

export interface V3QALexicalRank<TRecord extends V3QARankableRecord> {
  record: TRecord
  score: number
  matchedTerms: string[]
  rank: number
}

export interface V3QASemanticRank<TRecord extends V3QARankableRecord> {
  record: TRecord
  similarity: number
  rank: number
}

export interface V3QAFusedRank<TRecord extends V3QARankableRecord> {
  record: TRecord
  score: number
  matchedTerms: string[]
  matchKind: "hybrid" | "semantic" | "lexical"
  semanticSimilarity?: number
}

export interface V3QARankingResult<TRecord extends V3QARankableRecord> {
  normalizedTerms: string[]
  lexicalHits: V3QALexicalRank<TRecord>[]
  semanticHits: V3QASemanticRank<TRecord>[]
  rankedRecords: V3QAFusedRank<TRecord>[]
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

const RRF_K = 60

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^\p{Letter}\p{Number}\s]/gu, " ").replace(/\s+/g, " ").trim()
}

function normalizeQueryTerms(question: string): string[] {
  return Array.from(new Set(
    normalizeText(question)
      .split(" ")
      .filter((term) => term.length > 1 && !STOP_TERMS.has(term)),
  ))
}

function lexicalScore(
  record: V3QARankableRecord,
  terms: string[],
): { score: number; matchedTerms: string[] } {
  const haystack = normalizeText(`${record.label} ${record.text}`)
  const matchedTerms = terms.filter((term) => haystack.includes(term))
  const exactBonus = terms.length > 0 && haystack.includes(terms.join(" ")) ? 20 : 0
  return {
    score: matchedTerms.length * 10 + exactBonus,
    matchedTerms,
  }
}

function reciprocalRank(rank: number): number {
  return 1 / (RRF_K + rank + 1)
}

export function rankV3QARecords<TRecord extends V3QARankableRecord>(params: {
  question: string
  records: TRecord[]
  semanticScores?: Record<string, number>
}): V3QARankingResult<TRecord> {
  const normalizedTerms = normalizeQueryTerms(params.question)
  const lexicalHits = params.records
    .map((record) => ({ record, ...lexicalScore(record, normalizedTerms) }))
    .filter((hit) => hit.score > 0)
    .sort((left, right) => right.score - left.score || left.record.record_id.localeCompare(right.record.record_id))
    .map((hit, rank) => ({ ...hit, rank }))
  const semanticHits = params.semanticScores === undefined
    ? []
    : params.records
      .flatMap((record) => {
        const similarity = params.semanticScores?.[record.record_id]
        return typeof similarity === "number" && Number.isFinite(similarity) ? [{ record, similarity }] : []
      })
      .sort((left, right) => right.similarity - left.similarity || left.record.record_id.localeCompare(right.record.record_id))
      .map((hit, rank) => ({ ...hit, rank }))

  const lexicalById = new Map(lexicalHits.map((hit) => [hit.record.record_id, hit]))
  const semanticById = new Map(semanticHits.map((hit) => [hit.record.record_id, hit]))
  const rankedIds = params.semanticScores === undefined
    ? lexicalHits.map((hit) => hit.record.record_id)
    : Array.from(new Set([...lexicalById.keys(), ...semanticById.keys()]))
      .sort((left, right) => {
        const leftLexical = lexicalById.get(left)
        const leftSemantic = semanticById.get(left)
        const rightLexical = lexicalById.get(right)
        const rightSemantic = semanticById.get(right)
        const leftScore = (leftLexical ? reciprocalRank(leftLexical.rank) : 0)
          + (leftSemantic ? reciprocalRank(leftSemantic.rank) : 0)
        const rightScore = (rightLexical ? reciprocalRank(rightLexical.rank) : 0)
          + (rightSemantic ? reciprocalRank(rightSemantic.rank) : 0)
        return rightScore - leftScore || left.localeCompare(right)
      })
  const recordsById = new Map(params.records.map((record) => [record.record_id, record]))
  const rankedRecords = rankedIds.flatMap((recordId): V3QAFusedRank<TRecord>[] => {
    const record = recordsById.get(recordId)
    if (!record) return []
    const lexical = lexicalById.get(recordId)
    const semantic = semanticById.get(recordId)
    const matchKind = lexical && semantic ? "hybrid" : semantic ? "semantic" : "lexical"
    const score = params.semanticScores === undefined
      ? (lexical?.score ?? 0)
      : (lexical ? reciprocalRank(lexical.rank) : 0) + (semantic ? reciprocalRank(semantic.rank) : 0)
    return [{
      record,
      score,
      matchedTerms: lexical?.matchedTerms ?? [],
      matchKind,
      ...(semantic ? { semanticSimilarity: semantic.similarity } : {}),
    }]
  })

  return { normalizedTerms, lexicalHits, semanticHits, rankedRecords }
}
