"use client"

import { useEffect, useMemo, useState } from "react"
import {
  buildBookMemory,
  listRuns,
  loadBookMemory,
  loadStageResult,
  stageKey,
  type RunMeta,
} from "@/lib/client-data"
import type { BookMemorySnapshot } from "@/types/book-memory"
import type { EntityGraph, SupportMemoryLog } from "@/types/schema"
import type { ChapterMeta } from "@/types/ui"

interface Props {
  docId: string
  runId: string
  currentChapterId: string
  chapters: ChapterMeta[]
}

interface ChapterRunStatus {
  sup0: "unknown" | "ok" | "missing"
  ent3: "unknown" | "ok" | "missing"
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 truncate text-2xl font-semibold text-zinc-900">{value}</p>
    </div>
  )
}

function preferredRunId(runs: RunMeta[], currentRunId?: string): string {
  if (currentRunId && runs.some((run) => run.runId === currentRunId)) {
    return currentRunId
  }
  return runs.find((run) => run.favorite)?.runId ?? runs[0]?.runId ?? ""
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))))
}

function statusBadge(label: string, status: ChapterRunStatus["sup0"]) {
  const className = status === "ok"
    ? "bg-emerald-50 text-emerald-700"
    : status === "missing"
      ? "bg-amber-50 text-amber-700"
      : "bg-zinc-100 text-zinc-500"

  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${className}`}>
      {label}: {status}
    </span>
  )
}

export default function BookMemoryPanel({
  docId,
  runId,
  currentChapterId,
  chapters,
}: Props) {
  const [snapshot, setSnapshot] = useState<BookMemorySnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [building, setBuilding] = useState(false)
  const [loadingRunOptions, setLoadingRunOptions] = useState(false)
  const [checkingStages, setCheckingStages] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [runsByChapter, setRunsByChapter] = useState<Record<string, RunMeta[]>>({})
  const [selectedRunIds, setSelectedRunIds] = useState<Record<string, string>>({})
  const [autoResolvedRunIds, setAutoResolvedRunIds] = useState<Record<string, string>>({})
  const [statusByChapter, setStatusByChapter] = useState<Record<string, ChapterRunStatus>>({})

  const selectedChapterRunIds = useMemo(
    () => Object.fromEntries(
      chapters
        .map((chapter) => [chapter.chapterId, selectedRunIds[chapter.chapterId]?.trim()] as const)
        .filter((entry): entry is [string, string] => Boolean(entry[1])),
    ),
    [chapters, selectedRunIds],
  )

  const manualSelectionCount = Object.keys(selectedChapterRunIds).length
  const sup0ReadyCount = chapters.filter(
    (chapter) => statusByChapter[chapter.chapterId]?.sup0 === "ok",
  ).length

  async function handleLoadLatest() {
    setLoading(true)
    setError(null)
    try {
      setSnapshot(await loadBookMemory(docId))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  async function handleBuild() {
    setBuilding(true)
    setError(null)
    try {
      setSnapshot(await buildBookMemory({
        docId,
        runId,
        chapterRunIds: selectedChapterRunIds,
      }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBuilding(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    async function loadInitialSnapshot() {
      setLoading(true)
      setError(null)
      try {
        const latest = await loadBookMemory(docId)
        if (!cancelled) setSnapshot(latest)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadInitialSnapshot()
    return () => {
      cancelled = true
    }
  }, [docId])

  useEffect(() => {
    let cancelled = false

    async function loadChapterRunOptions() {
      if (!docId || chapters.length === 0) {
        setRunsByChapter({})
        setSelectedRunIds({})
        return
      }

      setLoadingRunOptions(true)
      setError(null)
      try {
        const entries = await Promise.all(
          chapters.map(async (chapter) => {
            const runs = await listRuns(docId, chapter.chapterId)
            return [chapter.chapterId, runs] as const
          }),
        )
        if (cancelled) return

        const nextRunsByChapter = Object.fromEntries(entries)
        setRunsByChapter(nextRunsByChapter)
        setSelectedRunIds((current) => Object.fromEntries(
          chapters.map((chapter) => {
            const runs = nextRunsByChapter[chapter.chapterId] ?? []
            const currentSelection = current[chapter.chapterId]
            const keepCurrent =
              currentSelection === "" ||
              Boolean(currentSelection && runs.some((run) => run.runId === currentSelection))
            return [chapter.chapterId, keepCurrent ? currentSelection : ""]
          }),
        ))
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoadingRunOptions(false)
      }
    }

    void loadChapterRunOptions()
    return () => {
      cancelled = true
    }
  }, [chapters, currentChapterId, docId, runId])

  useEffect(() => {
    let cancelled = false

    async function checkSelectedStages() {
      if (!docId || chapters.length === 0) {
        setStatusByChapter({})
        return
      }

      setCheckingStages(true)
      try {
        const resolvedRunEntries: Array<readonly [string, string]> = []
        const entries = await Promise.all(
          chapters.map(async (chapter) => {
            const selectedRunId = selectedRunIds[chapter.chapterId]
            const runs = runsByChapter[chapter.chapterId] ?? []
            const candidateRunIds = selectedRunId
              ? [selectedRunId]
              : uniqueStrings([
                chapter.chapterId === currentChapterId ? runId : undefined,
                preferredRunId(runs),
                ...runs.map((run) => run.runId),
              ])

            if (candidateRunIds.length === 0) {
              return [chapter.chapterId, { sup0: "missing", ent3: "missing" }] as const
            }

            let fallbackStatus: ChapterRunStatus = { sup0: "missing", ent3: "missing" }
            for (const candidateRunId of candidateRunIds) {
              const [supportMemory, entityGraph] = await Promise.all([
                loadStageResult<SupportMemoryLog>(
                  docId,
                  chapter.chapterId,
                  candidateRunId,
                  stageKey("SUP.0"),
                ).catch(() => null),
                loadStageResult<EntityGraph>(
                  docId,
                  chapter.chapterId,
                  candidateRunId,
                  stageKey("ENT.3"),
                ).catch(() => null),
              ])

              fallbackStatus = {
                sup0: supportMemory ? "ok" : "missing",
                ent3: entityGraph ? "ok" : "missing",
              }

              if (supportMemory) {
                if (!selectedRunId) {
                  resolvedRunEntries.push([chapter.chapterId, candidateRunId] as const)
                }
                return [chapter.chapterId, fallbackStatus] as const
              }
            }

            return [chapter.chapterId, fallbackStatus] as const
          }),
        )
        if (!cancelled) {
          setStatusByChapter(Object.fromEntries(entries))
          setAutoResolvedRunIds(Object.fromEntries(resolvedRunEntries))
        }
      } finally {
        if (!cancelled) setCheckingStages(false)
      }
    }

    void checkSelectedStages()
    return () => {
      cancelled = true
    }
  }, [chapters, currentChapterId, docId, runId, runsByChapter, selectedRunIds])

  const topEdges = snapshot?.edges.slice(0, 8) ?? []
  const topThreads = snapshot?.entityThreads.slice(0, 8) ?? []

  return (
    <section className="rounded-2xl border border-zinc-200 bg-zinc-50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Book Memory</p>
          <h3 className="mt-1 text-lg font-semibold text-zinc-900">Cross-chapter memory snapshot</h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-600">
            책 단위 메모리는 챕터마다 서로 다른 run 결과를 조합합니다. 아래에서 각 챕터에 사용할 run을 고른 뒤
            SUP.0이 있는 조합으로 빌드합니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleBuild()}
            disabled={chapters.length === 0 || building || loading || loadingRunOptions}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
          >
            {building ? "Building..." : "Build from Selected Runs"}
          </button>
          <button
            type="button"
            onClick={() => void handleLoadLatest()}
            disabled={loading || building}
            className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            {loading ? "Loading..." : "Load Latest"}
          </button>
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-zinc-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-zinc-900">Chapter run selection</p>
            <p className="mt-1 text-xs text-zinc-500">
              manual {manualSelectionCount}/{chapters.length}, SUP.0 ready {sup0ReadyCount}/{chapters.length}
              {checkingStages ? " checking..." : ""}
            </p>
          </div>
          {loadingRunOptions && (
            <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-500">Loading run options...</span>
          )}
        </div>

        <div className="max-h-[360px] overflow-y-auto p-3">
          <div className="grid gap-2">
            {chapters.map((chapter) => {
              const runs = runsByChapter[chapter.chapterId] ?? []
              const selectedRunId = selectedRunIds[chapter.chapterId] ?? ""
              const autoResolvedRunId = autoResolvedRunIds[chapter.chapterId]
              const status = statusByChapter[chapter.chapterId] ?? { sup0: "unknown", ent3: "unknown" }

              return (
                <div
                  key={chapter.chapterId}
                  className="grid gap-3 rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-3 lg:grid-cols-[minmax(220px,0.9fr)_minmax(260px,1.2fr)_auto] lg:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-zinc-800">
                        {`Chapter ${chapter.index + 1} - ${chapter.title}`}
                      </p>
                      {chapter.chapterId === currentChapterId && (
                        <span className="shrink-0 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] text-sky-700">
                          current
                        </span>
                      )}
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-zinc-400">{chapter.chapterId}</p>
                    {!selectedRunId && autoResolvedRunId && (
                      <p className="mt-1 truncate font-mono text-[11px] text-emerald-600">
                        auto: {autoResolvedRunId}
                      </p>
                    )}
                  </div>

                  <select
                    value={selectedRunId}
                    onChange={(event) => {
                      const nextRunId = event.target.value
                      setSelectedRunIds((current) => ({
                        ...current,
                        [chapter.chapterId]: nextRunId,
                      }))
                    }}
                    disabled={loadingRunOptions || runs.length === 0}
                    className="min-w-0 rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-xs text-zinc-700 disabled:opacity-50"
                  >
                    <option value="">{runs.length === 0 ? "No saved run" : "Auto select SUP.0-ready run"}</option>
                    {runs.map((run) => (
                      <option key={run.runId} value={run.runId}>
                        {`${run.favorite ? "* " : ""}${run.runId}`}
                      </option>
                    ))}
                  </select>

                  <div className="flex flex-wrap gap-1.5">
                    {statusBadge("SUP.0", status.sup0)}
                    {statusBadge("ENT.3", status.ent3)}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {snapshot ? (
        <div className="mt-5 space-y-5">
          <div className="grid gap-3 md:grid-cols-5">
            <StatCard label="Book Run" value={snapshot.bookRunId} />
            <StatCard label="Chapters" value={snapshot.chapters.length} />
            <StatCard label="Scenes" value={snapshot.sceneRefs.length} />
            <StatCard label="Edges" value={snapshot.edges.length} />
            <StatCard label="Entity Threads" value={snapshot.entityThreads.length} />
          </div>

          {snapshot.missingChapters.length > 0 && (
            <details className="rounded-xl border border-amber-200 bg-amber-50">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-amber-800">
                Missing chapters ({snapshot.missingChapters.length})
              </summary>
              <div className="space-y-2 border-t border-amber-200 p-4">
                {snapshot.missingChapters.map((chapter) => (
                  <p key={chapter.chapterId} className="text-sm text-amber-800">
                    {chapter.chapterTitle}: {chapter.reason}
                  </p>
                ))}
              </div>
            </details>
          )}

          <div className="grid gap-5 xl:grid-cols-2">
            <div className="rounded-xl border border-zinc-200 bg-white p-4">
              <p className="text-sm font-semibold text-zinc-900">Cross-chapter edges</p>
              <div className="mt-3 space-y-2">
                {topEdges.map((edge) => (
                  <div key={edge.edgeId} className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{edge.type}</span>
                      <span className="text-xs text-zinc-400">{`${edge.fromChapterId} -> ${edge.toChapterId}`}</span>
                    </div>
                    <p className="mt-1 text-sm text-zinc-700">{edge.label}</p>
                  </div>
                ))}
                {topEdges.length === 0 && <p className="text-sm text-zinc-400">No cross-chapter edges yet.</p>}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-4">
              <p className="text-sm font-semibold text-zinc-900">Entity threads</p>
              <div className="mt-3 space-y-2">
                {topThreads.map((thread) => (
                  <div key={thread.threadId} className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold text-zinc-800">{thread.canonicalName}</span>
                      <span className="text-xs text-zinc-400">{thread.chapters.length} chapters</span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">
                      {thread.chapters.join(" -> ")} / mentions {thread.totalMentions}
                    </p>
                  </div>
                ))}
                {topThreads.length === 0 && <p className="text-sm text-zinc-400">No repeated entity thread yet.</p>}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-5 rounded-xl border border-dashed border-zinc-300 bg-white px-4 py-6 text-center text-sm text-zinc-500">
          No book memory snapshot yet. Build one after SUP.0 is available for at least one chapter.
        </div>
      )}
    </section>
  )
}
