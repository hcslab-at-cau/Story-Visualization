import { stageKey } from "./stage-key"
import type { PipelineArtifact, StageId } from "@/types/schema"
import type { BookMemorySnapshot } from "@/types/book-memory"
import type { NarrativeGraphQueryResult } from "@/types/narrative-graph"
import type {
  KnowledgeGraphNodeKind,
  KnowledgeGraphQueryResult,
} from "@/types/graph"
import type { RunReadinessReport } from "@/types/readiness"
import type { SupportContextKind } from "@/types/support-context"
import type { V3QARetrievalResult } from "@/lib/pipeline/v3-qa-retrieval-types"
import type { V3QAAnswerResult } from "@/lib/pipeline/v3-qa-answer-types"
import type {
  V3QAHistoryAnswerSnapshot,
  V3QAHistoryEntry,
  V3QAHistoryPage,
} from "@/lib/v3-qa-history-types"
import type { StoredV3BookQACorpus } from "@/lib/server/v3-book-qa-corpus-store"
import type { V3BookQAAnswerResult } from "@/lib/pipeline/v3-book-qa-answer-types"
import type { V3BookReaderPosition } from "@/lib/pipeline/v3-book-qa-types"
import type {
  V3BookQAHistoryAnswerSnapshot,
  V3BookQAHistoryEntry,
  V3BookQAHistoryPage,
} from "@/lib/v3-book-qa-history-types"

export { stageKey }

export type DataSource = "current" | "legacy" | "v3"

export interface RunMeta {
  runId: string
  updatedAt: unknown
  favorite?: boolean
}

export interface DocumentStorageCleanupResult {
  docId: string
  chaptersScanned: number
  invalidRunsDeleted: number
  orphanSharedArtifactsDeleted: number
  invalidRuns: Array<{
    chapterId: string
    runId: string
    stageId: StageId
    missingStageId: StageId
  }>
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  })
  const data = (await res.json()) as T & { error?: string }
  if (!res.ok) {
    throw new Error(data.error ?? `HTTP ${res.status}`)
  }
  return data
}

export async function listRuns(
  docId: string,
  chapterId: string,
  source?: DataSource,
): Promise<RunMeta[]> {
  const query = new URLSearchParams({
    docId,
    chapterId,
  })
  if (source) query.set("source", source)
  const data = await requestJson<{ runs: RunMeta[] }>(
    `/api/runs?${query.toString()}`,
  )
  return data.runs
}

export async function deleteRun(
  docId: string,
  chapterId: string,
  runId: string,
): Promise<void> {
  await requestJson<{ ok: true }>("/api/runs", {
    method: "DELETE",
    body: JSON.stringify({ docId, chapterId, runId }),
  })
}

export async function cleanupDocumentStorage(
  docId: string,
): Promise<DocumentStorageCleanupResult> {
  const data = await requestJson<{ ok: true; cleanup: DocumentStorageCleanupResult }>(
    "/api/storage-cleanup",
    {
      method: "POST",
      body: JSON.stringify({ docId }),
    },
  )
  return data.cleanup
}

export async function setRunFavorite(
  docId: string,
  chapterId: string,
  runId: string,
  favorite: boolean,
): Promise<void> {
  await requestJson<{ ok: true }>("/api/runs/favorite", {
    method: "POST",
    body: JSON.stringify({ docId, chapterId, runId, favorite }),
  })
}

export async function loadStageResult<T extends PipelineArtifact>(
  docId: string,
  chapterId: string,
  runId: string,
  stageKeyValue: string,
  source?: DataSource,
): Promise<T | null> {
  const query = new URLSearchParams({
    docId,
    chapterId,
    runId,
    stageKey: stageKeyValue,
  })
  if (source) query.set("source", source)
  const data = await requestJson<{ result: T | null }>(
    `/api/stage-result?${query.toString()}`,
  )
  return data.result
}

export async function loadRunResults(
  docId: string,
  chapterId: string,
  runId: string,
  source?: DataSource,
): Promise<Record<string, unknown>> {
  const query = new URLSearchParams({
    docId,
    chapterId,
    runId,
  })
  if (source) query.set("source", source)
  const data = await requestJson<{ results: Record<string, unknown> }>(
    `/api/run-results?${query.toString()}`,
  )
  return data.results
}

export async function forkRunResults(
  docId: string,
  chapterId: string,
  sourceRunId: string,
  targetRunId: string,
  stagesToCopy: StageId[],
): Promise<void> {
  await requestJson<{ ok: true }>("/api/fork-run", {
    method: "POST",
    body: JSON.stringify({ docId, chapterId, sourceRunId, targetRunId, stagesToCopy }),
  })
}

export async function saveRunStageModels(
  docId: string,
  chapterId: string,
  runId: string,
  stageModels: Partial<Record<StageId, string>>,
  source?: DataSource,
): Promise<void> {
  await requestJson<{ ok: true }>("/api/run-stage-models", {
    method: "POST",
    body: JSON.stringify({ docId, chapterId, runId, stageModels, source }),
  })
}

export async function deleteStageResult(
  docId: string,
  chapterId: string,
  runId: string,
  stageId: StageId,
  source?: DataSource,
): Promise<void> {
  await requestJson<{ ok: true }>("/api/stage-result", {
    method: "DELETE",
    body: JSON.stringify({ docId, chapterId, runId, stageId, source }),
  })
}

export async function retrieveV3QAEvidence(params: {
  docId: string
  chapterId: string
  runId: string
  question: string
  progressEndPid: number
  source?: DataSource
  limit?: number
}): Promise<V3QARetrievalResult> {
  return requestJson<V3QARetrievalResult>("/api/pipeline/v3-qa-retrieve", {
    method: "POST",
    body: JSON.stringify(params),
  })
}

export async function answerV3Question(params: {
  docId: string
  chapterId: string
  runId: string
  question: string
  progressEndPid: number
  source?: DataSource
  limit?: number
  model?: string
}): Promise<V3QAAnswerResult> {
  return requestJson<V3QAAnswerResult>("/api/pipeline/v3-qa-answer", {
    method: "POST",
    body: JSON.stringify(params),
  })
}

export async function loadV3BookQACorpus(
  docId: string,
  qaCorpusId: string,
): Promise<StoredV3BookQACorpus> {
  const query = new URLSearchParams({ docId, qaCorpusId })
  return requestJson<StoredV3BookQACorpus>(
    `/api/pipeline/v3-book-qa-corpus?${query.toString()}`,
  )
}

export async function buildV3BookQACorpus(params: {
  docId: string
  chapterRunIds?: Record<string, string>
}): Promise<StoredV3BookQACorpus> {
  return requestJson<StoredV3BookQACorpus>("/api/pipeline/v3-book-qa-corpus", {
    method: "POST",
    body: JSON.stringify({
      source: "v3",
      docId: params.docId,
      ...(params.chapterRunIds ? { chapterRunIds: params.chapterRunIds } : {}),
    }),
  })
}

export async function answerV3BookQuestion(params: {
  docId: string
  qaCorpusId: string
  question: string
  readerPosition: V3BookReaderPosition
  limit?: number
  model?: string
}): Promise<V3BookQAAnswerResult> {
  return requestJson<V3BookQAAnswerResult>("/api/pipeline/v3-book-qa-answer", {
    method: "POST",
    body: JSON.stringify({ source: "v3", ...params }),
  })
}

export async function listV3BookQAHistory(params: {
  docId: string
  qaCorpusId: string
  cursor?: string
}): Promise<V3BookQAHistoryPage> {
  const query = new URLSearchParams({
    source: "v3",
    docId: params.docId,
    qaCorpusId: params.qaCorpusId,
  })
  if (params.cursor) query.set("cursor", params.cursor)
  return requestJson<V3BookQAHistoryPage>(
    `/api/v3/book-qa-history?${query.toString()}`,
  )
}

export async function saveV3BookQAHistory(params: {
  docId: string
  qaCorpusId: string
  question: string
  readerPosition: V3BookReaderPosition
  answerSnapshot: V3BookQAHistoryAnswerSnapshot
}): Promise<V3BookQAHistoryEntry> {
  return requestJson<V3BookQAHistoryEntry>("/api/v3/book-qa-history", {
    method: "POST",
    body: JSON.stringify({ source: "v3", ...params }),
  })
}

export async function deleteV3BookQAHistory(params: {
  docId: string
  qaCorpusId: string
  entryId: string
}): Promise<void> {
  await requestJson<{ ok: true }>("/api/v3/book-qa-history", {
    method: "DELETE",
    body: JSON.stringify({ source: "v3", ...params }),
  })
}

export async function listV3QAHistory(params: {
  docId: string
  chapterId: string
  runId: string
  source: DataSource
  cursor?: string
}): Promise<V3QAHistoryPage> {
  const query = new URLSearchParams({
    docId: params.docId,
    chapterId: params.chapterId,
    runId: params.runId,
    source: params.source,
  })
  if (params.cursor) query.set("cursor", params.cursor)
  return requestJson<V3QAHistoryPage>(`/api/v3/qa-history?${query.toString()}`)
}

export async function saveV3QAHistory(params: {
  docId: string
  chapterId: string
  runId: string
  source: DataSource
  question: string
  progressEndPid: number
  answerSnapshot: V3QAHistoryAnswerSnapshot
}): Promise<V3QAHistoryEntry> {
  return requestJson<V3QAHistoryEntry>("/api/v3/qa-history", {
    method: "POST",
    body: JSON.stringify(params),
  })
}

export async function deleteV3QAHistory(params: {
  docId: string
  chapterId: string
  runId: string
  source: DataSource
  entryId: string
}): Promise<void> {
  await requestJson<{ ok: true }>("/api/v3/qa-history", {
    method: "DELETE",
    body: JSON.stringify(params),
  })
}

export async function loadKnowledgeGraph(params: {
  docId: string
  chapterId: string
  runId: string
  q?: string
  kind?: KnowledgeGraphNodeKind | "all"
  nodeId?: string
  depth?: number
}): Promise<KnowledgeGraphQueryResult> {
  const query = new URLSearchParams({
    docId: params.docId,
    chapterId: params.chapterId,
    runId: params.runId,
  })
  if (params.q) query.set("q", params.q)
  if (params.kind && params.kind !== "all") query.set("kind", params.kind)
  if (params.nodeId) query.set("nodeId", params.nodeId)
  if (typeof params.depth === "number") query.set("depth", String(params.depth))

  const data = await requestJson<{ graph: KnowledgeGraphQueryResult }>(
    `/api/knowledge-graph?${query.toString()}`,
  )
  return data.graph
}

export async function rebuildKnowledgeGraph(
  docId: string,
  chapterId: string,
  runId: string,
): Promise<{ projectedStages: string[]; nodes: number; edges: number }> {
  const data = await requestJson<{
    ok: true
    projection: { projectedStages: string[]; nodes: number; edges: number }
  }>("/api/knowledge-graph", {
    method: "POST",
    body: JSON.stringify({ docId, chapterId, runId }),
  })
  return data.projection
}

export async function loadBookMemory(
  docId: string,
  bookRunId?: string,
): Promise<BookMemorySnapshot | null> {
  const query = new URLSearchParams({ docId })
  if (bookRunId) query.set("bookRunId", bookRunId)
  const data = await requestJson<{ snapshot: BookMemorySnapshot | null }>(
    `/api/book-memory?${query.toString()}`,
  )
  return data.snapshot
}

export async function loadRunReadiness(params: {
  docId: string
  chapterId: string
  runId: string
}): Promise<RunReadinessReport> {
  const query = new URLSearchParams({
    docId: params.docId,
    chapterId: params.chapterId,
    runId: params.runId,
  })
  const data = await requestJson<{ report: RunReadinessReport }>(
    `/api/run-readiness?${query.toString()}`,
  )
  return data.report
}

export async function loadNarrativeGraph(params: {
  docId: string
  bookRunId?: string
  chapterId?: string
  sceneId?: string
  supportKind?: SupportContextKind
}): Promise<NarrativeGraphQueryResult> {
  const query = new URLSearchParams({ docId: params.docId })
  if (params.bookRunId) query.set("bookRunId", params.bookRunId)
  if (params.chapterId) query.set("chapterId", params.chapterId)
  if (params.sceneId) query.set("sceneId", params.sceneId)
  if (params.supportKind && params.supportKind !== "all") query.set("supportKind", params.supportKind)
  const data = await requestJson<{ graph: NarrativeGraphQueryResult }>(
    `/api/narrative-graph?${query.toString()}`,
  )
  return data.graph
}

export async function buildBookMemory(params: {
  docId: string
  runId?: string
  bookRunId?: string
  chapterRunIds?: Record<string, string>
}): Promise<BookMemorySnapshot> {
  const data = await requestJson<{ ok: true; snapshot: BookMemorySnapshot }>("/api/book-memory", {
    method: "POST",
    body: JSON.stringify(params),
  })
  return data.snapshot
}
