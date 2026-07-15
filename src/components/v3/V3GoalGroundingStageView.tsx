"use client"

import type { V3GoalGroundingArtifact } from "@/lib/pipeline/v3-narrative-memory-types"

interface Props {
  artifact?: V3GoalGroundingArtifact
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

export default function V3GoalGroundingStageView({ artifact, running }: Props) {
  if (!artifact) {
    return (
      <EmptyState
        title={running ? "GOAL.1 is running" : "No GOAL.1 result yet"}
        body="Run GOAL.1 after EVENT.2 to ground goal cues to holders, events, and scenes."
      />
    )
  }

  return (
    <div className="grid min-h-0 gap-5 2xl:grid-cols-[minmax(0,1fr)_340px]">
      <section className="min-h-0 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">GOAL.1</p>
            <h2 className="mt-1 text-lg font-semibold text-zinc-950">Goal grounding</h2>
          </div>
          <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-zinc-600">{artifact.artifact_version}</span>
        </div>
        <div className="mt-4 max-h-[68vh] space-y-3 overflow-y-auto pr-1">
          {artifact.grounded_goals.map((goal) => (
            <article key={goal.goal_id} className="rounded-lg border border-zinc-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-mono text-xs font-semibold text-zinc-500">{goal.goal_id}</p>
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600">{goal.status_for_now}</span>
              </div>
              <h3 className="mt-2 text-sm font-semibold text-zinc-950">{goal.content}</h3>
              <p className="mt-2 text-xs leading-5 text-zinc-500">
                holder {goal.holder?.label ?? "unresolved"} / event {goal.introduced_in_event} / scene {goal.scene_id ?? "-"}
              </p>
            </article>
          ))}
        </div>
      </section>
      <aside className="space-y-3">
        <StatBlock label="Goals" value={String(artifact.goal_stats.grounded_goals)} detail={`${artifact.goal_stats.input_goal_cues} cues`} />
        <StatBlock label="With holder" value={String(artifact.goal_stats.goals_with_holder)} />
      </aside>
    </div>
  )
}
