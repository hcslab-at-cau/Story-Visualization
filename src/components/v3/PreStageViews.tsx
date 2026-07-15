"use client"

import { useMemo, useState } from "react"
import type { ContentUnits, PreparedChapter } from "@/types/schema"
import type { V3MentionCandidates } from "@/lib/pipeline/v3-mention-normalization"
import {
  isV3EvidencePassId,
  type V3EvidenceArtifact,
  type V3EvidencePassId,
} from "@/lib/pipeline/v3-evidence-types"
import type {
  V3EvidenceClusteringArtifact,
  V3EvidenceClusteringStageId,
} from "@/lib/pipeline/v3-evidence-clustering-types"
import type {
  V3EvidenceGateArtifact,
  V3EvidenceGateStageId,
} from "@/lib/pipeline/v3-evidence-gate-types"
import type {
  V3EvidenceRefinementArtifact,
  V3EvidenceRefinementStageId,
} from "@/lib/pipeline/v3-evidence-refinement-types"
import type {
  V3EventGroupingArtifact,
  V3EventGroupingStageId,
} from "@/lib/pipeline/v3-event-types"
import type {
  V3MemoryContractArtifact,
  V3MemoryContractStageId,
} from "@/lib/pipeline/v3-memory-contract-types"
import type {
  V3EventFramesArtifact,
  V3EventFrameStageId,
  V3SceneSituationCardsArtifact,
  V3SceneSituationStageId,
} from "@/lib/pipeline/v3-memory-frames-types"
import type {
  V3CausalEdgesArtifact,
  V3CausalEdgeStageId,
  V3GoalGroundingArtifact,
  V3GoalGroundingStageId,
  V3ProgressiveMemoryStageId,
  V3ProgressiveNarrativeMemoryArtifact,
  V3RetrievalIndexArtifact,
  V3RetrievalIndexStageId,
} from "@/lib/pipeline/v3-narrative-memory-types"
import type {
  V3SceneGroupingArtifact,
  V3SceneGroupingStageId,
} from "@/lib/pipeline/v3-scene-types"
import V3EvidenceRefinementStageView from "@/components/v3/V3EvidenceRefinementStageView"
import V3EvidenceGateStageView from "@/components/v3/V3EvidenceGateStageView"
import V3EvidenceClusteringStageView from "@/components/v3/V3EvidenceClusteringStageView"
import V3EvidenceStageView from "@/components/v3/V3EvidenceStageView"
import V3EventGroupingStageView from "@/components/v3/V3EventGroupingStageView"
import V3MentionStageView from "@/components/v3/V3MentionStageView"
import V3SceneGroupingStageView from "@/components/v3/V3SceneGroupingStageView"
import V3MemoryContractStageView from "@/components/v3/V3MemoryContractStageView"
import V3SceneCardsStageView from "@/components/v3/V3SceneCardsStageView"
import V3EventFramesStageView from "@/components/v3/V3EventFramesStageView"
import V3GoalGroundingStageView from "@/components/v3/V3GoalGroundingStageView"
import V3CausalEdgesStageView from "@/components/v3/V3CausalEdgesStageView"
import V3ProgressiveMemoryStageView from "@/components/v3/V3ProgressiveMemoryStageView"
import V3RetrievalIndexStageView from "@/components/v3/V3RetrievalIndexStageView"
import V3SemanticIndexStageView from "@/components/v3/V3SemanticIndexStageView"
import type {
  V3SemanticIndexArtifact,
  V3SemanticIndexStageId,
} from "@/lib/pipeline/v3-semantic-index-types"
import {
  CONTENT_TYPE_META,
  CONTENT_TYPE_ORDER,
  filterParagraphs,
  summarizeContentUnits,
  unitByPid,
  type ParagraphFilter,
  type PreContentType,
  type PreContentUnit,
  type PreParagraph,
} from "@/components/v3/pre-stage-utils"

interface Props {
  preparedChapter?: PreparedChapter
  contentUnits?: ContentUnits
  evidenceArtifacts?: Partial<Record<"evid1a" | "evid1b" | "evid1c" | "evid1d", V3EvidenceArtifact>>
  evidenceRefinement?: V3EvidenceRefinementArtifact
  evidenceGate?: V3EvidenceGateArtifact
  evidenceClustering?: V3EvidenceClusteringArtifact
  eventGrouping?: V3EventGroupingArtifact
  sceneGrouping?: V3SceneGroupingArtifact
  memoryContract?: V3MemoryContractArtifact
  sceneCards?: V3SceneSituationCardsArtifact
  eventFrames?: V3EventFramesArtifact
  groundedGoals?: V3GoalGroundingArtifact
  causalEdges?: V3CausalEdgesArtifact
  progressiveMemory?: V3ProgressiveNarrativeMemoryArtifact
  retrievalIndex?: V3RetrievalIndexArtifact
  semanticIndex?: V3SemanticIndexArtifact
  mentionCandidates?: V3MentionCandidates
  activeStage: "PRE.1" | "PRE.2" | V3EvidencePassId | V3EvidenceRefinementStageId | V3EvidenceGateStageId | V3EvidenceClusteringStageId | V3EventGroupingStageId | V3SceneGroupingStageId | V3MemoryContractStageId | V3SceneSituationStageId | V3EventFrameStageId | V3GoalGroundingStageId | V3CausalEdgeStageId | V3ProgressiveMemoryStageId | V3RetrievalIndexStageId | V3SemanticIndexStageId | "ENT.1"
  runningStage?: "PRE.1" | "PRE.2" | V3EvidencePassId | V3EvidenceRefinementStageId | V3EvidenceGateStageId | V3EvidenceClusteringStageId | V3EventGroupingStageId | V3SceneGroupingStageId | V3MemoryContractStageId | V3SceneSituationStageId | V3EventFrameStageId | V3GoalGroundingStageId | V3CausalEdgeStageId | V3ProgressiveMemoryStageId | V3RetrievalIndexStageId | V3SemanticIndexStageId | "ENT.1" | null
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

function ParagraphCard({
  paragraph,
  unit,
}: {
  paragraph: PreParagraph
  unit?: PreContentUnit
}) {
  const contentType = unit?.content_type ?? "non_narrative_other"
  const meta = CONTENT_TYPE_META[contentType]

  return (
    <article className={`rounded-lg border border-l-4 border-zinc-200 bg-white px-4 py-3 ${meta.borderClass}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] text-zinc-400">P{paragraph.pid}</span>
        {unit && (
          <>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.pillClass}`}>
              {meta.label}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] ${
                unit.is_story_text ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-600"
              }`}
            >
              {unit.is_story_text ? "Story" : "Non-story"}
            </span>
          </>
        )}
      </div>
      <p className="mt-2 line-clamp-2 text-sm leading-6 text-zinc-700">{paragraph.text}</p>
      <details className="mt-2 text-xs text-zinc-500">
        <summary className="cursor-pointer select-none font-medium text-zinc-500">Full paragraph</summary>
        <p className="mt-2 text-sm leading-7 text-zinc-700">{paragraph.text}</p>
      </details>
    </article>
  )
}

export default function PreStageViews({
  preparedChapter,
  contentUnits,
  evidenceArtifacts,
  evidenceRefinement,
  evidenceGate,
  evidenceClustering,
  eventGrouping,
  sceneGrouping,
  memoryContract,
  sceneCards,
  eventFrames,
  groundedGoals,
  causalEdges,
  progressiveMemory,
  retrievalIndex,
  semanticIndex,
  mentionCandidates,
  activeStage,
  runningStage,
}: Props) {
  const [paragraphFilter, setParagraphFilter] = useState<ParagraphFilter>("all")
  const paragraphs = useMemo<PreParagraph[]>(
    () => preparedChapter?.raw_chapter.paragraphs.map((paragraph) => ({
      pid: paragraph.pid,
      text: paragraph.text,
    })) ?? [],
    [preparedChapter],
  )
  const units = useMemo<PreContentUnit[]>(
    () => (contentUnits?.units ?? []) as PreContentUnit[],
    [contentUnits],
  )
  const summary = useMemo(() => summarizeContentUnits(units), [units])
  const unitsByPid = useMemo(() => unitByPid(units), [units])
  const visibleParagraphs = useMemo(
    () => filterParagraphs(paragraphs, units, paragraphFilter),
    [paragraphFilter, paragraphs, units],
  )

  if (!preparedChapter) {
    return (
      <EmptyState
        title={runningStage === "PRE.1" ? "PRE.1 is running" : "No PRE.1 result yet"}
        body="Select a document and chapter, then run PRE.1 to materialize the raw chapter JSON."
      />
    )
  }

  if (activeStage === "PRE.1") {
    return (
      <div className="grid min-h-0 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-h-0 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Raw chapter</p>
              <h2 className="mt-1 text-lg font-semibold text-zinc-950">{preparedChapter.chapter_title}</h2>
            </div>
            <span className="rounded-full bg-white px-3 py-1 text-xs text-zinc-500">
              {paragraphs.length} paragraphs
            </span>
          </div>
          <div className="mt-4 max-h-[68vh] space-y-3 overflow-y-auto pr-1">
            {paragraphs.map((paragraph) => (
              <ParagraphCard key={paragraph.pid} paragraph={paragraph} />
            ))}
          </div>
        </section>

        <aside className="space-y-3">
          <StatBlock label="Source" value={preparedChapter.source_type ?? "-"} />
          <StatBlock label="Paragraphs" value={String(preparedChapter.paragraph_count)} />
          <StatBlock label="Characters" value={preparedChapter.char_count.toLocaleString()} />
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Artifact</p>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500">Stage</dt>
                <dd className="font-mono text-zinc-800">{preparedChapter.stage_id}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500">Method</dt>
                <dd className="font-mono text-zinc-800">{preparedChapter.method}</dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>
    )
  }

  if (activeStage === "ENT.1") {
    return (
      <V3MentionStageView
        preparedChapter={preparedChapter}
        contentUnits={contentUnits}
        mentionCandidates={mentionCandidates}
        running={runningStage === "ENT.1"}
      />
    )
  }

  if (isV3EvidencePassId(activeStage)) {
    const artifactKey = activeStage === "EVID.1A"
      ? "evid1a"
      : activeStage === "EVID.1B"
        ? "evid1b"
        : activeStage === "EVID.1C"
          ? "evid1c"
          : "evid1d"

    return (
      <V3EvidenceStageView
        preparedChapter={preparedChapter}
        contentUnits={contentUnits}
        artifact={evidenceArtifacts?.[artifactKey]}
        activeStage={activeStage}
        running={runningStage === activeStage}
      />
    )
  }

  if (activeStage === "EVID.2") {
    return (
      <V3EvidenceRefinementStageView
        preparedChapter={preparedChapter}
        artifact={evidenceRefinement}
        running={runningStage === "EVID.2"}
      />
    )
  }

  if (activeStage === "EVID.3") {
    return (
      <V3EvidenceGateStageView
        preparedChapter={preparedChapter}
        artifact={evidenceGate}
        evidenceRefinement={evidenceRefinement}
        running={runningStage === "EVID.3"}
      />
    )
  }

  if (activeStage === "EVID.4") {
    return (
      <V3EvidenceClusteringStageView
        preparedChapter={preparedChapter}
        artifact={evidenceClustering}
        evidenceRefinement={evidenceRefinement}
        running={runningStage === "EVID.4"}
      />
    )
  }

  if (activeStage === "EVENT.1") {
    return (
      <V3EventGroupingStageView
        preparedChapter={preparedChapter}
        artifact={eventGrouping}
        running={runningStage === "EVENT.1"}
      />
    )
  }

  if (activeStage === "SCENE.0") {
    return (
      <V3SceneGroupingStageView
        preparedChapter={preparedChapter}
        artifact={sceneGrouping}
        running={runningStage === "SCENE.0"}
      />
    )
  }

  if (activeStage === "MEM.0") {
    return (
      <V3MemoryContractStageView
        preparedChapter={preparedChapter}
        artifact={memoryContract}
        running={runningStage === "MEM.0"}
      />
    )
  }

  if (activeStage === "MEM.1") {
    return (
      <V3SceneCardsStageView
        preparedChapter={preparedChapter}
        artifact={sceneCards}
        running={runningStage === "MEM.1"}
      />
    )
  }

  if (activeStage === "EVENT.2") {
    return (
      <V3EventFramesStageView
        artifact={eventFrames}
        running={runningStage === "EVENT.2"}
      />
    )
  }

  if (activeStage === "GOAL.1") {
    return <V3GoalGroundingStageView artifact={groundedGoals} running={runningStage === "GOAL.1"} />
  }

  if (activeStage === "CAUS.1") {
    return <V3CausalEdgesStageView artifact={causalEdges} running={runningStage === "CAUS.1"} />
  }

  if (activeStage === "MEM.2") {
    return <V3ProgressiveMemoryStageView artifact={progressiveMemory} running={runningStage === "MEM.2"} />
  }

  if (activeStage === "IDX.1") {
    return <V3RetrievalIndexStageView artifact={retrievalIndex} running={runningStage === "IDX.1"} />
  }

  if (activeStage === "IDX.2") {
    return <V3SemanticIndexStageView artifact={semanticIndex} running={runningStage === "IDX.2"} />
  }

  if (!contentUnits) {
    return (
      <EmptyState
        title={runningStage === "PRE.2" ? "PRE.2 is running" : "No PRE.2 result yet"}
        body="Run PRE.2 after PRE.1 to classify which paragraphs are narrative story text."
      />
    )
  }

  return (
    <div className="grid min-h-0 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <section className="min-h-0 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Classified paragraphs</p>
            <h2 className="mt-1 text-lg font-semibold text-zinc-950">{preparedChapter.chapter_title}</h2>
          </div>
          <div className="flex rounded-lg border border-zinc-200 bg-white p-1">
            {([
              { key: "all", label: "All" },
              { key: "story", label: "Story" },
              { key: "non-story", label: "Non-story" },
            ] as const).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setParagraphFilter(item.key)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  paragraphFilter === item.key
                    ? "bg-zinc-900 text-white"
                    : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 max-h-[68vh] space-y-3 overflow-y-auto pr-1">
          {visibleParagraphs.map((paragraph) => (
            <ParagraphCard
              key={paragraph.pid}
              paragraph={paragraph}
              unit={unitsByPid.get(paragraph.pid)}
            />
          ))}
        </div>
      </section>

      <aside className="space-y-3">
        <div className="grid grid-cols-3 gap-2 xl:grid-cols-1">
          <StatBlock label="Units" value={String(summary.total)} />
          <StatBlock label="Story" value={String(summary.story)} detail={`${summary.storyRate}%`} />
          <StatBlock label="Excluded" value={String(summary.nonStory)} />
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Content types</p>
            <span className="text-xs text-zinc-400">{contentUnits.model ?? "model unknown"}</span>
          </div>
          <div className="mt-3 space-y-2">
            {CONTENT_TYPE_ORDER.filter((type) => (summary.byType[type] ?? 0) > 0).map((type) => {
              const meta = CONTENT_TYPE_META[type]
              return (
                <div key={type} className="flex items-center justify-between gap-3 rounded-md bg-zinc-50 px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-zinc-800">{meta.label}</p>
                    <p className="text-xs text-zinc-500">{meta.tone}</p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${meta.pillClass}`}>
                    {summary.byType[type as PreContentType]}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </aside>
    </div>
  )
}
