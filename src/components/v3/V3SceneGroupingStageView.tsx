"use client"

import { useMemo, useState } from "react"
import V3BodyResultView, { type V3BodySideItem } from "@/components/v3/V3BodyResultView"
import type {
  V3SceneAxisKey,
  V3SceneCandidate,
  V3SceneGroupingArtifact,
  V3SceneGroupingSource,
} from "@/lib/pipeline/v3-scene-types"
import type { PreparedChapter } from "@/types/schema"

interface Props {
  preparedChapter: PreparedChapter
  artifact?: V3SceneGroupingArtifact
  running?: boolean
}

const SOURCE_LABELS: Record<V3SceneGroupingSource, string> = {
  llm: "LLM",
  fallback_event: "Fallback",
}

const AXIS_LABELS: Record<V3SceneAxisKey, string> = {
  time: "Time",
  place: "Place",
  action_focus: "Focus",
  cast: "Cast",
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

function pidsInRange(startPid: number, endPid: number): number[] {
  const first = Math.min(startPid, endPid)
  const last = Math.max(startPid, endPid)
  const pids: number[] = []
  for (let pid = first; pid <= last; pid += 1) pids.push(pid)
  return pids
}

function axisSummary(scene: V3SceneCandidate): string {
  return [
    `Time: ${scene.time_axis.label}`,
    `Place: ${scene.place_axis.label}`,
    `Focus: ${scene.action_focus_axis.label}`,
    `Cast: ${scene.cast_axis.label}`,
  ].join(" / ")
}

function boundaryBasisLabel(scene: V3SceneCandidate): string {
  if (scene.boundary_basis.length === 0) return "No boundary axis"
  return scene.boundary_basis.map((axisKey) => AXIS_LABELS[axisKey]).join(", ")
}

export default function V3SceneGroupingStageView({
  preparedChapter,
  artifact,
  running,
}: Props) {
  const [sourceFilter, setSourceFilter] = useState<V3SceneGroupingSource | "all">("all")
  const scenes = useMemo(() => artifact?.scene_candidates ?? [], [artifact?.scene_candidates])
  const filteredScenes = useMemo(
    () => scenes.filter((scene) => sourceFilter === "all" || scene.grouping_source === sourceFilter),
    [scenes, sourceFilter],
  )
  const bodySideItems = useMemo<V3BodySideItem[]>(
    () => filteredScenes.flatMap((scene) =>
      pidsInRange(scene.start_pid, scene.end_pid).map((pid) => ({
        id: `${scene.scene_id}-p${pid}`,
        pid,
        title: scene.summary,
        label: `S${scene.sequence_index}`,
        tone: "scene",
        detail: axisSummary(scene),
        meta: [
          SOURCE_LABELS[scene.grouping_source],
          `${scene.event_ids.length} events`,
          boundaryBasisLabel(scene),
        ],
      })),
    ),
    [filteredScenes],
  )

  if (!artifact) {
    return (
      <EmptyState
        title={running ? "SCENE.0 is running" : "No SCENE.0 result yet"}
        body="Run SCENE.0 after EVENT.1 to merge event candidates into scene-sized candidates."
      />
    )
  }

  return (
    <div className="grid min-h-0 gap-5 2xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="min-h-0 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">SCENE.0</p>
            <h2 className="mt-1 text-lg font-semibold text-zinc-950">Scene candidates on text</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(["all", "llm", "fallback_event"] as const).map((source) => (
              <button
                key={source}
                type="button"
                onClick={() => setSourceFilter(source)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                  sourceFilter === source ? "bg-zinc-900 text-white" : "bg-white text-zinc-600 hover:bg-zinc-100"
                }`}
              >
                {source === "all" ? "All" : SOURCE_LABELS[source]}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 max-h-[68vh] overflow-y-auto pr-1">
          <V3BodyResultView
            paragraphs={preparedChapter.raw_chapter.paragraphs}
            sideItems={bodySideItems}
            emptyTitle="No scenes match this filter."
            emptyBody="Switch the source filter or rerun SCENE.0 to inspect scene-sized ranges on the source text."
          />
        </div>
      </section>

      <aside className="space-y-3">
        <div className="grid grid-cols-3 gap-2 2xl:grid-cols-1">
          <StatBlock label="Scenes" value={String(artifact.scene_stats.scene_candidates)} />
          <StatBlock label="Events" value={String(artifact.scene_stats.events_covered)} detail={`${artifact.scene_stats.input_events} input`} />
          <StatBlock label="Fallback" value={String(artifact.scene_stats.fallback_scenes)} />
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Boundary axes</p>
          <dl className="mt-3 space-y-2 text-sm">
            {(["time", "place", "action_focus", "cast"] as const).map((axisKey) => (
              <div key={axisKey} className="flex justify-between gap-4">
                <dt className="text-zinc-500">{AXIS_LABELS[axisKey]}</dt>
                <dd className="font-mono text-zinc-800">
                  {artifact.scene_stats.boundary_basis_counts[axisKey]}
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Coverage</p>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Paragraphs covered</dt>
              <dd className="font-mono text-zinc-800">{artifact.scene_stats.paragraphs_covered}</dd>
            </div>
          </dl>
        </div>
      </aside>
    </div>
  )
}
