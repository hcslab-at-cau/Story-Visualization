"use client"

import { useCallback, useEffect, useState } from "react"
import { useUiStrings } from "@/components/LanguageProvider"
import { loadNarrativeGraph } from "@/lib/client-data"
import { READINESS_STRINGS } from "@/lib/readiness-strings"
import type { NarrativeGraphClaim, NarrativeGraphQueryResult } from "@/types/narrative-graph"
import type { SupportContextKind } from "@/types/support-context"

const CLAIM_CLASS: Record<NarrativeGraphClaim["claimType"], string> = {
  state: "border-sky-200 bg-sky-50 text-sky-800",
  event: "border-emerald-200 bg-emerald-50 text-emerald-800",
  relation: "border-amber-200 bg-amber-50 text-amber-800",
  causal: "border-rose-200 bg-rose-50 text-rose-800",
  place: "border-cyan-200 bg-cyan-50 text-cyan-800",
  goal: "border-violet-200 bg-violet-50 text-violet-800",
}

const SUPPORT_KIND_OPTIONS: SupportContextKind[] = [
  "all",
  "snapshot",
  "boundary_delta",
  "causal_bridge",
  "character_focus",
  "relation_delta",
  "reference_repair",
  "spatial_continuity",
  "visual_context",
  "reentry_recap",
]

export default function NarrativeGraphInspector({
  docId,
  chapterId,
  sceneId,
  bookRunId,
}: {
  docId: string
  chapterId: string
  sceneId?: string
  bookRunId?: string
}) {
  const { locale } = useUiStrings()
  const copy = READINESS_STRINGS[locale].nrg
  const [supportKind, setSupportKind] = useState<SupportContextKind>("all")
  const [graph, setGraph] = useState<NarrativeGraphQueryResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!docId || !chapterId) return
    setLoading(true)
    setError(null)
    try {
      const next = await loadNarrativeGraph({
        docId,
        bookRunId,
        chapterId,
        sceneId,
        supportKind,
      })
      setGraph(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setGraph(null)
    } finally {
      setLoading(false)
    }
  }, [bookRunId, chapterId, docId, sceneId, supportKind])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-zinc-400">{copy.eyebrow}</p>
          <h3 className="mt-1 text-lg font-black text-zinc-950">{copy.title}</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500">{copy.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-bold uppercase tracking-wide text-zinc-400">{copy.supportKind}</label>
          <select
            value={supportKind}
            onChange={(event) => setSupportKind(event.target.value as SupportContextKind)}
            className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700"
          >
            {SUPPORT_KIND_OPTIONS.map((option) => (
              <option key={option} value={option}>{option === "all" ? copy.all : option}</option>
            ))}
          </select>
        </div>
      </div>

      {loading && <div className="mt-4 rounded-xl border border-dashed border-zinc-300 px-4 py-3 text-sm text-zinc-500">{copy.loading}</div>}
      {error && <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      {graph && (
        <>
          <div className="mt-5 flex flex-wrap gap-2 text-xs text-zinc-500">
            <span className="rounded-full bg-zinc-100 px-3 py-1">{graph.claims.length} {copy.claims}</span>
            <span className="rounded-full bg-zinc-100 px-3 py-1">{graph.relations.length} {copy.relations}</span>
            <span className="rounded-full bg-zinc-100 px-3 py-1">{copy.total}: {graph.totalClaims} / {graph.totalRelations}</span>
            <span className="rounded-full bg-zinc-100 px-3 py-1">
              {copy.safety}: -{graph.safetyFilter.removedFutureClaimCount} future claims
            </span>
          </div>

          {graph.claims.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-400">
              {copy.empty}
            </div>
          ) : (
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {graph.claims.slice(0, 12).map((claim) => (
                <article key={claim.claimId} className="rounded-xl border border-zinc-200 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${CLAIM_CLASS[claim.claimType]}`}>
                      {claim.claimType}
                    </span>
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-500">
                      {claim.supportLevel}
                    </span>
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-500">
                      conf {claim.confidence.toFixed(2)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-zinc-700">{claim.text}</p>
                  <p className="mt-2 truncate text-xs text-zinc-400">
                    {claim.sceneKey ?? claim.chapterId} · {copy.evidence} {claim.evidenceRefs.length}
                  </p>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}

