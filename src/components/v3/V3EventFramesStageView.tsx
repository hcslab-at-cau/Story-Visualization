"use client"

import type { V3EventFramesArtifact } from "@/lib/pipeline/v3-memory-frames-types"

interface Props {
  artifact?: V3EventFramesArtifact
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

export default function V3EventFramesStageView({ artifact, running }: Props) {
  if (!artifact) {
    return (
      <EmptyState
        title={running ? "EVENT.2 is running" : "No EVENT.2 result yet"}
        body="Run EVENT.2 after MEM.1 to normalize event candidates into predicate-argument frames."
      />
    )
  }

  return (
    <div className="grid min-h-0 gap-5 2xl:grid-cols-[minmax(0,1fr)_340px]">
      <section className="min-h-0 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">EVENT.2</p>
            <h2 className="mt-1 text-lg font-semibold text-zinc-950">Event argument frames</h2>
          </div>
          <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-zinc-600">
            {artifact.artifact_version}
          </span>
        </div>

        <div className="mt-4 max-h-[68vh] space-y-3 overflow-y-auto pr-1">
          {artifact.event_frames.map((frame) => (
            <article key={frame.event_id} className="rounded-lg border border-zinc-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-mono text-xs font-semibold text-zinc-500">{frame.event_id}</p>
                  {frame.scene_id && (
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600">
                      {frame.scene_id}
                    </span>
                  )}
                </div>
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                  {frame.event_type}
                </span>
              </div>
              <h3 className="mt-2 text-sm font-semibold text-zinc-950">{frame.predicate}</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {frame.arguments.length === 0 ? (
                  <span className="rounded-full bg-zinc-100 px-2 py-1 text-xs text-zinc-500">no arguments</span>
                ) : frame.arguments.map((argument) => (
                  <span
                    key={`${frame.event_id}-${argument.role}-${argument.evidence_ref}`}
                    className="rounded-full bg-zinc-100 px-2 py-1 text-xs text-zinc-700"
                    title={argument.role_basis}
                  >
                    <span className="font-semibold">{argument.role}</span>: {argument.label}
                  </span>
                ))}
              </div>
              <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                <div className="rounded-md bg-zinc-50 p-2">
                  <dt className="font-semibold uppercase tracking-wide text-zinc-400">Goals</dt>
                  <dd className="mt-1 font-mono text-zinc-700">{frame.goal_cue_refs.length}</dd>
                </div>
                <div className="rounded-md bg-zinc-50 p-2">
                  <dt className="font-semibold uppercase tracking-wide text-zinc-400">Causal</dt>
                  <dd className="mt-1 font-mono text-zinc-700">{frame.causal_cue_refs.length}</dd>
                </div>
                <div className="rounded-md bg-zinc-50 p-2">
                  <dt className="font-semibold uppercase tracking-wide text-zinc-400">Evidence</dt>
                  <dd className="mt-1 font-mono text-zinc-700">{frame.evidence_refs.length}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </section>

      <aside className="space-y-3">
        <StatBlock label="Frames" value={String(artifact.frame_stats.event_frames)} detail={`${artifact.frame_stats.input_events} input events`} />
        <StatBlock label="With trigger" value={String(artifact.frame_stats.frames_with_trigger)} />
        <StatBlock label="Arguments" value={String(artifact.frame_stats.arguments_total)} />
      </aside>
    </div>
  )
}
