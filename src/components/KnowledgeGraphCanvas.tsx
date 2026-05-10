"use client"

import { useUiStrings } from "@/components/LanguageProvider"
import { VISUALIZATION_STRINGS } from "@/lib/visualization-strings"
import type {
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
  KnowledgeGraphNodeKind,
} from "@/types/graph"

const KIND_ORDER: KnowledgeGraphNodeKind[] = [
  "scene",
  "event",
  "character",
  "place",
  "entity",
  "mention",
]

const KIND_STYLE: Record<KnowledgeGraphNodeKind, {
  fill: string
  stroke: string
  text: string
}> = {
  scene: { fill: "#e0f2fe", stroke: "#38bdf8", text: "#075985" },
  event: { fill: "#dcfce7", stroke: "#4ade80", text: "#166534" },
  character: { fill: "#fef3c7", stroke: "#fbbf24", text: "#92400e" },
  place: { fill: "#cffafe", stroke: "#22d3ee", text: "#155e75" },
  entity: { fill: "#f4f4f5", stroke: "#a1a1aa", text: "#27272a" },
  mention: { fill: "#fae8ff", stroke: "#e879f9", text: "#86198f" },
}

interface PositionedNode {
  node: KnowledgeGraphNode
  x: number
  y: number
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value
}

function buildLayout(nodes: KnowledgeGraphNode[]): {
  positioned: PositionedNode[]
  width: number
  height: number
} {
  const maxNodes = nodes.slice(0, 96)
  const groups = new Map<KnowledgeGraphNodeKind, KnowledgeGraphNode[]>()
  for (const kind of KIND_ORDER) groups.set(kind, [])
  for (const node of maxNodes) {
    groups.set(node.kind, [...(groups.get(node.kind) ?? []), node])
  }

  const columnWidth = 178
  const rowHeight = 62
  const top = 68
  const left = 96
  const positioned: PositionedNode[] = []
  let maxRows = 1

  KIND_ORDER.forEach((kind, columnIndex) => {
    const group = groups.get(kind) ?? []
    maxRows = Math.max(maxRows, group.length)
    group.forEach((node, rowIndex) => {
      positioned.push({
        node,
        x: left + columnIndex * columnWidth,
        y: top + rowIndex * rowHeight,
      })
    })
  })

  return {
    positioned,
    width: left * 2 + (KIND_ORDER.length - 1) * columnWidth,
    height: Math.max(360, top + maxRows * rowHeight + 48),
  }
}

function edgeCurve(from: PositionedNode, to: PositionedNode): string {
  const dx = Math.abs(to.x - from.x)
  const curve = Math.max(36, Math.min(140, dx * 0.45))
  const c1x = from.x + (to.x >= from.x ? curve : -curve)
  const c2x = to.x - (to.x >= from.x ? curve : -curve)
  return `M ${from.x} ${from.y} C ${c1x} ${from.y}, ${c2x} ${to.y}, ${to.x} ${to.y}`
}

export default function KnowledgeGraphCanvas({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
}: {
  nodes: KnowledgeGraphNode[]
  edges: KnowledgeGraphEdge[]
  selectedNodeId: string | null
  onSelectNode: (nodeId: string) => void
}) {
  const { locale } = useUiStrings()
  const copy = VISUALIZATION_STRINGS[locale].graphCanvas

  if (nodes.length === 0) {
    return (
      <section className="rounded-2xl border border-dashed border-zinc-300 bg-white px-5 py-8 text-center text-sm text-zinc-400">
        {copy.empty}
      </section>
    )
  }

  const layout = buildLayout(nodes)
  const positionByNodeId = new Map(layout.positioned.map((item) => [item.node.nodeId, item]))
  const visibleEdges = edges
    .filter((edge) => positionByNodeId.has(edge.fromNodeId) && positionByNodeId.has(edge.toNodeId))
    .slice(0, 180)
  const selectedConnected = new Set(
    selectedNodeId
      ? edges
          .filter((edge) => edge.fromNodeId === selectedNodeId || edge.toNodeId === selectedNodeId)
          .flatMap((edge) => [edge.fromNodeId, edge.toNodeId])
      : [],
  )

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-200 bg-zinc-50 px-5 py-4">
        <div>
          <h3 className="text-base font-black text-zinc-900">{copy.title}</h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-500">{copy.description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {KIND_ORDER.map((kind) => (
            <span key={kind} className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-semibold text-zinc-600">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: KIND_STYLE[kind].stroke }} />
              {copy.kindLabels[kind]}
            </span>
          ))}
        </div>
      </div>

      <div className="overflow-auto bg-[radial-gradient(circle_at_top_left,#f8fafc,transparent_34%),linear-gradient(#fff,#f8fafc)] p-4">
        <svg
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="img"
          aria-label={copy.title}
          className="max-w-none"
        >
          {KIND_ORDER.map((kind, index) => (
            <g key={kind}>
              <text
                x={96 + index * 178}
                y={28}
                textAnchor="middle"
                className="fill-zinc-400 text-[11px] font-black uppercase tracking-wide"
              >
                {copy.kindLabels[kind]}
              </text>
              <line
                x1={96 + index * 178}
                y1={44}
                x2={96 + index * 178}
                y2={layout.height - 24}
                stroke="#e4e4e7"
                strokeDasharray="4 8"
              />
            </g>
          ))}

          {visibleEdges.map((edge) => {
            const from = positionByNodeId.get(edge.fromNodeId)
            const to = positionByNodeId.get(edge.toNodeId)
            if (!from || !to) return null
            const focused = !selectedNodeId || edge.fromNodeId === selectedNodeId || edge.toNodeId === selectedNodeId
            return (
              <path
                key={edge.edgeId}
                d={edgeCurve(from, to)}
                fill="none"
                stroke={focused ? "#71717a" : "#d4d4d8"}
                strokeWidth={focused ? 1.8 : 1.1}
                strokeOpacity={focused ? 0.58 : 0.28}
              >
                <title>{`${edge.type}: ${edge.label}`}</title>
              </path>
            )
          })}

          {layout.positioned.map(({ node, x, y }) => {
            const style = KIND_STYLE[node.kind]
            const selected = node.nodeId === selectedNodeId
            const connected = selectedConnected.has(node.nodeId)
            const muted = Boolean(selectedNodeId) && !selected && !connected
            return (
              <g
                key={node.nodeId}
                role="button"
                tabIndex={0}
                onClick={() => onSelectNode(node.nodeId)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") onSelectNode(node.nodeId)
                }}
                className="cursor-pointer outline-none"
                opacity={muted ? 0.34 : 1}
              >
                <rect
                  x={x - 64}
                  y={y - 18}
                  width={128}
                  height={36}
                  rx={14}
                  fill={selected ? "#18181b" : style.fill}
                  stroke={selected ? "#18181b" : style.stroke}
                  strokeWidth={selected ? 2.5 : 1.5}
                />
                <text
                  x={x}
                  y={y - 2}
                  textAnchor="middle"
                  className="text-[11px] font-black"
                  fill={selected ? "#ffffff" : style.text}
                >
                  {truncate(node.label, 18)}
                </text>
                <text
                  x={x}
                  y={y + 11}
                  textAnchor="middle"
                  className="text-[9px] font-semibold"
                  fill={selected ? "#d4d4d8" : "#71717a"}
                >
                  {copy.kindLabels[node.kind]}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 px-5 py-3 text-xs text-zinc-500">
        <span>{copy.shown}: {Math.min(nodes.length, 96)} / {nodes.length} nodes, {visibleEdges.length} / {edges.length} edges</span>
        {edges.length > visibleEdges.length && <span>{copy.edgeLimit}</span>}
      </div>
    </section>
  )
}
