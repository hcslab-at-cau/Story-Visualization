"use client"

import { useEffect, useState, type ReactNode } from "react"
import BookMemoryPanel from "@/components/BookMemoryPanel"
import EpubUploader from "@/components/EpubUploader"
import ExistingDocumentsPicker from "@/components/ExistingDocumentsPicker"
import KnowledgeGraphExplorer from "@/components/KnowledgeGraphExplorer"
import PipelineRunner from "@/components/PipelineRunner"
import ReaderScreen from "@/components/ReaderScreen"
import {
  deleteRun,
  listRuns,
  loadStageResult,
  setRunFavorite,
  stageKey,
  type DataSource,
  type RunMeta,
} from "@/lib/client-data"
import { createTimestampRunId } from "@/lib/run-id"
import type { OverlayRefinementResult, SceneReaderPackageLog } from "@/types/schema"
import type { ChapterMeta } from "@/types/ui"

type View = "upload" | "pipeline" | "graph" | "reader" | "legacy"

function getPreferredRunId(runs: RunMeta[]): string {
  return runs.find((item) => item.favorite)?.runId ?? runs[0]?.runId ?? ""
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default function Home() {
  const [view, setView] = useState<View>("upload")
  const [docId, setDocId] = useState("")
  const [chapters, setChapters] = useState<ChapterMeta[]>([])
  const [selectedChapterId, setSelectedChapterId] = useState("")
  const [availableRuns, setAvailableRuns] = useState<RunMeta[]>([])
  const [loadingRuns, setLoadingRuns] = useState(false)
  const [deletingRun, setDeletingRun] = useState(false)
  const [togglingFavorite, setTogglingFavorite] = useState(false)
  const [runId, setRunId] = useState("")

  useEffect(() => {
    setRunId((current) => current || createTimestampRunId())
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadRuns() {
      if (!docId || !selectedChapterId) {
        setAvailableRuns([])
        return
      }

      setLoadingRuns(true)
      try {
        const runs = await listRuns(docId, selectedChapterId)
        if (cancelled) return
        setAvailableRuns(runs)
      } finally {
        if (!cancelled) {
          setLoadingRuns(false)
        }
      }
    }

    void loadRuns()
    return () => {
      cancelled = true
    }
  }, [docId, selectedChapterId])

  function createFreshRunId(existing: string[] = []): string {
    return createTimestampRunId([runId, ...existing])
  }

  function handleUploaded(newDocId: string, newChapters: ChapterMeta[]) {
    setDocId(newDocId)
    setChapters(newChapters)
    setSelectedChapterId(newChapters[0]?.chapterId ?? "")
    setRunId(createTimestampRunId())
    setView("pipeline")
  }

  function handleSelectedExisting(newDocId: string, newChapters: ChapterMeta[]) {
    setDocId(newDocId)
    setChapters(newChapters)
    setSelectedChapterId(newChapters[0]?.chapterId ?? "")
    setRunId(createTimestampRunId())
    setView("pipeline")
  }

  const selectedChapterIndex = chapters.findIndex((chapter) => chapter.chapterId === selectedChapterId)

  function handlePipelineChapterChange(chapterId: string) {
    setSelectedChapterId(chapterId)
    setRunId(createFreshRunId())
  }

  function handleReaderChapterChange(chapterId: string) {
    setSelectedChapterId(chapterId)
    setAvailableRuns([])
    setRunId("")
  }

  const currentRunMeta = availableRuns.find((item) => item.runId === runId)
  const currentRunIsSaved = Boolean(currentRunMeta)
  const currentRunFavorite = currentRunMeta?.favorite === true
  const preferredReaderRunId = getPreferredRunId(availableRuns)

  useEffect(() => {
    if (view !== "reader" || loadingRuns) return
    if (!preferredReaderRunId) {
      if (runId) setRunId("")
      return
    }
    if (runId === preferredReaderRunId) return
    setRunId(preferredReaderRunId)
  }, [view, loadingRuns, preferredReaderRunId, runId])

  async function handleDeleteRun() {
    if (!docId || !selectedChapterId || deletingRun) return
    const confirmed = window.confirm(`Delete run ${runId}? This removes all saved stage results in this run.`)
    if (!confirmed) return

    setDeletingRun(true)
    try {
      await deleteRun(docId, selectedChapterId, runId)
      const remainingRuns = await listRuns(docId, selectedChapterId)
      setAvailableRuns(remainingRuns)
      setRunId(remainingRuns[0]?.runId ?? createTimestampRunId([runId]))
    } finally {
      setDeletingRun(false)
    }
  }

  async function handleToggleFavorite() {
    if (!docId || !selectedChapterId || !runId || !currentRunIsSaved || togglingFavorite) return
    setTogglingFavorite(true)
    try {
      await setRunFavorite(docId, selectedChapterId, runId, !currentRunFavorite)
      const runs = await listRuns(docId, selectedChapterId)
      setAvailableRuns(runs)
    } finally {
      setTogglingFavorite(false)
    }
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-50">
      <header className="flex items-center gap-6 border-b border-zinc-200 bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-zinc-900">Story Visualization</h1>
        <nav className="flex gap-1">
          {(["upload", "pipeline", "graph", "reader", "legacy"] as View[]).map((currentView) => (
            <button
              key={currentView}
              type="button"
              onClick={() => setView(currentView)}
              className={`rounded-lg px-3 py-2 text-base capitalize transition-colors ${
                view === currentView
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-500 hover:text-zinc-700"
              }`}
            >
              {currentView}
            </button>
          ))}
        </nav>
      </header>

      <main
        className={`min-h-0 flex-1 text-base ${
          view === "reader" || view === "legacy" || view === "graph"
            ? "overflow-y-auto p-0"
            : view === "pipeline"
              ? "overflow-y-auto p-6"
              : "overflow-hidden p-6"
        }`}
      >
        {view === "upload" && (
          <div className="mx-auto mt-10 grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
            <EpubUploader onUploaded={handleUploaded} />
            <ExistingDocumentsPicker onSelected={handleSelectedExisting} />
          </div>
        )}

        {view === "pipeline" && docId && (
          <div className="flex min-h-full w-full flex-col gap-5">
            <div className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5">
              <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)_minmax(0,1fr)] xl:items-end">
                <div className="min-w-[340px]">
                  <label className="mb-1 block text-sm text-zinc-500">Chapter</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const prev = chapters[selectedChapterIndex - 1]
                        if (prev) handlePipelineChapterChange(prev.chapterId)
                      }}
                      disabled={selectedChapterIndex <= 0}
                      className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
                    >
                      Prev
                    </button>
                    <select
                      value={selectedChapterId}
                      onChange={(event) => handlePipelineChapterChange(event.target.value)}
                      className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-base"
                    >
                      {chapters.map((chapter) => (
                        <option key={chapter.chapterId} value={chapter.chapterId}>
                          {`Chapter ${chapter.index + 1} - ${chapter.title}`}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        const next = chapters[selectedChapterIndex + 1]
                        if (next) handlePipelineChapterChange(next.chapterId)
                      }}
                      disabled={selectedChapterIndex < 0 || selectedChapterIndex >= chapters.length - 1}
                      className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>

                <div className="min-w-[320px] min-w-0">
                  <label className="mb-1 block text-sm text-zinc-500">Run ID</label>
                  <div className="flex gap-2">
                    <input
                      value={runId}
                      onChange={(event) => setRunId(event.target.value)}
                      className="flex-1 rounded-lg border border-zinc-200 px-3 py-2 font-mono text-base"
                    />
                    <button
                      type="button"
                      onClick={() => setRunId(createFreshRunId(availableRuns.map((item) => item.runId)))}
                      className="rounded-lg border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-50"
                    >
                      New
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleToggleFavorite()}
                      disabled={!currentRunIsSaved || togglingFavorite}
                      className={`rounded-lg border px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                        currentRunFavorite
                          ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
                          : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                      }`}
                      title={currentRunIsSaved ? "Toggle favorite for this saved run" : "Save a run first to favorite it"}
                    >
                      {currentRunFavorite ? "* Favorite" : "Favorite"}
                    </button>
                  </div>
                </div>

                <div className="min-w-[320px] min-w-0">
                  <label className="mb-1 block text-sm text-zinc-500">Saved Runs</label>
                  <div className="flex gap-2">
                    <select
                      value={availableRuns.some((item) => item.runId === runId) ? runId : ""}
                      onChange={(event) => {
                        if (event.target.value) {
                          setRunId(event.target.value)
                        }
                      }}
                      className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-base"
                    >
                      <option value="">
                        {loadingRuns ? "Loading..." : "Current draft or custom run"}
                      </option>
                      {availableRuns.map((item) => (
                        <option key={item.runId} value={item.runId}>
                          {`${item.favorite ? "* " : ""}${item.runId}`}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setRunId(createFreshRunId(availableRuns.map((item) => item.runId)))}
                      className="rounded-lg border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-50"
                    >
                      Draft
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteRun()}
                      disabled={deletingRun}
                      className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-40"
                    >
                      {deletingRun ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="min-h-[720px] min-w-0 rounded-xl border border-zinc-200 bg-white p-5">
              <PipelineRunner
                docId={docId}
                chapterId={selectedChapterId}
                runId={runId}
                onRunIdChange={setRunId}
              />
            </div>

            <button
              type="button"
              onClick={() => setView("reader")}
              className="text-base text-zinc-500 underline hover:text-zinc-800"
            >
              View reader screen
            </button>
            <button
              type="button"
              onClick={() => setView("graph")}
              className="text-base text-zinc-500 underline hover:text-zinc-800"
            >
              View knowledge graph
            </button>
          </div>
        )}

        {view === "graph" && docId && (
          <GraphView
            docId={docId}
            chapterId={selectedChapterId}
            runId={runId}
            chapters={chapters}
            availableRuns={availableRuns}
            loadingRuns={loadingRuns}
            onChapterChange={handlePipelineChapterChange}
            onRunChange={setRunId}
          />
        )}

        {view === "reader" && docId && (
          <ReaderView
            docId={docId}
            chapterId={selectedChapterId}
            runId={runId}
            chapters={chapters}
            loadingRuns={loadingRuns}
            onChapterChange={handleReaderChapterChange}
          />
        )}

        {view === "legacy" && <LegacyArchiveView />}

        {view !== "upload" && view !== "legacy" && !docId && (
          <div className="mt-20 text-center text-zinc-400">
            Upload an EPUB first to get started.
          </div>
        )}
      </main>
    </div>
  )
}

function ReaderChapterControl({
  chapterId,
  chapters,
  disabled = false,
  onChapterChange,
}: {
  chapterId: string
  chapters: ChapterMeta[]
  disabled?: boolean
  onChapterChange: (chapterId: string) => void
}) {
  const selectedChapterIndex = chapters.findIndex((chapter) => chapter.chapterId === chapterId)

  return (
    <div className="flex items-center gap-2">
      <label className="text-sm font-medium text-zinc-600">Chapter</label>
      <button
        type="button"
        onClick={() => {
          const prev = chapters[selectedChapterIndex - 1]
          if (prev) onChapterChange(prev.chapterId)
        }}
        disabled={disabled || selectedChapterIndex <= 0}
        className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Prev
      </button>
      <select
        value={chapterId}
        onChange={(event) => onChapterChange(event.target.value)}
        disabled={disabled}
        className="min-w-[260px] rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
      >
        {chapters.map((chapter) => (
          <option key={chapter.chapterId} value={chapter.chapterId}>
            {`Chapter ${chapter.index + 1} - ${chapter.title}`}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => {
          const next = chapters[selectedChapterIndex + 1]
          if (next) onChapterChange(next.chapterId)
        }}
        disabled={disabled || selectedChapterIndex < 0 || selectedChapterIndex >= chapters.length - 1}
        className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Next
      </button>
    </div>
  )
}

function GraphView({
  docId,
  chapterId,
  runId,
  chapters,
  availableRuns,
  loadingRuns,
  onChapterChange,
  onRunChange,
}: {
  docId: string
  chapterId: string
  runId: string
  chapters: ChapterMeta[]
  availableRuns: RunMeta[]
  loadingRuns: boolean
  onChapterChange: (chapterId: string) => void
  onRunChange: (runId: string) => void
}) {
  const selectedChapterIndex = chapters.findIndex((chapter) => chapter.chapterId === chapterId)
  const runExists = availableRuns.some((item) => item.runId === runId)

  return (
    <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-5 p-6">
      <section className="rounded-2xl border border-zinc-200 bg-white p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Graph Controls</p>
            <h2 className="mt-1 text-lg font-semibold text-zinc-900">Current run graph query</h2>
            <p className="mt-1 text-sm text-zinc-500">
              새 저장소 `documents_v2`의 graph projection을 조회합니다. 기존 `documents` 데이터는 legacy 탭에서 확인합니다.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const prev = chapters[selectedChapterIndex - 1]
                if (prev) onChapterChange(prev.chapterId)
              }}
              disabled={selectedChapterIndex <= 0}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
            >
              Prev
            </button>
            <select
              value={chapterId}
              onChange={(event) => onChapterChange(event.target.value)}
              className="min-w-[300px] rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm"
            >
              {chapters.map((chapter) => (
                <option key={chapter.chapterId} value={chapter.chapterId}>
                  {`Chapter ${chapter.index + 1} - ${chapter.title}`}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                const next = chapters[selectedChapterIndex + 1]
                if (next) onChapterChange(next.chapterId)
              }}
              disabled={selectedChapterIndex < 0 || selectedChapterIndex >= chapters.length - 1}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
            >
              Next
            </button>
            <select
              value={runExists ? runId : ""}
              onChange={(event) => {
                if (event.target.value) onRunChange(event.target.value)
              }}
              disabled={loadingRuns || availableRuns.length === 0}
              className="min-w-[320px] rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-sm disabled:opacity-50"
            >
              <option value="">{loadingRuns ? "Loading..." : "Select a saved run"}</option>
              {availableRuns.map((item) => (
                <option key={item.runId} value={item.runId}>
                  {`${item.favorite ? "* " : ""}${item.runId}`}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {runId ? (
        <>
          <BookMemoryPanel
            docId={docId}
            runId={runId}
            currentChapterId={chapterId}
            chapters={chapters}
          />
          <KnowledgeGraphExplorer docId={docId} chapterId={chapterId} runId={runId} />
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-4 py-8 text-center text-sm text-zinc-500">
          Select or create a saved run before querying the knowledge graph.
        </div>
      )}
    </div>
  )
}

function LegacyArchiveView() {
  const [docId, setDocId] = useState("")
  const [chapters, setChapters] = useState<ChapterMeta[]>([])
  const [selectedChapterId, setSelectedChapterId] = useState("")
  const [availableRuns, setAvailableRuns] = useState<RunMeta[]>([])
  const [loadingRuns, setLoadingRuns] = useState(false)
  const [runId, setRunId] = useState("")
  const selectedChapterIndex = chapters.findIndex((chapter) => chapter.chapterId === selectedChapterId)

  useEffect(() => {
    let cancelled = false

    async function loadLegacyRuns() {
      if (!docId || !selectedChapterId) {
        setAvailableRuns([])
        setRunId("")
        return
      }

      setLoadingRuns(true)
      try {
        const runs = await listRuns(docId, selectedChapterId, "legacy")
        if (cancelled) return
        setAvailableRuns(runs)
        setRunId((current) => (runs.some((item) => item.runId === current) ? current : (runs[0]?.runId ?? "")))
      } finally {
        if (!cancelled) setLoadingRuns(false)
      }
    }

    void loadLegacyRuns()
    return () => {
      cancelled = true
    }
  }, [docId, selectedChapterId])

  function handleSelectedLegacy(newDocId: string, newChapters: ChapterMeta[]) {
    setDocId(newDocId)
    setChapters(newChapters)
    setSelectedChapterId(newChapters[0]?.chapterId ?? "")
    setRunId("")
  }

  function handleChapterChange(chapterId: string) {
    setSelectedChapterId(chapterId)
    setAvailableRuns([])
    setRunId("")
  }

  const runSelector = (
    <div className="flex items-center gap-2">
      <label className="text-sm font-medium text-zinc-600">Legacy Run</label>
      <select
        value={runId}
        onChange={(event) => setRunId(event.target.value)}
        disabled={loadingRuns || availableRuns.length === 0}
        className="min-w-[320px] rounded-lg border border-zinc-200 bg-white px-3 py-1.5 font-mono text-sm disabled:cursor-not-allowed disabled:opacity-60"
      >
        <option value="">{loadingRuns ? "Loading..." : "No saved run"}</option>
        {availableRuns.map((item) => (
          <option key={item.runId} value={item.runId}>
            {`${item.favorite ? "* " : ""}${item.runId}`}
          </option>
        ))}
      </select>
    </div>
  )

  return (
    <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-5 p-6">
      <div className="grid gap-5 xl:grid-cols-[minmax(360px,0.8fr)_minmax(0,1.2fr)]">
        <ExistingDocumentsPicker
          source="legacy"
          title="Legacy Documents"
          description="기존 documents 컬렉션에 남아 있는 이전 실행 결과를 읽기 전용으로 엽니다."
          emptyMessage="기존 documents 컬렉션에서 문서를 찾지 못했습니다."
          onSelected={handleSelectedLegacy}
        />

        <section className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-800">Legacy Reader</h2>
              <p className="mt-1 text-xs text-zinc-500">
                새 실행은 documents_v2에 저장되고, 이 화면은 기존 documents 컬렉션을 수정하지 않습니다.
              </p>
            </div>
            <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-500">
              read-only
            </span>
          </div>

          {docId ? (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  const prev = chapters[selectedChapterIndex - 1]
                  if (prev) handleChapterChange(prev.chapterId)
                }}
                disabled={selectedChapterIndex <= 0}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
              >
                Prev
              </button>
              <select
                value={selectedChapterId}
                onChange={(event) => handleChapterChange(event.target.value)}
                className="min-w-[320px] rounded-lg border border-zinc-200 bg-white px-3 py-2 text-base"
              >
                {chapters.map((chapter) => (
                  <option key={chapter.chapterId} value={chapter.chapterId}>
                    {`Chapter ${chapter.index + 1} - ${chapter.title}`}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  const next = chapters[selectedChapterIndex + 1]
                  if (next) handleChapterChange(next.chapterId)
                }}
                disabled={selectedChapterIndex < 0 || selectedChapterIndex >= chapters.length - 1}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
              >
                Next
              </button>
              {runSelector}
            </div>
          ) : (
            <div className="mt-5 rounded-lg border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-400">
              왼쪽에서 legacy 문서를 선택하세요.
            </div>
          )}
        </section>
      </div>

      {docId && selectedChapterId && (
        <ReaderView
          docId={docId}
          chapterId={selectedChapterId}
          runId={runId}
          chapters={chapters}
          loadingRuns={loadingRuns}
          source="legacy"
          onChapterChange={handleChapterChange}
        />
      )}
    </div>
  )
}

function ReaderView({
  docId,
  chapterId,
  runId,
  chapters,
  loadingRuns,
  source,
  extraControls,
  onChapterChange,
}: {
  docId: string
  chapterId: string
  runId: string
  chapters: ChapterMeta[]
  loadingRuns: boolean
  source?: DataSource
  extraControls?: ReactNode
  onChapterChange: (chapterId: string) => void
}) {
  const [final1, setFinal1] = useState<SceneReaderPackageLog | null>(null)
  const [final2, setFinal2] = useState<OverlayRefinementResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [loadedFinal1, loadedFinal2] = await Promise.all([
          loadStageResult<SceneReaderPackageLog>(docId, chapterId, runId, stageKey("FINAL.1"), source),
          loadStageResult<OverlayRefinementResult>(docId, chapterId, runId, stageKey("FINAL.2"), source),
        ])

        if (!loadedFinal1 && !loadedFinal2) {
          setFinal1(null)
          setFinal2(null)
          setError(null)
          return
        }

        setFinal1(loadedFinal1)
        setFinal2(loadedFinal2)
      } catch (loadError: unknown) {
        setError(getErrorMessage(loadError))
      } finally {
        setLoading(false)
      }
    }

    if (docId && chapterId && runId) {
      void load()
      return
    }

    setFinal1(null)
    setFinal2(null)
    setLoading(false)
    setError(null)
  }, [docId, chapterId, runId, source])

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-5 p-6">
        <ReaderChapterControl
          chapterId={chapterId}
          chapters={chapters}
          disabled={loadingRuns}
          onChapterChange={onChapterChange}
        />
        {extraControls}
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-500">
          Loading reader data...
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-5 p-6">
        <ReaderChapterControl
          chapterId={chapterId}
          chapters={chapters}
          disabled={loadingRuns}
          onChapterChange={onChapterChange}
        />
        {extraControls}
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      </div>
    )
  }

  if (!runId) {
    return (
      <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-5 p-6">
        <ReaderChapterControl
          chapterId={chapterId}
          chapters={chapters}
          disabled={loadingRuns}
          onChapterChange={onChapterChange}
        />
        {extraControls}
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-500">
          {loadingRuns ? "Loading reader data..." : "No saved runs for this chapter."}
        </div>
      </div>
    )
  }

  if (!final1) {
    return (
      <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-5 p-6">
        <ReaderChapterControl
          chapterId={chapterId}
          chapters={chapters}
          disabled={loadingRuns}
          onChapterChange={onChapterChange}
        />
        {extraControls}
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-500">
          결과가 없습니다. 실행해주세요.
        </div>
      </div>
    )
  }

  return (
    <ReaderScreen
      final1={final1}
      final2={final2 ?? undefined}
      topControls={(
        <>
          <ReaderChapterControl
            chapterId={chapterId}
            chapters={chapters}
            disabled={loadingRuns}
            onChapterChange={onChapterChange}
          />
          {extraControls}
        </>
      )}
    />
  )
}
