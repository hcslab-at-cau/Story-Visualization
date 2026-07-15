import type { V3EventCandidate } from "@/lib/pipeline/v3-event-types"
import {
  type V3TimelineNode,
  type V3TimelineSceneBand,
} from "./types"
import { eventRangeLabel } from "./view-utils"

export function ElementDetailPanel({
  axisLabel,
  label,
  nodes,
  events,
  scenes,
  linkCount,
  onClose,
}: {
  axisLabel: string
  label: string
  nodes: V3TimelineNode[]
  events: V3EventCandidate[]
  scenes: V3TimelineSceneBand[]
  linkCount: number
  onClose: () => void
}) {
  const cueCount = nodes.reduce((total, node) => total + node.count, 0)

  return (
    <aside
      aria-label={`${label} timeline details`}
      className="max-h-[72vh] overflow-auto rounded-xl border border-zinc-200 bg-white p-4 shadow-sm xl:sticky xl:top-3 xl:self-start"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{axisLabel}</p>
          <h3 className="mt-1 truncate text-lg font-semibold text-zinc-950">{label}</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          Close
        </button>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
        <div className="rounded-lg bg-zinc-50 px-3 py-2">
          <dt className="text-xs text-zinc-500">Events</dt>
          <dd className="mt-1 font-semibold text-zinc-900">{events.length}</dd>
        </div>
        <div className="rounded-lg bg-zinc-50 px-3 py-2">
          <dt className="text-xs text-zinc-500">Cues</dt>
          <dd className="mt-1 font-semibold text-zinc-900">{cueCount}</dd>
        </div>
        <div className="rounded-lg bg-zinc-50 px-3 py-2">
          <dt className="text-xs text-zinc-500">Links</dt>
          <dd className="mt-1 font-semibold text-zinc-900">{linkCount}</dd>
        </div>
      </dl>

      <div className="mt-5 border-t border-zinc-100 pt-4">
        <p className="text-sm font-semibold text-zinc-900">Appears in events</p>
        <div className="mt-3 space-y-2">
          {events.map((event) => (
            <article key={event.event_id} className="rounded-lg border border-zinc-200 px-3 py-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded-full bg-zinc-950 px-2 py-0.5 font-mono text-[11px] font-semibold text-white">
                  E{event.sequence_index}
                </span>
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600">
                  {eventRangeLabel(event)}
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-zinc-800">{event.summary}</p>
            </article>
          ))}
        </div>
      </div>

      {scenes.length > 0 && (
        <div className="mt-5 border-t border-zinc-100 pt-4">
          <p className="text-sm font-semibold text-zinc-900">Scene context</p>
          <div className="mt-3 space-y-2">
            {scenes.map((scene) => (
              <article key={scene.sceneId} className="rounded-lg border border-fuchsia-100 bg-fuchsia-50 px-3 py-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-fuchsia-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-fuchsia-700">
                    S{scene.sequenceIndex}
                  </span>
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-zinc-600 ring-1 ring-fuchsia-100">
                    E{scene.startEventIndex + 1}-E{scene.endEventIndex + 1}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-zinc-900">{scene.summary}</p>
                <p className="mt-1 text-xs leading-5 text-zinc-600">
                  {scene.timeLabel} / {scene.placeLabel} / {scene.focusLabel} / {scene.castLabel}
                </p>
              </article>
            ))}
          </div>
        </div>
      )}
    </aside>
  )
}
