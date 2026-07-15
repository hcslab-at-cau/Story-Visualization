"use client"

import type { V3RetrievalIndexArtifact } from "@/lib/pipeline/v3-narrative-memory-types"

interface Props {
  artifact?: V3RetrievalIndexArtifact
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

export default function V3RetrievalIndexStageView({ artifact, running }: Props) {
  if (!artifact) {
    return (
      <EmptyState
        title={running ? "IDX.1 is running" : "No IDX.1 result yet"}
        body="Run IDX.1 after MEM.2 to build structured records, graph edges, and text retrieval documents."
      />
    )
  }

  const previewRecords = artifact.structured_records.slice(0, 30)

  return (
    <div className="grid min-h-0 gap-5 2xl:grid-cols-[minmax(0,1fr)_340px]">
      <section className="min-h-0 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">IDX.1</p>
            <h2 className="mt-1 text-lg font-semibold text-zinc-950">Retrieval index</h2>
          </div>
          <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-zinc-600">{artifact.artifact_version}</span>
        </div>
        <div className="mt-4 max-h-[68vh] space-y-2 overflow-y-auto pr-1">
          {previewRecords.map((record) => (
            <article key={`${record.record_type}-${record.record_id}`} className="rounded-lg border border-zinc-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600">{record.record_type}</span>
                <p className="font-mono text-[11px] text-zinc-500">{record.record_id}</p>
              </div>
              <h3 className="mt-2 text-sm font-semibold text-zinc-950">{record.label}</h3>
              <p className="mt-1 text-xs text-zinc-500">scene {record.scene_id ?? "-"} / event {record.event_id ?? "-"}</p>
            </article>
          ))}
        </div>
      </section>
      <aside className="space-y-3">
        <StatBlock label="Records" value={String(artifact.index_stats.structured_records)} />
        <StatBlock label="Graph edges" value={String(artifact.index_stats.graph_edges)} />
        <StatBlock label="Text docs" value={String(artifact.index_stats.text_documents)} />
      </aside>
    </div>
  )
}
