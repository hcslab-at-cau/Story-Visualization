"use client"

import { useMemo } from "react"
import type { V3MemoryContractArtifact, V3MemoryDiagnosticSeverity } from "@/lib/pipeline/v3-memory-contract-types"
import type { PreparedChapter } from "@/types/schema"

interface Props {
  preparedChapter: PreparedChapter
  artifact?: V3MemoryContractArtifact
  running?: boolean
}

const SEVERITY_CLASS: Record<V3MemoryDiagnosticSeverity, string> = {
  info: "bg-zinc-100 text-zinc-700",
  warning: "bg-amber-50 text-amber-800",
  error: "bg-red-50 text-red-700",
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

function paragraphText(preparedChapter: PreparedChapter, startPid: number, endPid: number): string {
  return preparedChapter.raw_chapter.paragraphs
    .filter((paragraph) => paragraph.pid >= startPid && paragraph.pid <= endPid)
    .map((paragraph) => paragraph.text)
    .join(" ")
}

export default function V3MemoryContractStageView({
  preparedChapter,
  artifact,
  running,
}: Props) {
  const diagnosticsBySeverity = useMemo(() => {
    const counts: Record<V3MemoryDiagnosticSeverity, number> = { info: 0, warning: 0, error: 0 }
    for (const item of artifact?.diagnostics ?? []) counts[item.severity] += 1
    return counts
  }, [artifact?.diagnostics])

  if (!artifact) {
    return (
      <EmptyState
        title={running ? "MEM.0 is running" : "No MEM.0 result yet"}
        body="Run MEM.0 after SCENE.0 to validate event-scene membership and freeze a stable narrative memory contract."
      />
    )
  }

  return (
    <div className="grid min-h-0 gap-5 2xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="min-h-0 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">MEM.0</p>
            <h2 className="mt-1 text-lg font-semibold text-zinc-950">Narrative memory contract</h2>
          </div>
          <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-zinc-600">
            {artifact.artifact_version}
          </span>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Scenes</p>
            <div className="mt-3 max-h-[58vh] space-y-3 overflow-y-auto pr-1">
              {artifact.scenes.map((scene) => (
                <article key={scene.scene_id} className="rounded-lg border border-zinc-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-mono text-xs font-semibold text-zinc-500">{scene.scene_id}</p>
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600">
                      {scene.event_ids.length} events
                    </span>
                  </div>
                  <h3 className="mt-2 text-sm font-semibold text-zinc-900">{scene.summary}</h3>
                  <p className="mt-1 line-clamp-3 text-xs leading-5 text-zinc-500">
                    {paragraphText(preparedChapter, scene.text_span.start_pid, scene.text_span.end_pid)}
                  </p>
                </article>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Events</p>
            <div className="mt-3 max-h-[58vh] space-y-3 overflow-y-auto pr-1">
              {artifact.events.map((event) => (
                <article key={event.event_id} className="rounded-lg border border-zinc-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-mono text-xs font-semibold text-zinc-500">{event.event_id}</p>
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600">
                      {event.scene_id ?? "no scene"}
                    </span>
                  </div>
                  <h3 className="mt-2 text-sm font-semibold text-zinc-900">{event.summary}</h3>
                  <p className="mt-2 text-xs leading-5 text-zinc-500">
                    core evidence {event.evidence_refs.length} / context {event.context_evidence_refs.length} / dropped {event.dropped_evidence_refs.length}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <aside className="space-y-3">
        <div className="grid grid-cols-3 gap-2 2xl:grid-cols-1">
          <StatBlock label="Events" value={String(artifact.contract_stats.events_total)} detail={`${artifact.contract_stats.events_assigned} assigned`} />
          <StatBlock label="Scenes" value={String(artifact.contract_stats.scenes_total)} detail={`${artifact.contract_stats.scenes_without_events} empty`} />
          <StatBlock label="Diagnostics" value={String(artifact.contract_stats.diagnostics_total)} detail={`${diagnosticsBySeverity.error} errors`} />
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Axis cleanup</p>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Support refs moved</dt>
              <dd className="font-mono text-zinc-800">{artifact.contract_stats.support_axis_refs}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Drop refs removed</dt>
              <dd className="font-mono text-zinc-800">{artifact.contract_stats.drop_axis_refs}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Missing refs</dt>
              <dd className="font-mono text-zinc-800">{artifact.contract_stats.missing_occurrence_refs}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Diagnostics</p>
          <div className="mt-3 max-h-[44vh] space-y-2 overflow-y-auto pr-1">
            {artifact.diagnostics.length === 0 ? (
              <p className="text-sm text-zinc-500">No contract diagnostics.</p>
            ) : artifact.diagnostics.map((item, index) => (
              <div key={`${item.code}-${item.ref_id ?? index}`} className="rounded-lg border border-zinc-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SEVERITY_CLASS[item.severity]}`}>
                    {item.severity}
                  </span>
                  <span className="font-mono text-[11px] text-zinc-500">{item.code}</span>
                </div>
                <p className="mt-2 text-xs leading-5 text-zinc-600">{item.message}</p>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  )
}
