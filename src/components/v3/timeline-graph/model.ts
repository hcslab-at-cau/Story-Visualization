import type {
  V3EventCandidate,
  V3EventEvidenceOccurrence,
} from "@/lib/pipeline/v3-event-types"
import type { V3SceneCandidate } from "@/lib/pipeline/v3-scene-types"
import type {
  V3TimelineAxisKey,
  V3TimelineGraphModel,
  V3TimelineLane,
  V3TimelineNode,
  V3TimelineRepeatedLink,
  V3TimelineSceneBand,
  V3TimelineSelection,
} from "./types"

export const V3_TIMELINE_AXES: Array<{ key: V3TimelineAxisKey; label: string }> = [
  { key: "cast", label: "Cast" },
  { key: "place", label: "Place" },
  { key: "time", label: "Time" },
  { key: "object", label: "Object" },
  { key: "goal", label: "Goal" },
  { key: "causality", label: "Causal" },
]

type PendingTimelineNode = Omit<V3TimelineNode, "laneIndex">

interface V3TimelineItemSpan {
  axis: V3TimelineAxisKey
  key: string
  label: string
  startEventIndex: number
  endEventIndex: number
  eventIndexes: number[]
  count: number
  order: number
  laneIndex?: number
}

const AXIS_ID_FIELDS: Record<V3TimelineAxisKey, keyof Pick<
  V3EventCandidate,
  "cast_ids" | "place_ids" | "time_ids" | "object_ids" | "goal_ids" | "causality_ids"
>> = {
  cast: "cast_ids",
  place: "place_ids",
  time: "time_ids",
  object: "object_ids",
  goal: "goal_ids",
  causality: "causality_ids",
}

const PLACE_COMPATIBLE_MODIFIERS = new Set([
  "another",
  "beautiful",
  "dark",
  "deep",
  "large",
  "little",
  "long",
  "loveliest",
  "lovely",
  "low",
  "small",
  "very",
])
const PLACE_ALIAS_HEADS = new Set(["garden", "hall", "rabbit hole", "well"])
const OBJECT_SIZE_MODIFIERS = new Set(["little", "small", "tiny", "very"])
const WEAK_TIMELINE_PLACE_KEYS = new Set(["air", "down here", "here", "there"])
const CONTEXT_DEPENDENT_TIME_KEYS = new Set([
  "a moment",
  "after a while",
  "afterwards",
  "at the time",
  "moment",
  "the second time round",
  "this time",
  "time",
])

export function getSelectedTimelineNodes(
  nodes: V3TimelineNode[],
  selection: V3TimelineSelection | null,
): V3TimelineNode[] {
  if (!selection) return []

  return nodes
    .filter((node) => node.axis === selection.axis && node.key === selection.key)
    .sort((a, b) => a.eventIndex - b.eventIndex)
}

export function getSelectedTimelineLinks(
  links: V3TimelineRepeatedLink[],
  selection: V3TimelineSelection | null,
): V3TimelineRepeatedLink[] {
  if (!selection) return []

  return links.filter((link) => link.axis === selection.axis && link.key === selection.key)
}

export function timelineSelectionEventIndexes(
  nodes: V3TimelineNode[],
  selection: V3TimelineSelection | null,
): number[] {
  const indexes = new Set(getSelectedTimelineNodes(nodes, selection).map((node) => node.eventIndex))

  return [...indexes].sort((a, b) => a - b)
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ")
}

function cleanAxisLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/[,/]+/g, " ")
    .replace(/^[\s"'`([{<]+/, "")
    .replace(/[\s"'`\])}>.,!?;:]+$/, "")
    .replace(/\s+/g, " ")
}

function stripDeterminer(value: string): string {
  return value
    .replace(/^(the|a|an|this|that|these|those)\s+/, "")
    .replace(/'s\b/g, "")
    .trim()
}

function stripLeadingModifiers(value: string, modifiers: Set<string>): string {
  const words = value.split(" ").filter(Boolean)
  while (words.length > 1 && modifiers.has(words[0])) {
    words.shift()
  }
  return words.join(" ")
}

function normalizedTimelineEntityLabel(
  axis: V3TimelineAxisKey,
  value: string,
): string {
  const base = stripDeterminer(cleanAxisLabel(value))

  if (axis === "place") {
    const withoutModifiers = stripLeadingModifiers(base, PLACE_COMPATIBLE_MODIFIERS)
    return PLACE_ALIAS_HEADS.has(withoutModifiers) ? withoutModifiers : base
  }

  if (axis === "object") {
    return stripLeadingModifiers(base, OBJECT_SIZE_MODIFIERS)
  }

  return base
}

function occurrenceLabel(
  occurrence: V3EventEvidenceOccurrence,
  axis: V3TimelineAxisKey,
): string {
  if (axis === "goal") {
    return occurrence.goal_text ?? occurrence.label ?? occurrence.normalized ?? occurrence.span
  }

  if (axis === "causality" && (occurrence.cause_text || occurrence.effect_text)) {
    return [occurrence.cause_text, occurrence.effect_text].filter(Boolean).join(" -> ")
  }

  return occurrence.entity_cluster_label ?? occurrence.normalized ?? occurrence.label ?? occurrence.span
}

function occurrenceDisplayLabel(
  occurrence: V3EventEvidenceOccurrence,
  axis: V3TimelineAxisKey,
): string {
  const label = occurrenceLabel(occurrence, axis)
  if (axis === "place" || axis === "object") {
    return normalizedTimelineEntityLabel(axis, label) || label
  }
  return label
}

function occurrenceKey(
  occurrence: V3EventEvidenceOccurrence,
  axis: V3TimelineAxisKey,
): string {
  if (axis === "cast" && occurrence.entity_cluster_id) {
    return `${axis}:${occurrence.entity_cluster_id}`
  }

  if (axis === "place" || axis === "time" || axis === "object") {
    return `${axis}:${normalizedTimelineEntityLabel(axis, occurrenceLabel(occurrence, axis))}`
  }

  return `${axis}:${normalizeKey(occurrenceLabel(occurrence, axis))}`
}

function hasVisibleGate(occurrence: V3EventEvidenceOccurrence): boolean {
  return occurrence.gate !== "support" && occurrence.gate !== "drop"
}

function isConcreteTimelineTime(occurrence: V3EventEvidenceOccurrence): boolean {
  const label = normalizedTimelineEntityLabel("time", occurrenceLabel(occurrence, "time"))
  if (!label || CONTEXT_DEPENDENT_TIME_KEYS.has(label)) return false

  return /\b(\d+|day|days|night|morning|afternoon|evening|hour|hours|minute|minutes|few|several|tea time|to night|tonight|today|yesterday|tomorrow)\b/.test(label)
}

function isVisibleAxisOccurrence(
  occurrence: V3EventEvidenceOccurrence,
  axis: V3TimelineAxisKey,
  key: string,
  eventCountByAxisKey: Map<string, number>,
): boolean {
  if (!hasVisibleGate(occurrence)) return false
  if (axis === "time") return isConcreteTimelineTime(occurrence)
  if (axis === "place") {
    const label = normalizedTimelineEntityLabel("place", occurrenceLabel(occurrence, "place"))
    return !WEAK_TIMELINE_PLACE_KEYS.has(label)
  }
  if (axis === "object") return (eventCountByAxisKey.get(key) ?? 0) > 1
  return true
}

function emptyAxisNodes(): Record<V3TimelineAxisKey, V3TimelineNode[]> {
  return {
    cast: [],
    place: [],
    time: [],
    object: [],
    goal: [],
    causality: [],
  }
}

function emptyAxisLanes(): Record<V3TimelineAxisKey, V3TimelineLane[]> {
  return {
    cast: [],
    place: [],
    time: [],
    object: [],
    goal: [],
    causality: [],
  }
}

function emptyPendingAxisNodes(): Record<V3TimelineAxisKey, PendingTimelineNode[]> {
  return {
    cast: [],
    place: [],
    time: [],
    object: [],
    goal: [],
    causality: [],
  }
}

function emptyAxisItemSpans(): Record<V3TimelineAxisKey, Map<string, V3TimelineItemSpan>> {
  return {
    cast: new Map(),
    place: new Map(),
    time: new Map(),
    object: new Map(),
    goal: new Map(),
    causality: new Map(),
  }
}

function buildPackedAxisLanes(itemSpans: Map<string, V3TimelineItemSpan>): V3TimelineLane[] {
  const lanes: Array<V3TimelineLane & { occupiedEndEventIndex: number }> = []
  const orderedSpans = [...itemSpans.values()].sort((a, b) => (
    a.startEventIndex - b.startEventIndex ||
    b.endEventIndex - a.endEventIndex ||
    a.order - b.order
  ))

  for (const span of orderedSpans) {
    let lane = lanes.find((candidate) => candidate.occupiedEndEventIndex < span.startEventIndex)
    if (!lane) {
      lane = {
        axis: span.axis,
        index: lanes.length,
        itemKeys: [],
        eventIndexes: [],
        count: 0,
        occupiedEndEventIndex: -1,
      }
      lanes.push(lane)
    }

    span.laneIndex = lane.index
    lane.itemKeys.push(span.key)
    lane.count += span.count
    lane.occupiedEndEventIndex = Math.max(lane.occupiedEndEventIndex, span.endEventIndex)
    for (const eventIndex of span.eventIndexes) {
      if (lane.eventIndexes[lane.eventIndexes.length - 1] !== eventIndex) {
        lane.eventIndexes.push(eventIndex)
      }
    }
  }

  return lanes.map((lane) => ({
    axis: lane.axis,
    index: lane.index,
    itemKeys: lane.itemKeys,
    eventIndexes: lane.eventIndexes,
    count: lane.count,
  }))
}

function buildRepeatedLinks(
  axisNodes: Record<V3TimelineAxisKey, V3TimelineNode[]>,
): V3TimelineRepeatedLink[] {
  const links: V3TimelineRepeatedLink[] = []

  for (const axis of V3_TIMELINE_AXES.map((item) => item.key)) {
    const grouped = new Map<string, V3TimelineNode[]>()
    for (const node of axisNodes[axis]) {
      grouped.set(node.key, [...(grouped.get(node.key) ?? []), node])
    }

    for (const [key, nodes] of grouped) {
      const orderedNodes = nodes
        .sort((a, b) => a.eventIndex - b.eventIndex)
        .filter((node, index, all) => index === 0 || node.eventIndex !== all[index - 1].eventIndex)
      if (orderedNodes.length < 2) continue

      for (let index = 1; index < orderedNodes.length; index += 1) {
        links.push({
          axis,
          key,
          label: orderedNodes[index].label,
          laneIndex: orderedNodes[index].laneIndex,
          startEventIndex: orderedNodes[index - 1].eventIndex,
          endEventIndex: orderedNodes[index].eventIndex,
        })
      }
    }
  }

  return links
}

function sceneEventIndexes(
  scene: V3SceneCandidate,
  eventIndexById: Map<string, number>,
): number[] {
  const explicitIndexes = scene.event_ids
    .map((eventId) => eventIndexById.get(eventId))
    .filter((index): index is number => typeof index === "number")
  if (explicitIndexes.length > 0) return explicitIndexes

  return [scene.start_event_id, scene.end_event_id]
    .map((eventId) => eventIndexById.get(eventId))
    .filter((index): index is number => typeof index === "number")
}

export function buildV3TimelineGraphModel({
  events,
  occurrences,
  scenes,
}: {
  events: V3EventCandidate[]
  occurrences: V3EventEvidenceOccurrence[]
  scenes: V3SceneCandidate[]
}): V3TimelineGraphModel {
  const occurrenceById = new Map(
    occurrences.map((occurrence) => [occurrence.source_candidate_id, occurrence]),
  )
  const axisNodes = emptyAxisNodes()
  const axisLanes = emptyAxisLanes()
  const pendingAxisNodes = emptyPendingAxisNodes()
  const axisItemSpans = emptyAxisItemSpans()
  const eventCountByAxisKey = new Map<string, number>()
  let itemOrder = 0

  events.forEach((event) => {
    for (const { key: axis } of V3_TIMELINE_AXES) {
      const keysInEvent = new Set<string>()
      const ids = event[AXIS_ID_FIELDS[axis]]

      for (const id of ids) {
        const occurrence = occurrenceById.get(id)
        if (!occurrence || !hasVisibleGate(occurrence)) continue
        keysInEvent.add(occurrenceKey(occurrence, axis))
      }

      for (const key of keysInEvent) {
        eventCountByAxisKey.set(key, (eventCountByAxisKey.get(key) ?? 0) + 1)
      }
    }
  })

  events.forEach((event, eventIndex) => {
    for (const { key: axis } of V3_TIMELINE_AXES) {
      const eventAxisNodes = new Map<string, PendingTimelineNode>()
      const ids = event[AXIS_ID_FIELDS[axis]]

      for (const id of ids) {
        const occurrence = occurrenceById.get(id)
        if (!occurrence) continue

        const key = occurrenceKey(occurrence, axis)
        if (!isVisibleAxisOccurrence(occurrence, axis, key, eventCountByAxisKey)) continue
        const existing = eventAxisNodes.get(key)
        if (existing) {
          existing.count += 1
          continue
        }
        const label = occurrenceDisplayLabel(occurrence, axis)

        eventAxisNodes.set(key, {
          id: `${event.event_id}-${axis}-${key}`,
          axis,
          eventId: event.event_id,
          eventIndex,
          key,
          label,
          count: 1,
        })
      }

      for (const node of eventAxisNodes.values()) {
        const existingSpan = axisItemSpans[axis].get(node.key)
        if (existingSpan) {
          existingSpan.startEventIndex = Math.min(existingSpan.startEventIndex, eventIndex)
          existingSpan.endEventIndex = Math.max(existingSpan.endEventIndex, eventIndex)
          existingSpan.count += node.count
          if (existingSpan.eventIndexes[existingSpan.eventIndexes.length - 1] !== eventIndex) {
            existingSpan.eventIndexes.push(eventIndex)
          }
        } else {
          axisItemSpans[axis].set(node.key, {
            axis,
            key: node.key,
            label: node.label,
            startEventIndex: eventIndex,
            endEventIndex: eventIndex,
            eventIndexes: [eventIndex],
            count: node.count,
            order: itemOrder,
          })
          itemOrder += 1
        }
        pendingAxisNodes[axis].push(node)
      }
    }
  })

  for (const { key: axis } of V3_TIMELINE_AXES) {
    axisLanes[axis] = buildPackedAxisLanes(axisItemSpans[axis])
    axisNodes[axis] = pendingAxisNodes[axis].map((node) => ({
      ...node,
      laneIndex: axisItemSpans[axis].get(node.key)?.laneIndex ?? 0,
    }))
  }

  const eventIndexById = new Map(events.map((event, index) => [event.event_id, index]))
  const sceneBands = scenes.flatMap<V3TimelineSceneBand>((scene) => {
    const indexes = sceneEventIndexes(scene, eventIndexById)
    if (indexes.length === 0) return []

    return [{
      sceneId: scene.scene_id,
      sequenceIndex: scene.sequence_index,
      startEventIndex: Math.min(...indexes),
      endEventIndex: Math.max(...indexes),
      summary: scene.summary,
      timeLabel: scene.time_axis.label,
      placeLabel: scene.place_axis.label,
      focusLabel: scene.action_focus_axis.label,
      castLabel: scene.cast_axis.label,
    }]
  })

  return {
    events,
    axisNodes,
    axisLanes,
    repeatedLinks: buildRepeatedLinks(axisNodes),
    sceneBands,
  }
}
