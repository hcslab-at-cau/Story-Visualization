"use client"

import { useMemo, useState } from "react"
import V3BodyResultView, {
  type V3BodyHighlight,
  type V3BodySideItem,
} from "@/components/v3/V3BodyResultView"
import type { ContentUnits, MentionType, PreparedChapter } from "@/types/schema"
import type {
  SceneBoundaryMentionRole,
  SceneBoundaryRelevance,
  V3MentionCandidates,
  V3SceneMention,
} from "@/lib/pipeline/v3-mention-normalization"

type MentionFilter = "all" | "direct" | "contextual" | MentionType

interface Props {
  preparedChapter: PreparedChapter
  contentUnits?: ContentUnits
  mentionCandidates?: V3MentionCandidates
  running?: boolean
}

const FILTERS: Array<{ key: MentionFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "direct", label: "Direct" },
  { key: "contextual", label: "Contextual" },
  { key: "cast", label: "Cast" },
  { key: "place", label: "Place" },
  { key: "time", label: "Time" },
]

const TYPE_CLASSES: Record<MentionType, string> = {
  cast: "bg-rose-50 text-rose-700 ring-rose-200",
  place: "bg-sky-50 text-sky-700 ring-sky-200",
  time: "bg-amber-50 text-amber-700 ring-amber-200",
}

const RELEVANCE_CLASSES: Record<SceneBoundaryRelevance, string> = {
  direct: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  contextual: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  excluded: "bg-red-50 text-red-700 ring-red-200",
}

const ROLE_LABELS: Record<SceneBoundaryMentionRole, string> = {
  on_stage: "On-stage",
  mentioned_only: "Mentioned",
  imagined_or_hypothetical: "Imagined",
  narrator_addressed: "Addressed",
  spatial_container: "Container",
  object_or_prop: "Object",
  story_time_frame: "Time frame",
  time_expression: "Time expr.",
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-10 text-center">
      <div>
        <h3 className="text-sm font-semibold text-zinc-800">{title}</h3>
        <p className="mt-2 max-w-md text-sm leading-6 text-zinc-500">{body}</p>
      </div>
    </div>
  )
}

function StatBlock({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-zinc-950">{value}</p>
      {detail && <p className="mt-1 text-xs text-zinc-500">{detail}</p>}
    </div>
  )
}

function relevanceLabel(relevance: SceneBoundaryRelevance): string {
  if (relevance === "direct") return "Direct"
  if (relevance === "contextual") return "Contextual"
  return "Excluded"
}

function roleCountEntries(mentions: V3SceneMention[]) {
  const counts = new Map<SceneBoundaryMentionRole, number>()
  for (const mention of mentions) {
    counts.set(mention.scene_role, (counts.get(mention.scene_role) ?? 0) + 1)
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
}

function filterMention(mention: V3SceneMention, filter: MentionFilter): boolean {
  if (filter === "all") return true
  if (filter === "direct") return mention.boundary_relevance === "direct"
  if (filter === "contextual") return mention.boundary_relevance === "contextual"
  return mention.mention_type === filter
}

function mentionDetail(mention: V3SceneMention): string | undefined {
  const fields = [
    ROLE_LABELS[mention.scene_role],
    mention.normalized && `Norm: ${mention.normalized}`,
    mention.rationale && `Reason: ${mention.rationale}`,
  ].filter(Boolean) as string[]

  return fields.join(" / ") || undefined
}

export default function V3MentionStageView({
  preparedChapter,
  mentionCandidates,
  running,
}: Props) {
  const [filter, setFilter] = useState<MentionFilter>("all")
  const mentions = useMemo(() => mentionCandidates?.mentions ?? [], [mentionCandidates])
  const filteredMentions = useMemo(
    () => mentions.filter((mention) => filterMention(mention, filter)),
    [filter, mentions],
  )
  const bodyHighlights = useMemo<V3BodyHighlight[]>(
    () => filteredMentions.flatMap((mention) => {
      if (
        typeof mention.start_char !== "number" ||
        typeof mention.end_char !== "number"
      ) {
        return []
      }

      return [{
        id: mention.mention_id,
        pid: mention.pid,
        startChar: mention.start_char,
        endChar: mention.end_char,
        label: mention.span,
        tone: mention.mention_type,
        title: `${mention.mention_type.toUpperCase()} / ${relevanceLabel(mention.boundary_relevance)} / ${mention.span}`,
      }]
    }),
    [filteredMentions],
  )
  const bodySideItems = useMemo<V3BodySideItem[]>(
    () => filteredMentions.map((mention) => ({
      id: mention.mention_id,
      pid: mention.pid,
      title: mention.span,
      label: mention.mention_type.toUpperCase(),
      tone: mention.mention_type,
      detail: mentionDetail(mention),
      meta: [relevanceLabel(mention.boundary_relevance), ROLE_LABELS[mention.scene_role]],
    })),
    [filteredMentions],
  )

  if (!mentionCandidates) {
    return (
      <EmptyState
        title={running ? "ENT.1 is running" : "No ENT.1 result yet"}
        body="Run ENT.1 after PRE.2 to extract scene-boundary-oriented CAST, PLACE, and TIME mentions."
      />
    )
  }

  const directCount = mentions.filter((mention) => mention.boundary_relevance === "direct").length
  const contextualCount = mentions.filter((mention) => mention.boundary_relevance === "contextual").length
  const computedTypeCounts = mentions.reduce(
    (counts, mention) => ({ ...counts, [mention.mention_type]: counts[mention.mention_type] + 1 }),
    { cast: 0, place: 0, time: 0 } as Record<MentionType, number>,
  )
  const typeCounts = mentionCandidates.extraction_stats.by_type ?? computedTypeCounts
  const droppedCount = mentionCandidates.dropped_mentions?.length ?? 0
  const roles = roleCountEntries(mentions)

  return (
    <div className="grid min-h-0 gap-5 2xl:grid-cols-[minmax(0,1fr)_400px]">
      <section className="min-h-0 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Scene mention evidence</p>
            <h2 className="mt-1 text-lg font-semibold text-zinc-950">{preparedChapter.chapter_title}</h2>
          </div>
          <div className="flex flex-wrap rounded-lg border border-zinc-200 bg-white p-1">
            {FILTERS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setFilter(item.key)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  filter === item.key
                    ? "bg-zinc-900 text-white"
                    : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 max-h-[68vh] overflow-y-auto pr-1">
          <V3BodyResultView
            paragraphs={preparedChapter.raw_chapter.paragraphs}
            highlights={bodyHighlights}
            sideItems={bodySideItems}
            emptyTitle="No mentions match this filter."
            emptyBody="Switch the mention filter or rerun ENT.1 to inspect mention spans on top of the source text."
          />
        </div>
      </section>

      <aside className="min-h-0 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <StatBlock label="Mentions" value={String(mentions.length)} />
          <StatBlock label="Direct" value={String(directCount)} detail={`${contextualCount} contextual`} />
          <StatBlock label="Cast" value={String(typeCounts.cast)} />
          <StatBlock label="Place/Time" value={`${typeCounts.place}/${typeCounts.time}`} />
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Boundary roles</p>
            <span className="text-xs text-zinc-400">{mentionCandidates.model ?? "model unknown"}</span>
          </div>
          <div className="mt-3 space-y-2">
            {roles.map(([role, count]) => (
              <div key={role} className="flex items-center justify-between gap-3 rounded-md bg-zinc-50 px-3 py-2">
                <span className="text-sm font-medium text-zinc-800">{ROLE_LABELS[role]}</span>
                <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-zinc-600">
                  {count}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Mention list</p>
          <div className="mt-3 max-h-[34vh] space-y-2 overflow-y-auto pr-1">
            {filteredMentions.map((mention) => (
              <div key={mention.mention_id} className="rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] text-zinc-400">P{mention.pid}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${TYPE_CLASSES[mention.mention_type]}`}>
                    {mention.mention_type}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${RELEVANCE_CLASSES[mention.boundary_relevance]}`}>
                    {relevanceLabel(mention.boundary_relevance)}
                  </span>
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-zinc-600">
                    {ROLE_LABELS[mention.scene_role]}
                  </span>
                </div>
                <p className="mt-2 text-sm font-medium text-zinc-900">{mention.span}</p>
                {mention.normalized && <p className="mt-1 text-xs text-zinc-500">{mention.normalized}</p>}
                {mention.rationale && (
                  <details className="mt-1 text-xs text-zinc-500">
                    <summary className="cursor-pointer select-none font-medium text-zinc-500">Rationale</summary>
                    <p className="mt-1 leading-5">{mention.rationale}</p>
                  </details>
                )}
              </div>
            ))}
          </div>
        </div>

        {droppedCount > 0 && (
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Excluded candidates</p>
            <p className="mt-1 text-sm text-zinc-600">{droppedCount} candidates kept out of the v3 mention set.</p>
          </div>
        )}
      </aside>
    </div>
  )
}
