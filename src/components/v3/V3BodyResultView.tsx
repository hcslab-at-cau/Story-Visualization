import type { ReactNode } from "react"
import {
  buildBodySegments,
  type V3BodyHighlight,
  type V3BodyResultTone,
} from "@/components/v3/v3-body-result-utils"

export type { V3BodyHighlight, V3BodyResultTone } from "@/components/v3/v3-body-result-utils"

export interface V3BodyParagraph {
  pid: number
  text: string
}

export interface V3BodySideItem {
  id: string
  pid: number
  title: string
  label: string
  tone: V3BodyResultTone
  detail?: string
  meta?: string[]
}

interface V3BodyResultViewProps {
  paragraphs: V3BodyParagraph[]
  highlights?: V3BodyHighlight[]
  sideItems?: V3BodySideItem[]
  emptyTitle: string
  emptyBody: string
  maxSideItemsPerParagraph?: number
}

const TONE_META: Record<V3BodyResultTone, {
  markClass: string
  pillClass: string
  cardClass: string
  railClass: string
}> = {
  cast: {
    markClass: "bg-sky-100 text-sky-950 ring-sky-200",
    pillClass: "bg-sky-50 text-sky-700 ring-sky-200",
    cardClass: "border-sky-100 bg-sky-50/55",
    railClass: "border-l-sky-300",
  },
  place: {
    markClass: "bg-emerald-100 text-emerald-950 ring-emerald-200",
    pillClass: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    cardClass: "border-emerald-100 bg-emerald-50/55",
    railClass: "border-l-emerald-300",
  },
  time: {
    markClass: "bg-amber-100 text-amber-950 ring-amber-200",
    pillClass: "bg-amber-50 text-amber-700 ring-amber-200",
    cardClass: "border-amber-100 bg-amber-50/60",
    railClass: "border-l-amber-300",
  },
  object: {
    markClass: "bg-stone-200 text-stone-950 ring-stone-300",
    pillClass: "bg-stone-100 text-stone-700 ring-stone-200",
    cardClass: "border-stone-200 bg-stone-50",
    railClass: "border-l-stone-300",
  },
  action: {
    markClass: "bg-rose-100 text-rose-950 ring-rose-200",
    pillClass: "bg-rose-50 text-rose-700 ring-rose-200",
    cardClass: "border-rose-100 bg-rose-50/55",
    railClass: "border-l-rose-300",
  },
  goal: {
    markClass: "bg-violet-100 text-violet-950 ring-violet-200",
    pillClass: "bg-violet-50 text-violet-700 ring-violet-200",
    cardClass: "border-violet-100 bg-violet-50/55",
    railClass: "border-l-violet-300",
  },
  causality: {
    markClass: "bg-cyan-100 text-cyan-950 ring-cyan-200",
    pillClass: "bg-cyan-50 text-cyan-700 ring-cyan-200",
    cardClass: "border-cyan-100 bg-cyan-50/55",
    railClass: "border-l-cyan-300",
  },
  event: {
    markClass: "bg-indigo-100 text-indigo-950 ring-indigo-200",
    pillClass: "bg-indigo-50 text-indigo-700 ring-indigo-200",
    cardClass: "border-indigo-100 bg-indigo-50/55",
    railClass: "border-l-indigo-300",
  },
  scene: {
    markClass: "bg-fuchsia-100 text-fuchsia-950 ring-fuchsia-200",
    pillClass: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200",
    cardClass: "border-fuchsia-100 bg-fuchsia-50/55",
    railClass: "border-l-fuchsia-300",
  },
  neutral: {
    markClass: "bg-zinc-100 text-zinc-950 ring-zinc-200",
    pillClass: "bg-zinc-100 text-zinc-700 ring-zinc-200",
    cardClass: "border-zinc-200 bg-zinc-50",
    railClass: "border-l-zinc-300",
  },
}

function groupByPid<T extends { pid: number }>(items: T[]): Map<number, T[]> {
  const grouped = new Map<number, T[]>()
  for (const item of items) {
    const current = grouped.get(item.pid) ?? []
    current.push(item)
    grouped.set(item.pid, current)
  }
  return grouped
}

function renderTextWithHighlights(text: string, highlights: V3BodyHighlight[]): ReactNode {
  return buildBodySegments(text, highlights).map((segment, index) => {
    if (segment.kind === "text") {
      return <span key={`text-${index}`}>{segment.text}</span>
    }

    return (
      <mark
        key={`${segment.highlight.id}-${index}`}
        className={`rounded px-1 py-0.5 ring-1 ring-inset ${TONE_META[segment.highlight.tone].markClass}`}
        title={segment.highlight.title ?? segment.highlight.label}
      >
        {segment.text}
      </mark>
    )
  })
}

function SideItem({ item }: { item: V3BodySideItem }) {
  const tone = TONE_META[item.tone]

  return (
    <li className={`rounded-md border px-3 py-2 ${tone.cardClass}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ring-1 ${tone.pillClass}`}>
          {item.label}
        </span>
        {item.meta?.slice(0, 2).map((meta) => (
          <span key={meta} className="rounded-full bg-white/75 px-2 py-0.5 text-[10px] text-zinc-500 ring-1 ring-zinc-200">
            {meta}
          </span>
        ))}
      </div>
      <p className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-zinc-950">{item.title}</p>
      {item.detail && <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-zinc-600">{item.detail}</p>}
    </li>
  )
}

export default function V3BodyResultView({
  paragraphs,
  highlights = [],
  sideItems = [],
  emptyTitle,
  emptyBody,
  maxSideItemsPerParagraph = 8,
}: V3BodyResultViewProps) {
  const highlightsByPid = groupByPid(highlights)
  const sideItemsByPid = groupByPid(sideItems)
  const visibleParagraphs = paragraphs.filter((paragraph) =>
    highlightsByPid.has(paragraph.pid) || sideItemsByPid.has(paragraph.pid),
  )

  if (visibleParagraphs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-10 text-center">
        <p className="text-sm font-semibold text-zinc-800">{emptyTitle}</p>
        <p className="mt-2 text-sm leading-6 text-zinc-500">{emptyBody}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {visibleParagraphs.map((paragraph) => {
        const paragraphHighlights = highlightsByPid.get(paragraph.pid) ?? []
        const paragraphSideItems = sideItemsByPid.get(paragraph.pid) ?? []
        const firstTone = paragraphSideItems[0]?.tone ?? paragraphHighlights[0]?.tone ?? "neutral"
        const visibleSideItems = paragraphSideItems.slice(0, maxSideItemsPerParagraph)
        const hiddenSideItemCount = Math.max(0, paragraphSideItems.length - visibleSideItems.length)

        return (
          <article
            key={paragraph.pid}
            className={`grid gap-3 rounded-lg border border-l-4 border-zinc-200 bg-white px-4 py-3 xl:grid-cols-[minmax(0,1fr)_270px] ${TONE_META[firstTone].railClass}`}
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] text-zinc-400">P{paragraph.pid}</span>
                {paragraphHighlights.length > 0 && (
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600">
                    {paragraphHighlights.length} spans
                  </span>
                )}
                {paragraphSideItems.length > 0 && (
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-zinc-500 ring-1 ring-zinc-200">
                    {paragraphSideItems.length} notes
                  </span>
                )}
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-zinc-800">
                {renderTextWithHighlights(paragraph.text, paragraphHighlights)}
              </p>
            </div>

            {paragraphSideItems.length > 0 && (
              <aside className="border-t border-zinc-100 pt-3 xl:border-l xl:border-t-0 xl:pl-3 xl:pt-0">
                <ul className="space-y-2">
                  {visibleSideItems.map((item) => (
                    <SideItem key={item.id} item={item} />
                  ))}
                </ul>
                {hiddenSideItemCount > 0 && (
                  <p className="mt-2 rounded-md bg-zinc-100 px-3 py-2 text-xs text-zinc-500">
                    +{hiddenSideItemCount} more notes in this paragraph
                  </p>
                )}
              </aside>
            )}
          </article>
        )
      })}
    </div>
  )
}
