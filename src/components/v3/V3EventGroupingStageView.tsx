"use client"

import { useMemo, useState } from "react"
import V3BodyResultView, {
  type V3BodyHighlight,
  type V3BodySideItem,
} from "@/components/v3/V3BodyResultView"
import type { V3EvidenceCandidateType } from "@/lib/pipeline/v3-evidence-types"
import type {
  V3EventCandidate,
  V3EventEvidenceOccurrence,
  V3EventGroupingArtifact,
  V3EventGroupingSource,
} from "@/lib/pipeline/v3-event-types"
import type { PreparedChapter } from "@/types/schema"

interface Props {
  preparedChapter: PreparedChapter
  artifact?: V3EventGroupingArtifact
  running?: boolean
}

const SOURCE_LABELS: Record<V3EventGroupingSource, string> = {
  llm: "LLM",
  fallback_action: "Fallback",
}

const TYPE_LABELS: Record<V3EvidenceCandidateType, string> = {
  cast: "CAST",
  place: "PLACE",
  time: "TIME",
  object: "OBJECT",
  action: "ACTION",
  goal: "GOAL",
  causality: "CAUSAL",
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

function pidsInRange(startPid: number, endPid: number): number[] {
  const first = Math.min(startPid, endPid)
  const last = Math.max(startPid, endPid)
  const pids: number[] = []
  for (let pid = first; pid <= last; pid += 1) pids.push(pid)
  return pids
}

function eventEvidenceSummary(event: V3EventCandidate): string {
  const counts = [
    { label: "Cast", count: event.cast_ids.length },
    { label: "Place", count: event.place_ids.length },
    { label: "Time", count: event.time_ids.length },
    { label: "Object", count: event.object_ids.length },
    { label: "Goal", count: event.goal_ids.length },
    { label: "Cause", count: event.causality_ids.length },
  ].filter((item) => item.count > 0)

  return counts.map((item) => `${item.label} ${item.count}`).join(" / ") || "Action only"
}

function occurrenceLabel(occurrence: V3EventEvidenceOccurrence): string {
  return occurrence.entity_cluster_label ?? occurrence.normalized ?? occurrence.label ?? occurrence.span
}

export default function V3EventGroupingStageView({ preparedChapter, artifact, running }: Props) {
  const [sourceFilter, setSourceFilter] = useState<V3EventGroupingSource | "all">("all")
  const events = useMemo(() => artifact?.event_candidates ?? [], [artifact?.event_candidates])
  const filteredEvents = useMemo(
    () => events.filter((event) => sourceFilter === "all" || event.grouping_source === sourceFilter),
    [events, sourceFilter],
  )
  const occurrenceById = useMemo(
    () => new Map((artifact?.evidence_occurrences ?? []).map((occurrence) => [occurrence.source_candidate_id, occurrence])),
    [artifact?.evidence_occurrences],
  )
  const bodyHighlights = useMemo<V3BodyHighlight[]>(
    () => filteredEvents.flatMap((event) =>
      event.evidence_ids.flatMap((evidenceId) => {
        const occurrence = occurrenceById.get(evidenceId)
        if (!occurrence) return []

        return [{
          id: `${event.event_id}-${occurrence.source_candidate_id}`,
          pid: occurrence.pid,
          startChar: occurrence.start_char,
          endChar: occurrence.end_char,
          label: occurrenceLabel(occurrence),
          tone: occurrence.candidate_type,
          title: `E${event.sequence_index} / ${TYPE_LABELS[occurrence.candidate_type]} / ${occurrenceLabel(occurrence)}`,
        }]
      }),
    ),
    [filteredEvents, occurrenceById],
  )
  const bodySideItems = useMemo<V3BodySideItem[]>(
    () => filteredEvents.flatMap((event) =>
      pidsInRange(event.start_pid, event.end_pid).map((pid) => ({
        id: `${event.event_id}-p${pid}`,
        pid,
        title: event.summary,
        label: `E${event.sequence_index}`,
        tone: "event",
        detail: `${eventEvidenceSummary(event)} / ${event.evidence_ids.length} evidence`,
        meta: [SOURCE_LABELS[event.grouping_source], `P${event.start_pid}-${event.end_pid}`],
      })),
    ),
    [filteredEvents],
  )

  if (!artifact) {
    return (
      <EmptyState
        title={running ? "EVENT.1 is running" : "No EVENT.1 result yet"}
        body="Run EVENT.1 after EVID.4 to group action-centered evidence into event candidates."
      />
    )
  }

  return (
    <div className="grid min-h-0 gap-5 2xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="min-h-0 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">EVENT.1</p>
            <h2 className="mt-1 text-lg font-semibold text-zinc-950">Event candidates on text</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {(["all", "llm", "fallback_action"] as const).map((source) => (
              <button
                key={source}
                type="button"
                onClick={() => setSourceFilter(source)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                  sourceFilter === source ? "bg-zinc-900 text-white" : "bg-white text-zinc-600 hover:bg-zinc-100"
                }`}
              >
                {source === "all" ? "All" : SOURCE_LABELS[source]}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 max-h-[68vh] overflow-y-auto pr-1">
          <V3BodyResultView
            paragraphs={preparedChapter.raw_chapter.paragraphs}
            highlights={bodyHighlights}
            sideItems={bodySideItems}
            emptyTitle="No events match this filter."
            emptyBody="Switch the source filter or rerun EVENT.1 to inspect event candidates on the source text."
          />
        </div>
      </section>

      <aside className="space-y-3">
        <div className="grid grid-cols-3 gap-2 2xl:grid-cols-1">
          <StatBlock label="Events" value={String(artifact.event_stats.event_candidates)} />
          <StatBlock label="Actions" value={String(artifact.event_stats.action_anchors)} />
          <StatBlock label="Fallback" value={String(artifact.event_stats.fallback_events)} />
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Coverage</p>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Input occurrences</dt>
              <dd className="font-mono text-zinc-800">{artifact.event_stats.input_occurrences}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Paragraphs covered</dt>
              <dd className="font-mono text-zinc-800">{artifact.event_stats.paragraphs_covered}</dd>
            </div>
          </dl>
        </div>
      </aside>
    </div>
  )
}
