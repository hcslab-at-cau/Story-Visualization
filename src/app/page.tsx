"use client"

import { useEffect, useState } from "react"
import EpubUploader from "@/components/EpubUploader"
import ExistingDocumentsPicker from "@/components/ExistingDocumentsPicker"
import PipelineRunner from "@/components/PipelineRunner"
import ReaderScreen from "@/components/ReaderScreen"
import { listRuns } from "@/lib/firestore"
import { createTimestampRunId } from "@/lib/run-id"
import type { OverlayRefinementResult, SceneReaderPackageLog } from "@/types/schema"
import type { ChapterMeta } from "@/types/ui"

type View = "upload" | "pipeline" | "reader"

export default function Home() {
  const [view, setView] = useState<View>("upload")
  const [docId, setDocId] = useState("")
  const [chapters, setChapters] = useState<ChapterMeta[]>([])
  const [selectedChapterId, setSelectedChapterId] = useState("")
  const [availableRuns, setAvailableRuns] = useState<Array<{ runId: string; updatedAt: unknown }>>([])
  const [loadingRuns, setLoadingRuns] = useState(false)
  const [runId, setRunId] = useState(() => createTimestampRunId())

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

  function handleChapterChange(chapterId: string) {
    setSelectedChapterId(chapterId)
    setRunId(createFreshRunId())
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
              className={`rounded-lg px-3 py-2 text-[15px] capitalize transition-colors ${
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

      <main className="min-h-0 flex-1 overflow-hidden p-6 text-[15px]">
        {view === "upload" && (
          <div className="mx-auto mt-10 grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
            <EpubUploader onUploaded={handleUploaded} />
            <ExistingDocumentsPicker onSelected={handleSelectedExisting} />
          </div>
        )}

        {view === "pipeline" && docId && (
          <div className="flex h-full min-h-0 w-full flex-col gap-5">
            <div className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end">
                <div className="min-w-[340px] xl:w-[420px]">
                  <label className="mb-1 block text-sm text-zinc-500">Chapter</label>
                  <div className="flex gap-2">
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
                      className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-base"
                    >
                      {chapters.map((chapter) => (
                        <option key={chapter.chapterId} value={chapter.chapterId}>
                          {`Chapter ${chapter.index + 1} · ${chapter.title}`}
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
                  </div>
                </div>

                <div className="min-w-0 flex-1">
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
                  </div>
                </div>

                <div className="min-w-[240px] xl:w-[320px]">
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
                          {item.runId}
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
              className="text-[15px] text-zinc-500 underline hover:text-zinc-800"
            >
              View reader screen
            </button>
          </div>
        )}

        {view === "reader" && docId && (
          <ReaderView docId={docId} chapterId={selectedChapterId} runId={runId} />
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

function ReaderView({
  docId,
  chapterId,
  runId,
}: {
  docId: string
  chapterId: string
  runId: string
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
        const { getDb } = await import("@/lib/firebase")
        const { doc, getDoc } = await import("firebase/firestore")
        const db = getDb()
        const snap = await getDoc(doc(db, "documents", docId, "chapters", chapterId, "runs", runId))
        if (!snap.exists()) {
          throw new Error("Run not found")
        }

        const data = snap.data() as Record<string, unknown>
        setFinal1((data.final1 as SceneReaderPackageLog) ?? null)
        setFinal2((data.final2 as OverlayRefinementResult) ?? null)
      } catch (loadError) {
        setError(String(loadError))
      } finally {
        setLoading(false)
      }
    }

    if (docId && chapterId && runId) {
      void load()
    }
  }, [docId, chapterId, runId])

  if (loading) {
    return <div className="mt-20 text-center text-zinc-400">Loading reader data...</div>
  }

  if (error) {
    return <div className="mt-20 text-center text-red-400">{error}</div>
  }

  if (!final1) {
    return <div className="mt-20 text-center text-zinc-400">Run FINAL.1 first to see the reader.</div>
  }

  return <ReaderScreen final1={final1} final2={final2 ?? undefined} />
}
