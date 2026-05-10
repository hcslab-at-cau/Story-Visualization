"use client"

import { useUiStrings } from "@/components/LanguageProvider"
import { VISUALIZATION_STRINGS } from "@/lib/visualization-strings"
import type {
  BookEntityThread,
  BookMemoryEdge,
  BookMemoryEdgeType,
  BookMemorySnapshot,
} from "@/types/book-memory"

const EDGE_COLORS: Record<BookMemoryEdgeType, string> = {
  chapter_sequence: "#a8a29e",
  cross_chapter_character_thread: "#f59e0b",
  cross_chapter_same_place: "#06b6d4",
  cross_chapter_place_shift: "#0ea5e9",
  cross_chapter_causal_bridge: "#ef4444",
  entity_reappearance: "#8b5cf6",
}

const EDGE_ORDER: BookMemoryEdgeType[] = [
  "cross_chapter_causal_bridge",
  "cross_chapter_place_shift",
  "cross_chapter_same_place",
  "cross_chapter_character_thread",
  "entity_reappearance",
  "chapter_sequence",
]

function edgePriority(edge: BookMemoryEdge): number {
  return EDGE_ORDER.indexOf(edge.type)
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value
}

function chapterLabel(title: string, index: number): string {
  return `${index + 1}. ${truncate(title, 28)}`
}

function edgePath(x1: number, x2: number, baselineY: number, index: number): string {
  const distance = Math.abs(x2 - x1)
  const arcHeight = Math.min(150, 42 + distance * 0.18 + (index % 4) * 18)
  const controlX = (x1 + x2) / 2
  const controlY = baselineY - arcHeight
  return `M ${x1} ${baselineY} Q ${controlX} ${controlY} ${x2} ${baselineY}`
}

function edgeCountByType(edges: BookMemoryEdge[]): Array<[BookMemoryEdgeType, number]> {
  return EDGE_ORDER.map((type): [BookMemoryEdgeType, number] => [
    type,
    edges.filter((edge) => edge.type === type).length,
  ])
    .filter(([, count]) => count > 0)
}

function topThreads(threads: BookEntityThread[]): BookEntityThread[] {
  return [...threads]
    .sort((a, b) => b.chapters.length - a.chapters.length || b.totalMentions - a.totalMentions)
    .slice(0, 6)
}

export default function BookMemoryMap({ snapshot }: { snapshot: BookMemorySnapshot | null }) {
  const { locale } = useUiStrings()
  const copy = VISUALIZATION_STRINGS[locale].bookMap

  if (!snapshot) {
    return (
      <section className="rounded-2xl border border-dashed border-stone-300 bg-white px-5 py-8 text-center text-sm text-stone-500">
        {copy.empty}
      </section>
    )
  }

  const chapters = [...snapshot.chapters].sort((a, b) => a.chapterIndex - b.chapterIndex)
  const chapterIndexById = new Map(chapters.map((chapter, index) => [chapter.chapterId, index]))
  const visibleEdges = [...snapshot.edges]
    .sort((a, b) => edgePriority(a) - edgePriority(b) || b.weight - a.weight)
    .slice(0, 36)
  const width = Math.max(920, chapters.length * 142 + 120)
  const height = 300
  const baselineY = 218
  const xForIndex = (index: number) => 70 + index * 142

  return (
    <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
      <div className="border-b border-stone-200 bg-stone-50 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-stone-400">{copy.chapterLane}</p>
            <h3 className="mt-1 text-lg font-black text-stone-950">{copy.title}</h3>
            <p className="mt-1 max-w-4xl text-sm leading-6 text-stone-500">{copy.description}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {edgeCountByType(snapshot.edges).map(([type, count]) => (
              <span key={type} className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-semibold text-stone-600">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: EDGE_COLORS[type] }} />
                {copy.edgeTypeLabels[type]} {count}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto bg-[linear-gradient(#fff,#fff7ed)] px-4 py-4">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={copy.edgeArcMap}
          className="max-w-none"
        >
          <line
            x1={xForIndex(0)}
            y1={baselineY}
            x2={xForIndex(Math.max(0, chapters.length - 1))}
            y2={baselineY}
            stroke="#d6d3d1"
            strokeWidth={3}
            strokeLinecap="round"
          />

          {visibleEdges.map((edge, index) => {
            const fromIndex = chapterIndexById.get(edge.fromChapterId)
            const toIndex = chapterIndexById.get(edge.toChapterId)
            if (fromIndex === undefined || toIndex === undefined) return null
            const x1 = xForIndex(fromIndex)
            const x2 = xForIndex(toIndex)
            return (
              <path
                key={edge.edgeId}
                d={edgePath(x1, x2, baselineY - 10, index)}
                fill="none"
                stroke={EDGE_COLORS[edge.type]}
                strokeWidth={Math.max(1.5, 1.5 + edge.weight * 2)}
                strokeOpacity={edge.type === "chapter_sequence" ? 0.42 : 0.78}
              >
                <title>{`${copy.edgeTypeLabels[edge.type]}: ${edge.label}`}</title>
              </path>
            )
          })}

          {chapters.map((chapter, index) => {
            const x = xForIndex(index)
            return (
              <g key={chapter.chapterId}>
                <circle cx={x} cy={baselineY} r={15} fill="#ffffff" stroke="#292524" strokeWidth={2} />
                <text x={x} y={baselineY + 4} textAnchor="middle" className="fill-stone-900 text-[11px] font-black">
                  {index + 1}
                </text>
                <text x={x} y={baselineY + 34} textAnchor="middle" className="fill-stone-700 text-[11px] font-semibold">
                  {chapterLabel(chapter.chapterTitle, index)}
                </text>
                <text x={x} y={baselineY + 52} textAnchor="middle" className="fill-stone-400 text-[10px]">
                  {chapter.sceneCount} {copy.scenes} / {chapter.eventCount} {copy.events}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      <div className="border-t border-stone-200 bg-white px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="text-sm font-black text-stone-900">{copy.entityRibbons}</h4>
          <span className="text-xs text-stone-400">{snapshot.entityThreads.length} threads</span>
        </div>
        <div className="mt-3 grid gap-2">
          {topThreads(snapshot.entityThreads).map((thread) => (
            <EntityRibbon
              key={thread.threadId}
              thread={thread}
              chapters={chapters.map((chapter) => chapter.chapterId)}
              mentionLabel={copy.mentions}
            />
          ))}
          {snapshot.entityThreads.length === 0 && (
            <p className="rounded-xl border border-dashed border-stone-200 px-4 py-5 text-center text-sm text-stone-400">
              {copy.noThreads}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

function EntityRibbon({
  thread,
  chapters,
  mentionLabel,
}: {
  thread: BookEntityThread
  chapters: string[]
  mentionLabel: string
}) {
  const present = new Set(thread.chapters)
  return (
    <div className="grid gap-3 rounded-xl border border-stone-100 bg-stone-50 px-3 py-3 md:grid-cols-[220px_minmax(0,1fr)] md:items-center">
      <div className="min-w-0">
        <p className="truncate text-sm font-black text-stone-900">{thread.canonicalName}</p>
        <p className="mt-1 text-xs text-stone-500">{thread.totalMentions} {mentionLabel}</p>
      </div>
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
        {chapters.map((chapterId, index) => (
          <div key={`${thread.threadId}:${chapterId}`} className="flex items-center gap-1">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-black ${
                present.has(chapterId)
                  ? "bg-violet-600 text-white"
                  : "bg-white text-stone-300 ring-1 ring-stone-200"
              }`}
              title={chapterId}
            >
              {index + 1}
            </span>
            {index < chapters.length - 1 && (
              <span className={`h-px w-5 shrink-0 ${present.has(chapterId) ? "bg-violet-300" : "bg-stone-200"}`} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
