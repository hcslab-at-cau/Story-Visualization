"use client"

import { useCallback, useEffect, useState } from "react"
import { useUiStrings } from "@/components/LanguageProvider"
import { loadRunReadiness, rebuildKnowledgeGraph } from "@/lib/client-data"
import { READINESS_STRINGS } from "@/lib/readiness-strings"
import type { ReadinessStatus, RunReadinessReport } from "@/types/readiness"

const STATUS_CLASS: Record<ReadinessStatus, string> = {
  ready: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  missing: "border-rose-200 bg-rose-50 text-rose-800",
  unknown: "border-zinc-200 bg-zinc-50 text-zinc-700",
}

export default function RunReadinessPanel({
  docId,
  chapterId,
  runId,
  onRunChange,
}: {
  docId: string
  chapterId: string
  runId: string
  onRunChange?: (runId: string) => void
}) {
  const { locale } = useUiStrings()
  const copy = READINESS_STRINGS[locale].panel
  const [report, setReport] = useState<RunReadinessReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!docId || !chapterId || !runId) return
    setLoading(true)
    setError(null)
    try {
      const next = await loadRunReadiness({ docId, chapterId, runId })
      setReport(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [chapterId, docId, runId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function handleRebuildProjection() {
    if (!docId || !chapterId || !runId) return
    setRebuilding(true)
    setError(null)
    try {
      await rebuildKnowledgeGraph(docId, chapterId, runId)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRebuilding(false)
    }
  }

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-zinc-400">{copy.eyebrow}</p>
          <h3 className="mt-1 text-lg font-black text-zinc-950">{copy.title}</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500">{copy.description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading || rebuilding}
            className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
          >
            {loading ? copy.loading : copy.refresh}
          </button>
          <button
            type="button"
            onClick={() => void handleRebuildProjection()}
            disabled={loading || rebuilding || !runId}
            className="rounded-xl bg-zinc-900 px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-40"
          >
            {rebuilding ? "Rebuilding..." : "Projection rebuild"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {copy.error} {error}
        </div>
      )}

      {report && (
        <>
          <div className="mt-5 grid gap-3 md:grid-cols-4">
            <div className="rounded-xl bg-zinc-50 p-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-zinc-400">{copy.selectedRun}</p>
              <p className="mt-1 truncate font-mono text-xs text-zinc-700">{report.selectedRunId}</p>
            </div>
            <div className="rounded-xl bg-zinc-50 p-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-zinc-400">{copy.effectiveRun}</p>
              <p className="mt-1 truncate font-mono text-xs text-zinc-700">{report.reader.effectiveRunId}</p>
            </div>
            <div className="rounded-xl bg-zinc-50 p-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-zinc-400">{copy.bookRun}</p>
              <p className="mt-1 truncate font-mono text-xs text-zinc-700">{report.bookMemory.bookRunId ?? "-"}</p>
            </div>
            <div className="rounded-xl bg-zinc-50 p-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-zinc-400">{copy.graph}</p>
              <p className="mt-1 text-sm font-semibold text-zinc-800">
                {report.graph.totalNodes} nodes / {report.graph.totalEdges} edges
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {report.checks.map((item) => (
              <article key={item.id} className="rounded-xl border border-zinc-200 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${STATUS_CLASS[item.status]}`}>
                    {copy.statusLabels[item.status]}
                  </span>
                  <h4 className="text-sm font-bold text-zinc-900">{item.label}</h4>
                </div>
                <p className="mt-2 text-sm leading-6 text-zinc-600">{item.detail}</p>
                {item.action && <p className="mt-2 text-xs font-semibold text-zinc-500">{item.action}</p>}
                {item.id === "book-run-match" && report.bookMemory.chapterRunId && report.bookMemory.chapterRunId !== runId && onRunChange && (
                  <button
                    type="button"
                    onClick={() => onRunChange(report.bookMemory.chapterRunId as string)}
                    className="mt-3 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
                  >
                    Switch to BOOK.0 run
                  </button>
                )}
              </article>
            ))}
          </div>

          <div className="mt-5 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
            <p className="text-sm font-bold text-zinc-900">{copy.recommendations}</p>
            {report.recommendations.length > 0 ? (
              <ul className="mt-2 space-y-1 text-sm leading-6 text-zinc-600">
                {report.recommendations.map((item) => <li key={item}>{item}</li>)}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-zinc-500">{copy.noRecommendations}</p>
            )}
          </div>
        </>
      )}
    </section>
  )
}

