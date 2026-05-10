"use client"

import { useEffect, useState } from "react"
import { useUiStrings } from "@/components/LanguageProvider"
import {
  loadBookMemory,
  loadKnowledgeGraph,
  loadRunResults,
  stageKey,
} from "@/lib/client-data"
import { VISUALIZATION_STRINGS } from "@/lib/visualization-strings"
import type { BookMemorySnapshot } from "@/types/book-memory"
import type { KnowledgeGraphQueryResult } from "@/types/graph"
import type { RunResults, StageId } from "@/types/schema"

type SupportStageId = Extract<StageId, `SUP.${number}`>

const SUPPORT_STAGES: SupportStageId[] = [
  "SUP.0",
  "SUP.1",
  "SUP.2",
  "SUP.3",
  "SUP.4",
  "SUP.5",
  "SUP.6",
  "SUP.7",
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function artifactFor(results: Partial<RunResults> | null, stageId: SupportStageId): unknown {
  if (!results) return undefined
  return results[stageKey(stageId) as keyof RunResults]
}

function countUnitsInScenes(artifact: unknown, unitField = "units"): number {
  if (!isRecord(artifact)) return 0
  return asArray(artifact.scenes).reduce<number>((sum, scene) => {
    if (!isRecord(scene)) return sum
    return sum + asArray(scene[unitField]).length
  }, 0)
}

function supportStageMetric(
  stageId: SupportStageId,
  artifact: unknown,
  fallback: string,
): string {
  if (!artifact || !isRecord(artifact)) return fallback

  if (stageId === "SUP.0" && isRecord(artifact.memory)) {
    const scenes = asArray(artifact.memory.scenes).length
    const events = asArray(artifact.memory.events).length
    const edges = asArray(artifact.memory.edges).length
    return `${scenes} scenes / ${events} events / ${edges} edges`
  }

  if (stageId === "SUP.1") {
    return `${asArray(artifact.scenes).length} scene contexts`
  }

  if (stageId === "SUP.6") {
    const selected = countUnitsInScenes(artifact, "selected_units")
    const deferred = countUnitsInScenes(artifact, "deferred_units")
    const suppressed = countUnitsInScenes(artifact, "suppressed_units")
    return `${selected} selected / ${deferred} deferred / ${suppressed} suppressed`
  }

  if (stageId === "SUP.7") {
    const packets = asArray(artifact.packets)
    const units = packets.reduce<number>((sum, packet) => {
      if (!isRecord(packet)) return sum
      return sum + asArray(packet.primary_units).length + asArray(packet.overflow_units).length
    }, 0)
    return `${packets.length} packets / ${units} units`
  }

  return `${asArray(artifact.scenes).length} scenes / ${countUnitsInScenes(artifact)} units`
}

function statusClass(ready: boolean): string {
  return ready
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : "border-zinc-200 bg-white text-zinc-500"
}

function productClass(kind: "graph" | "book" | "reader"): string {
  if (kind === "graph") return "from-sky-50 to-cyan-50 border-sky-100"
  if (kind === "book") return "from-amber-50 to-orange-50 border-amber-100"
  return "from-emerald-50 to-teal-50 border-emerald-100"
}

export default function SupportSystemShowcase({
  docId,
  chapterId,
  runId,
}: {
  docId: string
  chapterId: string
  runId: string
}) {
  const { locale, t } = useUiStrings()
  const copy = VISUALIZATION_STRINGS[locale].showcase
  const [results, setResults] = useState<Partial<RunResults> | null>(null)
  const [bookMemory, setBookMemory] = useState<BookMemorySnapshot | null>(null)
  const [graph, setGraph] = useState<KnowledgeGraphQueryResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function loadOverview() {
      if (!docId || !chapterId || !runId) {
        setResults(null)
        setBookMemory(null)
        setGraph(null)
        return
      }

      setLoading(true)
      setError(null)
      try {
        const [runResults, latestBookMemory, graphProjection] = await Promise.all([
          loadRunResults(docId, chapterId, runId),
          loadBookMemory(docId).catch(() => null),
          loadKnowledgeGraph({ docId, chapterId, runId }).catch(() => null),
        ])
        if (cancelled) return
        setResults(runResults as Partial<RunResults>)
        setBookMemory(latestBookMemory)
        setGraph(graphProjection)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadOverview()
    return () => {
      cancelled = true
    }
  }, [chapterId, docId, reloadKey, runId])

  const sup0Ready = Boolean(artifactFor(results, "SUP.0"))
  const sup7Ready = Boolean(artifactFor(results, "SUP.7"))
  const graphReady = Boolean(graph && graph.totalNodes > 0)
  const bookReady = Boolean(bookMemory)

  return (
    <section className="overflow-hidden rounded-3xl border border-zinc-200 bg-[#f7f3ea] shadow-sm">
      <div className="border-b border-zinc-200 bg-[radial-gradient(circle_at_top_left,#fff7d6,transparent_28%),linear-gradient(135deg,#fff,#f7f3ea)] px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-stone-500">{copy.eyebrow}</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-stone-950">{copy.title}</h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-stone-600">{copy.description}</p>
          </div>
          <button
            type="button"
            onClick={() => setReloadKey((current) => current + 1)}
            disabled={loading || !runId}
            className="rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-bold text-stone-700 shadow-sm hover:bg-stone-50 disabled:opacity-50"
          >
            {loading ? copy.loading : copy.refresh}
          </button>
        </div>
        {error && (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {copy.errorPrefix} {error}
          </div>
        )}
        {!runId && (
          <div className="mt-4 rounded-2xl border border-dashed border-stone-300 bg-white/70 px-4 py-3 text-sm text-stone-500">
            {copy.noRun}
          </div>
        )}
      </div>

      <div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(360px,0.8fr)]">
        <div className="rounded-2xl border border-stone-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-black text-stone-950">{copy.supportBranch}</h3>
            <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-500">
              {copy.liveOutputs}
            </span>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
            {SUPPORT_STAGES.map((stageId, index) => {
              const artifact = artifactFor(results, stageId)
              const ready = Boolean(artifact)
              const stageCopy = copy.stages[stageId]
              return (
                <article
                  key={stageId}
                  className={`relative rounded-2xl border p-4 ${statusClass(ready)}`}
                >
                  {index < SUPPORT_STAGES.length - 1 && (
                    <span className="absolute -right-2 top-8 hidden h-px w-4 bg-stone-300 2xl:block" />
                  )}
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-xs font-black">{stageId}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${ready ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-500"}`}>
                      {ready ? copy.complete : copy.missing}
                    </span>
                  </div>
                  <h4 className="mt-3 text-base font-black text-stone-950">{stageCopy.title}</h4>
                  <p className="mt-2 min-h-[54px] text-xs leading-5 text-stone-600">{stageCopy.body}</p>
                  <div className="mt-3 rounded-xl bg-white/80 px-3 py-2">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{stageCopy.output}</p>
                    <p className="mt-1 text-xs font-semibold text-stone-700">
                      {ready ? supportStageMetric(stageId, artifact, copy.stageMetricFallback) : "-"}
                    </p>
                  </div>
                  <p className="mt-2 text-[11px] text-stone-400">{t.stageNames[stageId]}</p>
                </article>
              )
            })}
          </div>
        </div>

        <div className="grid gap-4">
          <h3 className="text-base font-black text-stone-950">{copy.dataProducts}</h3>
          <ProductCard
            kind="graph"
            title={copy.graphProduct}
            body={copy.graphProductBody}
            status={graphReady ? `${graph?.totalNodes ?? 0} nodes / ${graph?.totalEdges ?? 0} edges` : copy.noBookMemory.replace("BOOK.0", copy.graphProjection)}
            ready={graphReady}
            readyLabel={copy.complete}
            pendingLabel={copy.missing}
          />
          <ProductCard
            kind="book"
            title={copy.bookProduct}
            body={copy.bookProductBody}
            status={bookReady ? `${bookMemory?.sceneRefs.length ?? 0} scenes / ${bookMemory?.edges.length ?? 0} edges / ${bookMemory?.entityThreads.length ?? 0} threads` : copy.noBookMemory}
            ready={bookReady}
            readyLabel={copy.complete}
            pendingLabel={copy.missing}
          />
          <ProductCard
            kind="reader"
            title={copy.readerProduct}
            body={copy.readerProductBody}
            status={sup7Ready ? copy.complete : sup0Ready ? `${copy.missing}: SUP.7` : `${copy.missing}: SUP.0`}
            ready={sup7Ready}
            readyLabel={copy.complete}
            pendingLabel={copy.missing}
          />
        </div>
      </div>
    </section>
  )
}

function ProductCard({
  kind,
  title,
  body,
  status,
  ready,
  readyLabel,
  pendingLabel,
}: {
  kind: "graph" | "book" | "reader"
  title: string
  body: string
  status: string
  ready: boolean
  readyLabel: string
  pendingLabel: string
}) {
  return (
    <article className={`rounded-2xl border bg-gradient-to-br p-4 ${productClass(kind)}`}>
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-base font-black text-stone-950">{title}</h4>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${ready ? "bg-white text-emerald-700" : "bg-white/70 text-stone-500"}`}>
          {ready ? readyLabel : pendingLabel}
        </span>
      </div>
      <p className="mt-2 text-sm leading-6 text-stone-600">{body}</p>
      <p className="mt-3 rounded-xl bg-white/80 px-3 py-2 font-mono text-xs font-semibold text-stone-700">
        {status}
      </p>
    </article>
  )
}
