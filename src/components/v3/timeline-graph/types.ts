import type { V3EventCandidate } from "@/lib/pipeline/v3-event-types"

export type V3TimelineAxisKey =
  | "cast"
  | "place"
  | "time"
  | "object"
  | "goal"
  | "causality"

export interface V3TimelineNode {
  id: string
  axis: V3TimelineAxisKey
  eventId: string
  eventIndex: number
  laneIndex: number
  key: string
  label: string
  count: number
}

export interface V3TimelineLane {
  axis: V3TimelineAxisKey
  index: number
  itemKeys: string[]
  eventIndexes: number[]
  count: number
}

export interface V3TimelineRepeatedLink {
  axis: V3TimelineAxisKey
  key: string
  label: string
  laneIndex: number
  startEventIndex: number
  endEventIndex: number
}

export interface V3TimelineSceneBand {
  sceneId: string
  sequenceIndex: number
  startEventIndex: number
  endEventIndex: number
  summary: string
  timeLabel: string
  placeLabel: string
  focusLabel: string
  castLabel: string
}

export interface V3TimelineGraphModel {
  events: V3EventCandidate[]
  axisNodes: Record<V3TimelineAxisKey, V3TimelineNode[]>
  axisLanes: Record<V3TimelineAxisKey, V3TimelineLane[]>
  repeatedLinks: V3TimelineRepeatedLink[]
  sceneBands: V3TimelineSceneBand[]
}

export interface V3TimelineSelection {
  axis: V3TimelineAxisKey
  key: string
}
