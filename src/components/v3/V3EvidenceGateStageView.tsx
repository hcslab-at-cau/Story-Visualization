"use client"

import { useMemo, useState } from "react"
import V3BodyResultView, {
  type V3BodyHighlight,
  type V3BodySideItem,
} from "@/components/v3/V3BodyResultView"
import type { V3EvidenceCandidateType } from "@/lib/pipeline/v3-evidence-types"
import type {
  V3EvidenceGate,
  V3EvidenceGateArtifact,
} from "@/lib/pipeline/v3-evidence-gate-types"
import { isV3EvidenceGateArtifact } from "@/lib/pipeline/v3-evidence-gate-types"
import type { V3EvidenceRefinementArtifact } from "@/lib/pipeline/v3-evidence-refinement-types"
import type { PreparedChapter } from "@/types/schema"

const TYPE_LABELS: Record<V3EvidenceCandidateType, string> = {
  cast: "CAST",
  place: "PLACE",
  time: "TIME",
  object: "OBJECT",
  action: "ACTION",
  goal: "GOAL",
  causality: "CAUSAL",
}

const GATE_LABELS: Record<V3EvidenceGate, string> = {
  core: "Core",
  support: "Support",
  drop: "Drop",
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-10 text-center">
      <div>
        <h3 className="text-sm font-semibold text-zinc-800">{title}</h3>
        <p className="mt-2 max-w-md text-sm leading-6 text-zinc-500">{body}</p>
      </div>
    </div>
  )
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-zinc-950">{value}</p>
    </div>
  )
}

export default function V3EvidenceGateStageView({
  preparedChapter,
  artifact,
  evidenceRefinement,
  running,
}: {
  preparedChapter: PreparedChapter
  artifact?: V3EvidenceGateArtifact
  evidenceRefinement?: V3EvidenceRefinementArtifact
  running?: boolean
}) {
  const [gateFilter, setGateFilter] = useState<V3EvidenceGate | "all">("all")
  const gateArtifact = isV3EvidenceGateArtifact(artifact) ? artifact : undefined
  const candidateById = useMemo(
    () => new Map((evidenceRefinement?.refined_candidates ?? []).map((candidate) => [
      candidate.refined_candidate_id,
      candidate,
    ])),
    [evidenceRefinement?.refined_candidates],
  )
  const gatedCandidates = useMemo(() => gateArtifact?.gated_candidates ?? [], [gateArtifact?.gated_candidates])
  const visibleGatedCandidates = useMemo(
    () => gatedCandidates.filter((candidate) => gateFilter === "all" || candidate.gate === gateFilter),
    [gateFilter, gatedCandidates],
  )
  const bodyHighlights = useMemo<V3BodyHighlight[]>(
    () => visibleGatedCandidates.flatMap((gate) => {
      const candidate = candidateById.get(gate.refined_candidate_id)
      if (!candidate) return []
      return [{
        id: gate.refined_candidate_id,
        pid: candidate.pid,
        startChar: candidate.start_char,
        endChar: candidate.end_char,
        label: candidate.span,
        tone: candidate.candidate_type,
        title: `${TYPE_LABELS[candidate.candidate_type]} / ${GATE_LABELS[gate.gate]} / ${candidate.span}`,
      }]
    }),
    [candidateById, visibleGatedCandidates],
  )
  const bodySideItems = useMemo<V3BodySideItem[]>(
    () => visibleGatedCandidates.flatMap((gate) => {
      const candidate = candidateById.get(gate.refined_candidate_id)
      if (!candidate) return []
      return [{
        id: gate.refined_candidate_id,
        pid: candidate.pid,
        title: candidate.span,
        label: TYPE_LABELS[candidate.candidate_type],
        tone: candidate.candidate_type,
        detail: gate.rationale ?? gate.basis,
        meta: [GATE_LABELS[gate.gate], gate.basis],
      }]
    }),
    [candidateById, visibleGatedCandidates],
  )

  if (!gateArtifact) {
    return (
      <EmptyState
        title={running ? "EVID.3 is running" : "No EVID.3 result yet"}
        body="Run EVID.3 after EVID.2 to gate candidates into core, support, and drop before entity clustering."
      />
    )
  }

  return (
    <div className="grid min-h-0 gap-5 2xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="min-h-0 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">EVID.3</p>
            <h2 className="mt-1 text-lg font-semibold text-zinc-950">Candidate gate on text</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {(["all", "core", "support", "drop"] as const).map((gate) => (
              <button
                key={gate}
                type="button"
                onClick={() => setGateFilter(gate)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                  gateFilter === gate ? "bg-zinc-900 text-white" : "bg-white text-zinc-600 hover:bg-zinc-100"
                }`}
              >
                {gate === "all" ? "All" : GATE_LABELS[gate]}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 max-h-[68vh] overflow-y-auto pr-1">
          <V3BodyResultView
            paragraphs={preparedChapter.raw_chapter.paragraphs}
            highlights={bodyHighlights}
            sideItems={bodySideItems}
            emptyTitle="No gated candidates match this filter."
            emptyBody="Switch the gate filter or rerun EVID.3 to inspect candidate gating on the source text."
          />
        </div>
      </section>

      <aside className="space-y-3">
        <div className="grid grid-cols-3 gap-2 2xl:grid-cols-1">
          <StatBlock label="Core" value={String(gateArtifact.gate_stats.core_candidates)} />
          <StatBlock label="Support" value={String(gateArtifact.gate_stats.support_candidates)} />
          <StatBlock label="Drop" value={String(gateArtifact.gate_stats.dropped_candidates)} />
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Candidates by type</p>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            {(["cast", "place", "time", "object", "action", "goal", "causality"] as V3EvidenceCandidateType[]).map((type) => (
              <div key={type} className="flex items-center justify-between gap-3 rounded-md bg-zinc-50 px-3 py-2">
                <dt className="font-medium uppercase text-zinc-600">{type}</dt>
                <dd className="font-mono text-zinc-900">{gateArtifact.gate_stats.by_type[type] ?? 0}</dd>
              </div>
            ))}
          </dl>
        </div>
      </aside>
    </div>
  )
}
