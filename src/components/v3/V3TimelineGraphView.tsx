"use client"

import { useMemo, useState } from "react"
import type { V3EventGroupingArtifact } from "@/lib/pipeline/v3-event-types"
import type { V3SceneCandidate } from "@/lib/pipeline/v3-scene-types"
import {
  buildV3TimelineGraphModel,
  getSelectedTimelineLinks,
  getSelectedTimelineNodes,
  timelineSelectionEventIndexes,
  V3_TIMELINE_AXES,
  type V3TimelineSelection,
} from "@/components/v3/timeline-graph"
import {
  EVENT_GAP,
  EVENT_ROW_HEIGHT,
  EVENT_STEP,
  GUTTER_WIDTH,
  SCENE_ROW_HEIGHT,
  axisHeight,
  type TimelineAxisLayout,
} from "@/components/v3/timeline-graph/layout"
import { TimelineGraphCanvas } from "@/components/v3/timeline-graph/canvas"
import {
  ElementDetailPanel,
  EmptyGraph,
  TimelineLegend,
} from "@/components/v3/timeline-graph/parts"
import {
  nodesByAxisAndEvent,
  sceneContainsEvent,
} from "@/components/v3/timeline-graph/view-utils"

interface Props {
  eventGrouping?: V3EventGroupingArtifact
  scenes: V3SceneCandidate[]
}

export default function V3TimelineGraphView({ eventGrouping, scenes }: Props) {
  const [selection, setSelection] = useState<V3TimelineSelection | null>(null)
  const model = useMemo(
    () => eventGrouping
      ? buildV3TimelineGraphModel({
        events: eventGrouping.event_candidates,
        occurrences: eventGrouping.evidence_occurrences,
        scenes,
      })
      : null,
    [eventGrouping, scenes],
  )
  const allNodes = useMemo(
    () => model ? V3_TIMELINE_AXES.flatMap((axis) => model.axisNodes[axis.key]) : [],
    [model],
  )
  const selectedNodes = useMemo(
    () => getSelectedTimelineNodes(allNodes, selection),
    [allNodes, selection],
  )
  const selectedLinks = useMemo(
    () => model ? getSelectedTimelineLinks(model.repeatedLinks, selection) : [],
    [model, selection],
  )
  const selectedEventIndexList = useMemo(
    () => timelineSelectionEventIndexes(allNodes, selection),
    [allNodes, selection],
  )
  const selectedEventIndexes = useMemo(
    () => new Set(selectedEventIndexList),
    [selectedEventIndexList],
  )
  const axisLayouts = useMemo(
    () => V3_TIMELINE_AXES.reduce<{
      layouts: TimelineAxisLayout[]
      nextTop: number
    }>((acc, axis) => {
      const height = axisHeight(model?.axisLanes[axis.key].length ?? 0)
      return {
        layouts: [
          ...acc.layouts,
          {
            axis,
            top: acc.nextTop,
            height,
          },
        ],
        nextTop: acc.nextTop + height,
      }
    }, {
      layouts: [],
      nextTop: SCENE_ROW_HEIGHT + EVENT_ROW_HEIGHT,
    }).layouts,
    [model],
  )
  const graphHeight = axisLayouts.length > 0
    ? axisLayouts[axisLayouts.length - 1].top + axisLayouts[axisLayouts.length - 1].height
    : SCENE_ROW_HEIGHT + EVENT_ROW_HEIGHT
  const selectedEvents = useMemo(() => {
    if (!model) return []

    return selectedEventIndexList.flatMap((eventIndex) => {
      const event = model.events[eventIndex]
      return event ? [event] : []
    })
  }, [model, selectedEventIndexList])
  const selectedScenes = useMemo(
    () => model
      ? model.sceneBands.filter((scene) => selectedEventIndexList.some((eventIndex) => sceneContainsEvent(scene, eventIndex)))
      : [],
    [model, selectedEventIndexList],
  )
  const selectedAxisLabel = selection
    ? V3_TIMELINE_AXES.find((axis) => axis.key === selection.axis)?.label ?? selection.axis
    : ""
  const selectedLabel = selectedNodes[0]?.label ?? selectedLinks[0]?.label ?? ""
  const hasSelection = selection !== null && selectedNodes.length > 0

  if (!eventGrouping || !model) {
    return (
      <EmptyGraph
        title="No EVENT.1 result available."
        body="Run EVENT.1 and SCENE.0 first to render the timeline graph."
      />
    )
  }

  if (model.events.length === 0) {
    return (
      <EmptyGraph
        title="No events to graph."
        body="The selected scene result does not contain event coverage."
      />
    )
  }

  const graphWidth = Math.max(980, GUTTER_WIDTH + model.events.length * EVENT_STEP - EVENT_GAP)
  const groupedNodes = nodesByAxisAndEvent(allNodes)

  return (
    <div className="space-y-3">
      <TimelineLegend
        hasSelection={hasSelection}
        onClearFocus={() => setSelection(null)}
      />

      <div className={hasSelection && selectedLabel ? "grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]" : "grid gap-3"}>
        <TimelineGraphCanvas
          model={model}
          groupedNodes={groupedNodes}
          selection={selection}
          hasSelection={hasSelection}
          selectedEventIndexes={selectedEventIndexes}
          selectedEventIndexList={selectedEventIndexList}
          axisLayouts={axisLayouts}
          graphWidth={graphWidth}
          graphHeight={graphHeight}
          onSelect={setSelection}
        />

        {hasSelection && selectedLabel && (
          <ElementDetailPanel
            axisLabel={selectedAxisLabel}
            label={selectedLabel}
            nodes={selectedNodes}
            events={selectedEvents}
            scenes={selectedScenes}
            linkCount={selectedLinks.length}
            onClose={() => setSelection(null)}
          />
        )}
      </div>
    </div>
  )
}
