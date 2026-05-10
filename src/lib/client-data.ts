import { stageKey } from "./stage-key"
import type { PipelineArtifact, StageId } from "@/types/schema"
import type { BookMemorySnapshot } from "@/types/book-memory"
import type {
  KnowledgeGraphNodeKind,
  KnowledgeGraphQueryResult,
} from "@/types/graph"

export { stageKey }

export type DataSource = "current" | "legacy"

export interface RunMeta {
  runId: string
  updatedAt: unknown
  favorite?: boolean
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
): Promise<void> {
  await requestJson<{ ok: true }>("/api/run-stage-models", {
    method: "POST",
    body: JSON.stringify({ docId, chapterId, runId, stageModels }),
  })
}

export async function deleteStageResult(
  docId: string,
  chapterId: string,
  runId: string,
  stageId: StageId,
): Promise<void> {
  await requestJson<{ ok: true }>("/api/stage-result", {
    method: "DELETE",
    body: JSON.stringify({ docId, chapterId, runId, stageId }),
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
