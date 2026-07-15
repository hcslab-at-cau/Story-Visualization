"use client"

import { useMemo, useState } from "react"
import V3BodyResultView, {
  type V3BodyHighlight,
  type V3BodySideItem,
} from "@/components/v3/V3BodyResultView"
import {
  evidencePassConfig,
  isV3EvidenceCandidateType,
  type V3EvidenceArtifact,
  type V3EvidenceCandidate,
  type V3EvidenceCandidateType,
  type V3EvidencePassId,
} from "@/lib/pipeline/v3-evidence-types"
import type { ContentUnits, PreparedChapter } from "@/types/schema"

const TYPE_META: Record<V3EvidenceCandidateType, { label: string; pillClass: string }> = {
  cast: {
    label: "CAST",
    pillClass: "bg-sky-50 text-sky-700",
  },
  place: {
    label: "PLACE",
    pillClass: "bg-emerald-50 text-emerald-700",
  },
  time: {
    label: "TIME",
    pillClass: "bg-amber-50 text-amber-700",
  },
  object: {
    label: "OBJECT",
    pillClass: "bg-stone-100 text-stone-700",
  },
  action: {
    label: "ACTION",
    pillClass: "bg-rose-50 text-rose-700",
  },
  goal: {
    label: "GOAL",
    pillClass: "bg-violet-50 text-violet-700",
  },
  causality: {
    label: "CAUSAL",
    pillClass: "bg-cyan-50 text-cyan-700",
  },
}

interface Props {
  preparedChapter: PreparedChapter
  contentUnits?: ContentUnits
  artifact?: V3EvidenceArtifact
  activeStage: V3EvidencePassId
  running?: boolean
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

function candidateDetail(candidate: V3EvidenceCandidate): string | undefined {
  const fields = [
    candidate.normalized && `Norm: ${candidate.normalized}`,
    candidate.label && `Label: ${candidate.label}`,
    candidate.subject_hint && `Subject: ${candidate.subject_hint}`,
    candidate.object_hint && `Object: ${candidate.object_hint}`,
    candidate.owner_span && `Owner: ${candidate.owner_span}`,
    candidate.target_span && `Target: ${candidate.target_span}`,
    candidate.goal_text && `Goal: ${candidate.goal_text}`,
    candidate.cause_text && `Cause: ${candidate.cause_text}`,
    candidate.effect_text && `Effect: ${candidate.effect_text}`,
    candidate.rationale && `Note: ${candidate.rationale}`,
  ].filter(Boolean) as string[]

  return fields.slice(0, 3).join(" / ") || undefined
}

export default function V3EvidenceStageView({
  preparedChapter,
  contentUnits,
  artifact,
  activeStage,
  running,
}: Props) {
  const [typeFilter, setTypeFilter] = useState<V3EvidenceCandidateType | "all">("all")
  const passTitle = evidencePassConfig(activeStage).title
  const candidates = useMemo(() => artifact?.candidates ?? [], [artifact?.candidates])
  const availableTypes = useMemo(
    () => Array.from(new Set(candidates.map((candidate) => candidate.candidate_type)))
      .filter(isV3EvidenceCandidateType),
    [candidates],
  )
  const filteredCandidates = useMemo(
    () => candidates.filter((candidate) => typeFilter === "all" || candidate.candidate_type === typeFilter),
    [candidates, typeFilter],
  )
  const bodyHighlights = useMemo<V3BodyHighlight[]>(
    () => filteredCandidates.map((candidate) => ({
      id: candidate.candidate_id,
      pid: candidate.pid,
      startChar: candidate.start_char,
      endChar: candidate.end_char,
      label: candidate.span,
      tone: candidate.candidate_type,
      title: `${TYPE_META[candidate.candidate_type].label} / ${candidate.span}`,
    })),
    [filteredCandidates],
  )
  const bodySideItems = useMemo<V3BodySideItem[]>(
    () => filteredCandidates.map((candidate) => ({
      id: candidate.candidate_id,
      pid: candidate.pid,
      title: candidate.span,
      label: TYPE_META[candidate.candidate_type].label,
      tone: candidate.candidate_type,
      detail: candidateDetail(candidate),
      meta: [candidate.source_pass, `${candidate.start_char}-${candidate.end_char}`],
    })),
    [filteredCandidates],
  )

  if (!contentUnits) {
    return (
      <EmptyState
        title="No PRE.2 result yet"
        body="Run PRE.2 first so evidence extraction only sees narrative story paragraphs."
      />
    )
  }

  if (!artifact) {
    return (
      <EmptyState
        title={running ? `${activeStage} is running` : `No ${activeStage} result yet`}
        body="Run this evidence pass to create candidate records and inspect the extracted spans here."
      />
    )
  }

  return (
    <div className="grid min-h-0 gap-5 2xl:grid-cols-[minmax(0,1fr)_420px]">
      <section className="min-h-0 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{artifact.pass_id}</p>
            <h2 className="mt-1 text-lg font-semibold text-zinc-950">{passTitle} on text</h2>
            <p className="mt-1 truncate text-xs text-zinc-500">{preparedChapter.chapter_title}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setTypeFilter("all")}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                typeFilter === "all" ? "bg-zinc-900 text-white" : "bg-white text-zinc-600 hover:bg-zinc-100"
              }`}
            >
              All
            </button>
            {availableTypes.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setTypeFilter(type)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                  typeFilter === type ? "bg-zinc-900 text-white" : "bg-white text-zinc-600 hover:bg-zinc-100"
                }`}
              >
                {TYPE_META[type].label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 max-h-[68vh] overflow-y-auto pr-1">
          <V3BodyResultView
            paragraphs={preparedChapter.raw_chapter.paragraphs}
            highlights={bodyHighlights}
            sideItems={bodySideItems}
            emptyTitle="No candidates match this filter."
            emptyBody="Switch the evidence filter or rerun this pass to inspect candidate spans on top of the source text."
          />
        </div>
      </section>

      <aside className="min-h-0 space-y-3">
        <div className="grid grid-cols-3 gap-2 2xl:grid-cols-1">
          <StatBlock label="Accepted" value={String(artifact.extraction_stats.accepted_candidates)} />
          <StatBlock label="Dropped" value={String(artifact.extraction_stats.dropped_candidates)} />
          <StatBlock label="Paragraphs" value={String(artifact.extraction_stats.narrative_paragraphs)} />
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Types</p>
            <span className="text-xs text-zinc-400">{artifact.model ?? "model unknown"}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(artifact.extraction_stats.by_type).map(([type, count]) => (
              isV3EvidenceCandidateType(type) && (
                <span
                  key={type}
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_META[type].pillClass}`}
                >
                  {TYPE_META[type].label} {count}
                </span>
              )
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Top labels</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(artifact.extraction_stats.by_label)
              .filter(([, count]) => count > 0)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 12)
              .map(([label, count]) => (
                <span key={label} className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">
                  {label} {count}
                </span>
              ))}
          </div>
        </div>
      </aside>
    </div>
  )
}
