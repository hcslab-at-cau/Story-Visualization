"use client"

import type { V3SceneSituationCardsArtifact } from "@/lib/pipeline/v3-memory-frames-types"
import type { PreparedChapter } from "@/types/schema"

interface Props {
  preparedChapter: PreparedChapter
  artifact?: V3SceneSituationCardsArtifact
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

function compactLabels(items: Array<{ label: string }>): string {
  return items.map((item) => item.label).join(", ") || "-"
}

function paragraphText(preparedChapter: PreparedChapter, startPid: number, endPid: number): string {
  return preparedChapter.raw_chapter.paragraphs
    .filter((paragraph) => paragraph.pid >= startPid && paragraph.pid <= endPid)
    .map((paragraph) => paragraph.text)
    .join(" ")
}

export default function V3SceneCardsStageView({ preparedChapter, artifact, running }: Props) {
  if (!artifact) {
    return (
      <EmptyState
        title={running ? "MEM.1 is running" : "No MEM.1 result yet"}
        body="Run MEM.1 after MEM.0 to turn scene contracts into situation cards for retrieval and QA."
      />
    )
  }

  return (
    <div className="grid min-h-0 gap-5 2xl:grid-cols-[minmax(0,1fr)_340px]">
      <section className="min-h-0 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">MEM.1</p>
            <h2 className="mt-1 text-lg font-semibold text-zinc-950">Scene situation cards</h2>
          </div>
          <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-zinc-600">
            {artifact.artifact_version}
          </span>
        </div>

        <div className="mt-4 max-h-[68vh] space-y-3 overflow-y-auto pr-1">
          {artifact.scene_cards.map((card) => (
            <article key={card.scene_id} className="rounded-lg border border-zinc-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-mono text-xs font-semibold text-zinc-500">{card.scene_id}</p>
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600">
                  {card.event_ids.length} events
                </span>
              </div>
              <h3 className="mt-2 text-sm font-semibold text-zinc-950">{card.situation.action_focus}</h3>
              <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                <div className="rounded-md bg-zinc-50 p-2">
                  <dt className="font-semibold uppercase tracking-wide text-zinc-400">Cast</dt>
                  <dd className="mt-1 text-zinc-700">{compactLabels(card.situation.cast)}</dd>
                </div>
                <div className="rounded-md bg-zinc-50 p-2">
                  <dt className="font-semibold uppercase tracking-wide text-zinc-400">Place</dt>
                  <dd className="mt-1 text-zinc-700">{compactLabels(card.situation.place)}</dd>
                </div>
                <div className="rounded-md bg-zinc-50 p-2">
                  <dt className="font-semibold uppercase tracking-wide text-zinc-400">Objects</dt>
                  <dd className="mt-1 text-zinc-700">{compactLabels(card.situation.salient_objects)}</dd>
                </div>
                <div className="rounded-md bg-zinc-50 p-2">
                  <dt className="font-semibold uppercase tracking-wide text-zinc-400">Goal / tension</dt>
                  <dd className="mt-1 text-zinc-700">{card.situation.active_goal_or_tension ?? "-"}</dd>
                </div>
              </dl>
              <p className="mt-3 text-xs leading-5 text-zinc-500">{card.summary_for_retrieval}</p>
              <details className="mt-2 text-xs text-zinc-500">
                <summary className="cursor-pointer select-none font-medium text-zinc-500">Source paragraphs</summary>
                <p className="mt-2 text-sm leading-7 text-zinc-700">
                  {paragraphText(preparedChapter, card.text_span.start_pid, card.text_span.end_pid)}
                </p>
              </details>
            </article>
          ))}
        </div>
      </section>

      <aside className="space-y-3">
        <StatBlock label="Cards" value={String(artifact.card_stats.scene_cards)} detail={`${artifact.card_stats.input_scenes} input scenes`} />
        <StatBlock label="Input events" value={String(artifact.card_stats.input_events)} />
        <StatBlock label="With goal" value={String(artifact.card_stats.scenes_with_goal_or_tension)} />
      </aside>
    </div>
  )
}
