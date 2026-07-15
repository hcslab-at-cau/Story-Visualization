import {
  AXIS_STYLE,
  EVENT_ROW_HEIGHT,
  EVENT_STEP,
  EVENT_WIDTH,
  GUTTER_WIDTH,
  SCENE_ROW_HEIGHT,
  axisLaneCenter,
  axisLaneOffset,
  type TimelineAxisLayout,
} from "./layout"
import {
  type V3TimelineGraphModel,
  type V3TimelineNode,
  type V3TimelineSelection,
} from "./types"
import {
  AxisNode,
  EventCard,
  EventFootprint,
  SceneBandCard,
} from "./parts"
import { sceneContainsEvent } from "./view-utils"

export function TimelineGraphCanvas({
  model,
  groupedNodes,
  selection,
  hasSelection,
  selectedEventIndexes,
  selectedEventIndexList,
  axisLayouts,
  graphWidth,
  graphHeight,
  onSelect,
}: {
  model: V3TimelineGraphModel
  groupedNodes: Map<string, V3TimelineNode[]>
  selection: V3TimelineSelection | null
  hasSelection: boolean
  selectedEventIndexes: Set<number>
  selectedEventIndexList: number[]
  axisLayouts: TimelineAxisLayout[]
  graphWidth: number
  graphHeight: number
  onSelect: (selection: V3TimelineSelection) => void
}) {
  return (
    <div className="min-w-0 max-h-[72vh] overflow-auto rounded-xl border border-zinc-200 bg-white">
      <div
        className="relative"
        style={{
          width: graphWidth,
          height: graphHeight,
        }}
      >
        <div
          className="absolute left-0 top-0 border-b border-zinc-200 bg-white"
          style={{ width: graphWidth, height: SCENE_ROW_HEIGHT }}
        />
        <div
          className="absolute left-0 flex items-center px-4 text-xs font-semibold uppercase tracking-wide text-zinc-500"
          style={{ top: 0, width: GUTTER_WIDTH, height: SCENE_ROW_HEIGHT }}
        >
          Scenes
        </div>
        {model.sceneBands.map((scene) => {
          const left = GUTTER_WIDTH + scene.startEventIndex * EVENT_STEP
          const width = (scene.endEventIndex - scene.startEventIndex) * EVENT_STEP + EVENT_WIDTH
          const active = hasSelection && selectedEventIndexList.some((eventIndex) => sceneContainsEvent(scene, eventIndex))

          return (
            <SceneBandCard
              key={scene.sceneId}
              scene={scene}
              left={left}
              width={width}
              active={active}
              dimmed={hasSelection && !active}
            />
          )
        })}

        <div
          className="absolute left-0 border-b border-zinc-200 bg-zinc-50/60"
          style={{
            top: SCENE_ROW_HEIGHT,
            width: graphWidth,
            height: EVENT_ROW_HEIGHT,
          }}
        />
        <div
          className="absolute left-0 flex items-center px-4 text-xs font-semibold uppercase tracking-wide text-zinc-500"
          style={{ top: SCENE_ROW_HEIGHT, width: GUTTER_WIDTH, height: EVENT_ROW_HEIGHT }}
        >
          Events
        </div>
        {model.events.map((event, eventIndex) => (
          <EventCard
            key={event.event_id}
            event={event}
            left={GUTTER_WIDTH + eventIndex * EVENT_STEP}
            highlighted={hasSelection && selectedEventIndexes.has(eventIndex)}
            dimmed={hasSelection && !selectedEventIndexes.has(eventIndex)}
          />
        ))}
        {model.events.map((event, eventIndex) => (
          <EventFootprint
            key={`${event.event_id}-footprint`}
            eventIndex={eventIndex}
            groupedNodes={groupedNodes}
            left={GUTTER_WIDTH + eventIndex * EVENT_STEP}
            dimmed={hasSelection && !selectedEventIndexes.has(eventIndex)}
          />
        ))}

        {axisLayouts.map(({ axis, top, height }) => {
          const style = AXIS_STYLE[axis.key]
          const laneLinks = model.repeatedLinks.filter((link) => link.axis === axis.key)
          const axisActive = hasSelection && selection?.axis === axis.key

          return (
            <div key={axis.key}>
              <div
                className={`absolute left-0 border-b border-zinc-200 ${style.rowClass}`}
                style={{ top, width: graphWidth, height }}
              />
              <div
                className={`absolute left-0 flex items-center px-4 text-xs font-semibold uppercase tracking-wide transition-opacity ${
                  style.labelClass
                } ${hasSelection && !axisActive ? "opacity-35" : "opacity-100"}`}
                style={{ top, width: GUTTER_WIDTH, height }}
              >
                {axis.label}
              </div>
              {model.axisLanes[axis.key].map((lane) => (
                <div
                  key={`${axis.key}-lane-${lane.index}-guide`}
                  className="absolute border-t border-zinc-200/45"
                  style={{
                    left: GUTTER_WIDTH,
                    top: top + axisLaneCenter(lane.index),
                    width: graphWidth - GUTTER_WIDTH,
                  }}
                />
              ))}
              <svg
                className="pointer-events-none absolute left-0"
                style={{ top, width: graphWidth, height }}
                aria-hidden="true"
              >
                {laneLinks.map((link) => {
                  const start = GUTTER_WIDTH + link.startEventIndex * EVENT_STEP + EVENT_WIDTH / 2
                  const end = GUTTER_WIDTH + link.endEventIndex * EVENT_STEP + EVENT_WIDTH / 2
                  const active = hasSelection && selection?.axis === link.axis && selection.key === link.key

                  return (
                    <g key={`${link.axis}-${link.key}-${link.startEventIndex}-${link.endEventIndex}`}>
                      <title>{link.label}</title>
                      <line
                        x1={start}
                        x2={end}
                        y1={axisLaneCenter(link.laneIndex)}
                        y2={axisLaneCenter(link.laneIndex)}
                        stroke={style.lineColor}
                        strokeLinecap="round"
                        strokeWidth={active ? 4 : 2.5}
                        opacity={hasSelection ? (active ? 0.95 : 0.12) : 0.78}
                      />
                    </g>
                  )
                })}
              </svg>
              {model.events.map((event, eventIndex) => {
                const nodes = groupedNodes.get(`${axis.key}:${eventIndex}`) ?? []

                return (
                  <ul
                    key={`${axis.key}-${event.event_id}`}
                    className="absolute"
                    style={{
                      left: GUTTER_WIDTH + eventIndex * EVENT_STEP,
                      top,
                      width: EVENT_WIDTH,
                      height,
                    }}
                  >
                    {nodes.map((node) => {
                      const selected = selection?.axis === node.axis && selection.key === node.key

                      return (
                        <li
                          key={node.id}
                          className="absolute w-full"
                          style={{
                            top: axisLaneOffset(node.laneIndex),
                          }}
                        >
                          <AxisNode
                            node={node}
                            selected={Boolean(selected)}
                            dimmed={hasSelection && !selected}
                            onSelect={() => onSelect({ axis: node.axis, key: node.key })}
                          />
                        </li>
                      )
                    })}
                  </ul>
                )
              })}
            </div>
          )
        })}

      </div>
    </div>
  )
}
