"use client"

import type { V3ProgressiveNarrativeMemoryArtifact } from "@/lib/pipeline/v3-narrative-memory-types"

interface Props {
  artifact?: V3ProgressiveNarrativeMemoryArtifact
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

export default function V3ProgressiveMemoryStageView({ artifact, running }: Props) {
  if (!artifact) {
    return (
      <EmptyState
        title={running ? "MEM.2 is running" : "No MEM.2 result yet"}
        body="Run MEM.2 after CAUS.1 to build character, place, object, goal, timeline, and causal memory views."
      />
    )
  }

  return (
    <div className="grid min-h-0 gap-5 2xl:grid-cols-[minmax(0,1fr)_340px]">
      <section className="min-h-0 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">MEM.2</p>
            <h2 className="mt-1 text-lg font-semibold text-zinc-950">Progressive narrative memory</h2>
          </div>
          <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-zinc-600">{artifact.artifact_version}</span>
        </div>
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Characters</p>
            <div className="mt-3 space-y-2">
              {artifact.character_memories.map((item) => (
                <div key={item.character_ref} className="rounded-md bg-zinc-50 p-3">
                  <p className="text-sm font-semibold text-zinc-900">{item.label}</p>
                  <p className="mt-1 text-xs text-zinc-500">{item.appearances.length} appearances / {item.active_goal_refs.length} active goals</p>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Objects</p>
            <div className="mt-3 space-y-2">
              {artifact.object_memories.map((item) => (
                <div key={item.object_ref} className="rounded-md bg-zinc-50 p-3">
                  <p className="text-sm font-semibold text-zinc-900">{item.label}</p>
                  <p className="mt-1 text-xs text-zinc-500">first seen {item.first_seen_event} / {item.linked_event_refs.length} events</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
      <aside className="space-y-3">
        <StatBlock label="Characters" value={String(artifact.memory_stats.characters)} />
        <StatBlock label="Objects" value={String(artifact.memory_stats.objects)} />
        <StatBlock label="Goals" value={String(artifact.memory_stats.goals)} />
        <StatBlock label="Causal edges" value={String(artifact.memory_stats.causal_edges)} />
        <StatBlock label="Timeline" value={String(artifact.memory_stats.timeline_events)} />
      </aside>
    </div>
  )
}
