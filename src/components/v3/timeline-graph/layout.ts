import type { V3TimelineAxisKey } from "./types"

export const GUTTER_WIDTH = 112
export const EVENT_WIDTH = 260
export const EVENT_GAP = 44
export const EVENT_STEP = EVENT_WIDTH + EVENT_GAP
export const SCENE_ROW_HEIGHT = 132
export const EVENT_ROW_HEIGHT = 160
export const MIN_AXIS_ROW_HEIGHT = 112
export const AXIS_NODE_HEIGHT = 38
export const AXIS_ROW_PADDING_TOP = 18
export const AXIS_ROW_PADDING_BOTTOM = 20
export const AXIS_LANE_GAP = 10
export const AXIS_LANE_STEP = AXIS_NODE_HEIGHT + AXIS_LANE_GAP

export interface TimelineAxisLayout {
  axis: {
    key: V3TimelineAxisKey
    label: string
  }
  top: number
  height: number
}

export const AXIS_STYLE: Record<V3TimelineAxisKey, {
  rowClass: string
  nodeClass: string
  lineColor: string
  labelClass: string
}> = {
  cast: {
    rowClass: "bg-sky-50/35",
    nodeClass: "border-sky-200 bg-sky-50 text-sky-950",
    lineColor: "#0284c7",
    labelClass: "text-sky-700",
  },
  place: {
    rowClass: "bg-emerald-50/35",
    nodeClass: "border-emerald-200 bg-emerald-50 text-emerald-950",
    lineColor: "#059669",
    labelClass: "text-emerald-700",
  },
  time: {
    rowClass: "bg-amber-50/45",
    nodeClass: "border-amber-200 bg-amber-50 text-amber-950",
    lineColor: "#d97706",
    labelClass: "text-amber-700",
  },
  object: {
    rowClass: "bg-stone-50/70",
    nodeClass: "border-stone-200 bg-stone-50 text-stone-950",
    lineColor: "#78716c",
    labelClass: "text-stone-700",
  },
  goal: {
    rowClass: "bg-violet-50/35",
    nodeClass: "border-violet-200 bg-violet-50 text-violet-950",
    lineColor: "#7c3aed",
    labelClass: "text-violet-700",
  },
  causality: {
    rowClass: "bg-cyan-50/35",
    nodeClass: "border-cyan-200 bg-cyan-50 text-cyan-950",
    lineColor: "#0891b2",
    labelClass: "text-cyan-700",
  },
}

export function axisHeight(laneCount: number): number {
  const occupiedHeight = AXIS_ROW_PADDING_TOP +
    Math.max(1, laneCount) * AXIS_NODE_HEIGHT +
    Math.max(0, laneCount - 1) * AXIS_LANE_GAP +
    AXIS_ROW_PADDING_BOTTOM

  return Math.max(MIN_AXIS_ROW_HEIGHT, occupiedHeight)
}

export function axisLaneOffset(laneIndex: number): number {
  return AXIS_ROW_PADDING_TOP + laneIndex * AXIS_LANE_STEP
}

export function axisLaneCenter(laneIndex: number): number {
  return axisLaneOffset(laneIndex) + AXIS_NODE_HEIGHT / 2
}
