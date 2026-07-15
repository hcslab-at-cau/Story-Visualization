"use client"

import { useMemo, useState } from "react"
import V3BodyResultView, {
  type V3BodyHighlight,
  type V3BodySideItem,
} from "@/components/v3/V3BodyResultView"
import type { V3EvidenceCandidateType } from "@/lib/pipeline/v3-evidence-types"
import type {
  V3EvidenceRefinementArtifact,
  V3RefinedEvidenceStatus,
} from "@/lib/pipeline/v3-evidence-refinement-types"
import type { PreparedChapter } from "@/types/schema"

interface Props {
  preparedChapter: PreparedChapter
  artifact?: V3EvidenceRefinementArtifact
  running?: boolean
}

const STATUS_LABELS: Record<V3RefinedEvidenceStatus, string> = {
  kept_core: "Core",
  kept_context: "Context",
  corrected: "Corrected",
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

function refinedCandidateDetail(candidate: V3EvidenceRefinementArtifact["refined_candidates"][number]): string | undefined {
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
    candidate.rationale && `Reason: ${candidate.rationale}`,
  ].filter(Boolean) as string[]

  return fields.slice(0, 3).join(" / ") || undefined
}

export default function V3EvidenceRefinementStageView({
  preparedChapter,
  artifact,
  running,
}: Props) {
  const [statusFilter, setStatusFilter] = useState<V3RefinedEvidenceStatus | "all">("all")
  const candidates = useMemo(() => artifact?.refined_candidates ?? [], [artifact?.refined_candidates])
  const filteredCandidates = useMemo(
    () => candidates.filter((candidate) => statusFilter === "all" || candidate.status === statusFilter),
    [candidates, statusFilter],
  )
  const bodyHighlights = useMemo<V3BodyHighlight[]>(
    () => filteredCandidates.map((candidate) => ({
      id: candidate.refined_candidate_id,
      pid: candidate.pid,
      startChar: candidate.start_char,
      endChar: candidate.end_char,
      label: candidate.span,
      tone: candidate.candidate_type,
      title: `${TYPE_LABELS[candidate.candidate_type]} / ${STATUS_LABELS[candidate.status]} / ${candidate.span}`,
    })),
    [filteredCandidates],
  )
  const bodySideItems = useMemo<V3BodySideItem[]>(
    () => filteredCandidates.map((candidate) => ({
      id: candidate.refined_candidate_id,
      pid: candidate.pid,
      title: candidate.span,
      label: TYPE_LABELS[candidate.candidate_type],
      tone: candidate.candidate_type,
      detail: refinedCandidateDetail(candidate),
      meta: [
        STATUS_LABELS[candidate.status],
        candidate.source_candidate_ids.length > 1 ? `${candidate.source_candidate_ids.length} merged` : "single",
        `${candidate.start_char}-${candidate.end_char}`,
      ],
    })),
    [filteredCandidates],
  )

  if (!artifact) {
    return (
      <EmptyState
        title={running ? "EVID.2 is running" : "No EVID.2 result yet"}
        body="Run EVID.2 after EVID.1A-D to conservatively merge and clean candidates before event grouping."
      />
    )
  }

  return (
    <div className="grid min-h-0 gap-5 2xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="min-h-0 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">EVID.2</p>
            <h2 className="mt-1 text-lg font-semibold text-zinc-950">Refined evidence on text</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {(["all", "kept_core", "kept_context", "corrected"] as const).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter(status)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                  statusFilter === status ? "bg-zinc-900 text-white" : "bg-white text-zinc-600 hover:bg-zinc-100"
                }`}
              >
                {status === "all" ? "All" : STATUS_LABELS[status]}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 max-h-[68vh] overflow-y-auto pr-1">
          <V3BodyResultView
            paragraphs={preparedChapter.raw_chapter.paragraphs}
            highlights={bodyHighlights}
            sideItems={bodySideItems}
            emptyTitle="No refined candidates match this filter."
            emptyBody="Switch the status filter or rerun EVID.2 to inspect refined evidence on top of the source text."
          />
        </div>
      </section>

      <aside className="space-y-3">
        <div className="grid grid-cols-3 gap-2 2xl:grid-cols-1">
          <StatBlock label="Input" value={String(artifact.refinement_stats.input_candidates)} />
          <StatBlock label="Refined" value={String(artifact.refinement_stats.refined_candidates)} />
          <StatBlock label="Rejected" value={String(artifact.refinement_stats.rejected_candidates)} />
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Statuses</p>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Core</dt>
              <dd className="font-mono text-zinc-800">{artifact.refinement_stats.kept_core}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Context</dt>
              <dd className="font-mono text-zinc-800">{artifact.refinement_stats.kept_context}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Corrected</dt>
              <dd className="font-mono text-zinc-800">{artifact.refinement_stats.corrected}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Merged sources</dt>
              <dd className="font-mono text-zinc-800">{artifact.refinement_stats.merged_sources}</dd>
            </div>
          </dl>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Rejected reasons</p>
          <dl className="mt-3 space-y-2 text-sm">
            {Object.entries(artifact.refinement_stats.rejected_by_reason)
              .filter(([, count]) => count > 0)
              .map(([reason, count]) => (
                <div key={reason} className="flex justify-between gap-4">
                  <dt className="text-zinc-500">{reason}</dt>
                  <dd className="font-mono text-zinc-800">{count}</dd>
                </div>
              ))}
          </dl>
        </div>
      </aside>
    </div>
  )
}
