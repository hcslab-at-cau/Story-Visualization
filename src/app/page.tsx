"use client"

import { useEffect, useState } from "react"
import EpubUploader from "@/components/EpubUploader"
import ExistingDocumentsPicker from "@/components/ExistingDocumentsPicker"
import PipelineRunner from "@/components/PipelineRunner"
import ReaderScreen from "@/components/ReaderScreen"
import {
  deleteRun,
  listRuns,
  loadStageResult,
  setRunFavorite,
  stageKey,
  type RunMeta,
} from "@/lib/firestore"
import { createTimestampRunId } from "@/lib/run-id"
import type { OverlayRefinementResult, SceneReaderPackageLog } from "@/types/schema"
import type { ChapterMeta } from "@/types/ui"

type View = "upload" | "pipeline" | "reader"

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
    async function loadRuns() {
      if (!docId || !selectedChapterId) {
        setAvailableRuns([])
        return
      }

      setLoadingRuns(true)
      try {
        const runs = await listRuns(docId, selectedChapterId)
        setAvailableRuns(runs)
      } finally {
        setLoadingRuns(false)
      }
    }

    void loadRuns()
  }, [docId, selectedChapterId, runId])

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

  const favoriteRuns = availableRuns.filter((item) => item.favorite)
  const currentRunMeta = availableRuns.find((item) => item.runId === runId)
  const currentRunIsSaved = Boolean(currentRunMeta)
  const currentRunFavorite = currentRunMeta?.favorite === true
  const preferredReaderRunId = favoriteRuns[0]?.runId ?? availableRuns[0]?.runId ?? ""

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
          {(["upload", "pipeline", "reader"] as View[]).map((currentView) => (
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
          view === "reader" ? "overflow-y-auto p-0" : "overflow-hidden p-6"
        }`}
      >
        {view === "upload" && (
          <div className="mx-auto mt-10 grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
            <EpubUploader onUploaded={handleUploaded} />
            <ExistingDocumentsPicker onSelected={handleSelectedExisting} />
          </div>
        )}

        {view === "pipeline" && docId && (
          <div className="flex h-full min-h-0 w-full flex-col gap-5">
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

            <div className="min-h-0 min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white p-5">
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
          </div>
        )}

        {view === "reader" && docId && (
          <ReaderView
            docId={docId}
            chapterId={selectedChapterId}
            runId={runId}
            chapters={chapters}
            onChapterChange={handleReaderChapterChange}
          />
        )}

        {view !== "upload" && !docId && (
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
  onChapterChange,
}: {
  chapterId: string
  chapters: ChapterMeta[]
  onChapterChange: (chapterId: string) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-sm font-medium text-zinc-600">Chapter</label>
      <select
        value={chapterId}
        onChange={(event) => onChapterChange(event.target.value)}
        className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm"
      >
        {chapters.map((chapter) => (
          <option key={chapter.chapterId} value={chapter.chapterId}>
            {`Chapter ${chapter.index + 1} - ${chapter.title}`}
          </option>
        ))}
      </select>
    </div>
  )
}

function ReaderView({
  docId,
  chapterId,
  runId,
  chapters,
  onChapterChange,
}: {
  docId: string
  chapterId: string
  runId: string
  chapters: ChapterMeta[]
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
          loadStageResult<SceneReaderPackageLog>(docId, chapterId, runId, stageKey("FINAL.1")),
          loadStageResult<OverlayRefinementResult>(docId, chapterId, runId, stageKey("FINAL.2")),
        ])

        if (!loadedFinal1 && !loadedFinal2) {
          throw new Error("Run not found")
        }

        setFinal1(loadedFinal1)
        setFinal2(loadedFinal2)
      } catch (loadError) {
        setError(String(loadError))
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
  }, [docId, chapterId, runId])

  if (loading) {
    return <div className="mt-20 text-center text-zinc-400">Loading reader data...</div>
  }

  if (error) {
    return <div className="mt-20 text-center text-red-400">{error}</div>
  }

  if (!runId) {
    return (
      <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-5 p-6">
        <ReaderChapterControl
          chapterId={chapterId}
          chapters={chapters}
          onChapterChange={onChapterChange}
        />
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-500">
          No saved runs for this chapter.
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
          onChapterChange={onChapterChange}
        />
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-500">
          Run FINAL.1 first to see the reader.
        </div>
      </div>
    )
  }

  return (
    <ReaderScreen
      final1={final1}
      final2={final2 ?? undefined}
      topControls={(
        <ReaderChapterControl
          chapterId={chapterId}
          chapters={chapters}
          onChapterChange={onChapterChange}
        />
      )}
    />
  )
}
