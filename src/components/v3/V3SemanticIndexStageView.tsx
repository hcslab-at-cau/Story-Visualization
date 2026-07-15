"use client"

import type { V3SemanticIndexArtifact } from "@/lib/pipeline/v3-semantic-index-types"

interface Props {
  artifact?: V3SemanticIndexArtifact
  running?: boolean
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-zinc-950">{value}</p>
      {detail ? <p className="mt-1 text-xs text-zinc-500">{detail}</p> : null}
    </div>
  )
}

export default function V3SemanticIndexStageView({ artifact, running }: Props) {
  if (!artifact) {
    return (
      <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-10 text-center">
        <div>
          <h3 className="text-sm font-semibold text-zinc-800">{running ? "IDX.2 is running" : "No IDX.2 result yet"}</h3>
          <p className="mt-2 max-w-md text-sm leading-6 text-zinc-500">
            Run IDX.2 after IDX.1 to embed retrieval documents for hybrid semantic search.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="grid min-h-0 gap-5 2xl:grid-cols-[minmax(0,1fr)_340px]">
      <section className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">IDX.2</p>
            <h2 className="mt-1 text-lg font-semibold text-zinc-950">Semantic vector index</h2>
          </div>
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">Ready</span>
        </div>

        <dl className="mt-4 divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white px-4">
          <div className="grid gap-1 py-3 sm:grid-cols-[160px_minmax(0,1fr)]">
            <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Model</dt>
            <dd className="break-all font-mono text-sm text-zinc-800">{artifact.embedding_model}</dd>
          </div>
          <div className="grid gap-1 py-3 sm:grid-cols-[160px_minmax(0,1fr)]">
            <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Storage</dt>
            <dd className="break-all font-mono text-xs leading-5 text-zinc-700">{artifact.vector_blob.storage_path}</dd>
          </div>
          <div className="grid gap-1 py-3 sm:grid-cols-[160px_minmax(0,1fr)]">
            <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Source fingerprint</dt>
            <dd className="break-all font-mono text-xs leading-5 text-zinc-700">{artifact.source_text_fingerprint}</dd>
          </div>
          <div className="grid gap-1 py-3 sm:grid-cols-[160px_minmax(0,1fr)]">
            <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Blob hash</dt>
            <dd className="break-all font-mono text-xs leading-5 text-zinc-700">{artifact.vector_blob.content_hash}</dd>
          </div>
        </dl>
      </section>

      <aside className="space-y-3">
        <Stat label="Vectors" value={artifact.vector_stats.vectors.toLocaleString()} />
        <Stat label="Dimensions" value={artifact.vector_stats.dimensions.toLocaleString()} />
        <Stat label="Stored size" value={formatBytes(artifact.vector_blob.size_bytes)} detail="gzip-compressed" />
        <Stat label="Input tokens" value={artifact.vector_stats.prompt_tokens.toLocaleString()} />
      </aside>
    </div>
  )
}
