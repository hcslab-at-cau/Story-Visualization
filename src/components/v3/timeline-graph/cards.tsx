import type { V3EventCandidate } from "@/lib/pipeline/v3-event-types"
import {
  AXIS_STYLE,
  EVENT_ROW_HEIGHT,
  EVENT_WIDTH,
  SCENE_ROW_HEIGHT,
} from "./layout"
import { V3_TIMELINE_AXES } from "./model"
import {
  type V3TimelineNode,
  type V3TimelineSceneBand,
} from "./types"
import { eventAxisCount, eventRangeLabel } from "./view-utils"

export function SceneBandCard({
  scene,
  left,
  width,
  active,
  dimmed,
}: {
  scene: V3TimelineSceneBand
  left: number
  width: number
  active: boolean
  dimmed: boolean
}) {
  return (
    <article
      className={`absolute overflow-hidden rounded-lg border border-fuchsia-200 bg-fuchsia-50 px-3 py-3 transition-all ${
        active ? "ring-2 ring-fuchsia-300" : ""
      } ${dimmed ? "opacity-25 saturate-50" : "opacity-100"}`}
      style={{
        left,
        width,
        top: 18,
        height: SCENE_ROW_HEIGHT - 36,
      }}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-full bg-fuchsia-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-fuchsia-700">
          S{scene.sequenceIndex}
        </span>
        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] text-zinc-600 ring-1 ring-fuchsia-100">
          E{scene.startEventIndex + 1}-E{scene.endEventIndex + 1}
        </span>
      </div>
      <p className="mt-2 line-clamp-2 text-xs font-semibold leading-5 text-zinc-950">{scene.summary}</p>
      <p className="mt-1 truncate text-[10px] text-zinc-500">
        {scene.timeLabel} / {scene.placeLabel} / {scene.focusLabel} / {scene.castLabel}
      </p>
    </article>
  )
}

export function EventCard({
  event,
  left,
  highlighted,
  dimmed,
}: {
  event: V3EventCandidate
  left: number
  highlighted: boolean
  dimmed: boolean
}) {
  return (
    <article
      className={`absolute rounded-lg border border-zinc-200 bg-white px-3 py-3 shadow-sm transition-all ${
        highlighted ? "ring-2 ring-zinc-900 ring-offset-2" : ""
      } ${dimmed ? "opacity-25 saturate-50" : "opacity-100"}`}
      style={{
        left,
        top: SCENE_ROW_HEIGHT + 18,
        width: EVENT_WIDTH,
        height: EVENT_ROW_HEIGHT - 36,
      }}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-full bg-zinc-950 px-2 py-0.5 font-mono text-[11px] font-semibold text-white">
          E{event.sequence_index}
        </span>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600">
          {eventRangeLabel(event)}
        </span>
        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-700">
          {eventAxisCount(event)} nodes
        </span>
      </div>
      <p className="mt-2 line-clamp-4 text-xs font-semibold leading-5 text-zinc-950">{event.summary}</p>
    </article>
  )
}

export function AxisNode({
  node,
  selected,
  dimmed,
  onSelect,
}: {
  node: V3TimelineNode
  selected: boolean
  dimmed: boolean
  onSelect: () => void
}) {
  const style = AXIS_STYLE[node.axis]

  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`Show ${node.label} details`}
      onClick={onSelect}
      className={`h-[38px] w-full rounded-md border px-2 py-1 text-left shadow-sm transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 ${
        style.nodeClass
      } ${selected ? "ring-2 ring-zinc-950 ring-offset-1" : "hover:-translate-y-0.5 hover:shadow-md"} ${
        dimmed ? "opacity-25 saturate-50" : "opacity-100"
      }`}
    >
      <p className="truncate text-[11px] font-semibold">{node.label}</p>
      {node.count > 1 && <p className="mt-0.5 text-[10px] opacity-70">{node.count} cues</p>}
    </button>
  )
}

export function EventFootprint({
  eventIndex,
  groupedNodes,
  left,
  dimmed,
}: {
  eventIndex: number
  groupedNodes: Map<string, V3TimelineNode[]>
  left: number
  dimmed: boolean
}) {
  return (
    <div
      className={`absolute flex gap-1 rounded-full bg-white/85 px-1.5 py-1 shadow-sm ring-1 ring-zinc-200 transition-opacity ${
        dimmed ? "opacity-25" : "opacity-100"
      }`}
      style={{
        left,
        top: SCENE_ROW_HEIGHT + EVENT_ROW_HEIGHT - 29,
        width: EVENT_WIDTH,
      }}
      title="Event footprint across the six axes"
    >
      {V3_TIMELINE_AXES.map((axis) => {
        const count = groupedNodes.get(`${axis.key}:${eventIndex}`)?.length ?? 0
        return (
          <span
            key={axis.key}
            className="h-2 flex-1 rounded-full"
            title={`${axis.label}: ${count}`}
            style={{
              backgroundColor: count > 0 ? AXIS_STYLE[axis.key].lineColor : "#e4e4e7",
              opacity: count > 0 ? 0.92 : 0.38,
            }}
          />
        )
      })}
    </div>
  )
}
