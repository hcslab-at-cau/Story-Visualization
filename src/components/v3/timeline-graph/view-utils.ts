import type { V3EventCandidate } from "@/lib/pipeline/v3-event-types"
import type { V3TimelineNode, V3TimelineSceneBand } from "./types"

export function eventAxisCount(event: V3EventCandidate): number {
  return (
    event.cast_ids.length +
    event.place_ids.length +
    event.time_ids.length +
    event.object_ids.length +
    event.goal_ids.length +
    event.causality_ids.length
  )
}

export function nodesByAxisAndEvent(nodes: V3TimelineNode[]): Map<string, V3TimelineNode[]> {
  const grouped = new Map<string, V3TimelineNode[]>()
  for (const node of nodes) {
    const key = `${node.axis}:${node.eventIndex}`
    grouped.set(key, [...(grouped.get(key) ?? []), node])
  }
  return grouped
}

export function eventRangeLabel(event: V3EventCandidate): string {
  return `P${event.start_pid}${event.end_pid !== event.start_pid ? `-${event.end_pid}` : ""}`
}

export function sceneContainsEvent(scene: V3TimelineSceneBand, eventIndex: number): boolean {
  return eventIndex >= scene.startEventIndex && eventIndex <= scene.endEventIndex
}
