"use client"

import { useState } from "react"
import EpubUploader from "@/components/EpubUploader"
import PipelineRunner from "@/components/PipelineRunner"
import type { ChapterMeta } from "@/types/ui"

type View = "upload" | "pipeline" | "reader"

export default function Home() {
  const [view, setView] = useState<View>("upload")
  const [docId, setDocId] = useState("")
  const [chapters, setChapters] = useState<ChapterMeta[]>([])
  const [selectedChapterId, setSelectedChapterId] = useState("")

  // Run ID (timestamp-based)
  const [runId, setRunId] = useState(() => `run_${Date.now()}`)

  function handleUploaded(newDocId: string, newChapters: ChapterMeta[]) {
    setDocId(newDocId)
    setChapters(newChapters)
    setSelectedChapterId(newChapters[0]?.chapterId ?? "")
    setRunId(`run_${Date.now()}`)
    setView("pipeline")
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white px-6 py-4 flex items-center gap-6">
        <h1 className="text-base font-semibold text-zinc-900">Story Visualization</h1>
        <nav className="flex gap-1">
          {(["upload", "pipeline", "reader"] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 text-sm rounded-lg capitalize transition-colors ${
                view === v ? "bg-zinc-900 text-white" : "text-zinc-500 hover:text-zinc-700"
              }`}
            >
              {v}
            </button>
          ))}
        </nav>
      </header>

      {/* Content */}
      <main className="flex-1 p-6">
        {view === "upload" && (
          <div className="max-w-2xl mx-auto mt-12">
            <EpubUploader onUploaded={handleUploaded} />
          </div>
        )}

        {view === "pipeline" && docId && (
          <div className="max-w-3xl mx-auto space-y-5">
            <div className="bg-white rounded-xl border border-zinc-200 p-5 space-y-4">
              <div className="flex items-center gap-4">
                <div>
                  <label className="text-xs text-zinc-500 block mb-1">Chapter</label>
                  <select
                    value={selectedChapterId}
                    onChange={(e) => {
                      setSelectedChapterId(e.target.value)
                      setRunId(`run_${Date.now()}`)
                    }}
                    className="border border-zinc-200 rounded-lg px-3 py-1.5 text-sm bg-white"
                  >
                    {chapters.map((ch) => (
                      <option key={ch.chapterId} value={ch.chapterId}>
                        {ch.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-xs text-zinc-500 block mb-1">Run ID</label>
                  <div className="flex gap-2">
                    <input
                      value={runId}
                      onChange={(e) => setRunId(e.target.value)}
                      className="flex-1 border border-zinc-200 rounded-lg px-3 py-1.5 text-sm font-mono"
                    />
                    <button
                      onClick={() => setRunId(`run_${Date.now()}`)}
                      className="px-3 py-1.5 text-xs border border-zinc-200 rounded-lg hover:bg-zinc-50"
                    >
                      New
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-zinc-200 p-5">
              <PipelineRunner
                docId={docId}
                chapterId={selectedChapterId}
                runId={runId}
              />
            </div>

            <button
              onClick={() => setView("reader")}
              className="text-sm text-zinc-500 hover:text-zinc-800 underline"
            >
              View reader screen →
            </button>
          </div>
        )}

        {view === "reader" && docId && (
          <ReaderView
            docId={docId}
            chapterId={selectedChapterId}
            runId={runId}
          />
        )}

        {view !== "upload" && !docId && (
          <div className="text-center text-zinc-400 mt-20">
            Upload an EPUB first to get started.
          </div>
        )}
      </main>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Reader view (lazy-loads FINAL.1 + FINAL.2 from Firestore)
// ---------------------------------------------------------------------------

import { useEffect } from "react"
import ReaderScreen from "@/components/ReaderScreen"
import type { SceneReaderPackageLog, OverlayRefinementResult } from "@/types/schema"

function ReaderView({ docId, chapterId, runId }: { docId: string; chapterId: string; runId: string }) {
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
        if (!snap.exists()) throw new Error("Run not found")
        const data = snap.data() as Record<string, unknown>
        setFinal1((data.final1 as SceneReaderPackageLog) ?? null)
        setFinal2((data.final2 as OverlayRefinementResult) ?? null)
      } catch (e) {
        setError(String(e))
      } finally {
        setLoading(false)
      }
    }
    if (docId && chapterId && runId) load()
  }, [docId, chapterId, runId])

  if (loading) return <div className="text-center text-zinc-400 mt-20">Loading reader data...</div>
  if (error) return <div className="text-center text-red-400 mt-20">{error}</div>
  if (!final1) return <div className="text-center text-zinc-400 mt-20">Run FINAL.1 first to see the reader.</div>

  return <ReaderScreen final1={final1} final2={final2 ?? undefined} />
}
