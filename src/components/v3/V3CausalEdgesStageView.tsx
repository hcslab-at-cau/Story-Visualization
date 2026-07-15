"use client"

import type { V3CausalEdgesArtifact } from "@/lib/pipeline/v3-narrative-memory-types"

interface Props {
  artifact?: V3CausalEdgesArtifact
  running?: boolean
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

function StatBlock({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-zinc-950">{value}</p>
      {detail && <p className="mt-1 text-xs text-zinc-500">{detail}</p>}
    </div>
  )
}

export default function V3CausalEdgesStageView({ artifact, running }: Props) {
  if (!artifact) {
    return (
      <EmptyState
        title={running ? "CAUS.1 is running" : "No CAUS.1 result yet"}
        body="Run CAUS.1 after GOAL.1 to create explicit event-event causal edge candidates."
      />
    )
  }

  return (
    <div className="grid min-h-0 gap-5 2xl:grid-cols-[minmax(0,1fr)_340px]">
      <section className="min-h-0 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">CAUS.1</p>
            <h2 className="mt-1 text-lg font-semibold text-zinc-950">Causal edge candidates</h2>
          </div>
          <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-zinc-600">{artifact.artifact_version}</span>
        </div>
        <div className="mt-4 max-h-[68vh] space-y-3 overflow-y-auto pr-1">
          {artifact.causal_edges.map((edge) => (
            <article key={edge.edge_id} className="rounded-lg border border-zinc-200 bg-white p-4">
              <p className="font-mono text-xs font-semibold text-zinc-500">{edge.edge_id}</p>
              <h3 className="mt-2 text-sm font-semibold text-zinc-950">
                {edge.from_event} {"->"} {edge.to_event}
              </h3>
              <p className="mt-2 text-xs text-zinc-500">{edge.relation_type} / {edge.explicitness} / evidence {edge.evidence_refs.join(", ")}</p>
            </article>
          ))}
          {artifact.unresolved_cues.map((cue) => (
            <article key={cue.cue_ref} className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="font-mono text-xs font-semibold text-amber-700">{cue.cue_ref}</p>
              <p className="mt-2 text-xs leading-5 text-amber-800">unresolved: {cue.reason}</p>
            </article>
          ))}
        </div>
      </section>
      <aside className="space-y-3">
        <StatBlock label="Edges" value={String(artifact.causal_stats.causal_edges)} detail={`${artifact.causal_stats.input_causal_cues} cues`} />
        <StatBlock label="Unresolved" value={String(artifact.causal_stats.unresolved_cues)} />
      </aside>
    </div>
  )
}
