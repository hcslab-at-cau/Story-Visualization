"use client"

import { useMemo, useState } from "react"
import V3BodyResultView, {
  type V3BodyHighlight,
  type V3BodySideItem,
} from "@/components/v3/V3BodyResultView"
import type {
  V3ClusteredEntityType,
  V3EvidenceClusteringArtifact,
  V3EvidenceEntityCluster,
} from "@/lib/pipeline/v3-evidence-clustering-types"
import type { V3EvidenceRefinementArtifact } from "@/lib/pipeline/v3-evidence-refinement-types"
import type { PreparedChapter } from "@/types/schema"

const FILTERS: Array<"all" | V3ClusteredEntityType> = ["all", "cast", "place", "time", "object"]

const TYPE_LABELS: Record<V3ClusteredEntityType, string> = {
  cast: "CAST",
  place: "PLACE",
  time: "TIME",
  object: "OBJECT",
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

function pidRange(pids: number[]): string {
  const ordered = Array.from(new Set(pids)).sort((a, b) => a - b)
  if (ordered.length === 0) return "-"
  const first = ordered[0]
  const last = ordered[ordered.length - 1]
  return first === last ? `P${first}` : `P${first}-P${last}`
}

function clusterShortId(clusterId: string): string {
  return clusterId.split("_").at(-1) ?? clusterId
}

function clusterDetail(cluster: V3EvidenceEntityCluster): string {
  const aliases = cluster.aliases.length > 0
    ? `Aliases: ${cluster.aliases.slice(0, 5).join(", ")}`
    : "No aliases"
  return `${cluster.mention_count} mentions / ${pidRange(cluster.evidence_pids)} / ${aliases}`
}

export default function V3EvidenceClusteringStageView({
  preparedChapter,
  artifact,
  evidenceRefinement,
  running,
}: {
  preparedChapter: PreparedChapter
  artifact?: V3EvidenceClusteringArtifact
  evidenceRefinement?: V3EvidenceRefinementArtifact
  running?: boolean
}) {
  const [filter, setFilter] = useState<"all" | V3ClusteredEntityType>("all")
  const clusters = useMemo(() => artifact?.entity_clusters ?? [], [artifact?.entity_clusters])
  const visibleClusters = useMemo(
    () => clusters.filter((cluster) => filter === "all" || cluster.entity_type === filter),
    [clusters, filter],
  )
  const visibleClusterIds = useMemo(
    () => new Set(visibleClusters.map((cluster) => cluster.cluster_id)),
    [visibleClusters],
  )
  const clusterById = useMemo(
    () => new Map(clusters.map((cluster) => [cluster.cluster_id, cluster])),
    [clusters],
  )
  const bodyHighlights = useMemo<V3BodyHighlight[]>(() => {
    if (!artifact || !evidenceRefinement) return []

    return evidenceRefinement.refined_candidates.flatMap((candidate) => {
      const clusterId = artifact.candidate_cluster_map[candidate.refined_candidate_id]
      const cluster = clusterId ? clusterById.get(clusterId) : undefined
      if (!cluster || !visibleClusterIds.has(cluster.cluster_id)) return []

      return [{
        id: `${cluster.cluster_id}-${candidate.refined_candidate_id}`,
        pid: candidate.pid,
        startChar: candidate.start_char,
        endChar: candidate.end_char,
        label: cluster.canonical_label,
        tone: cluster.entity_type,
        title: `${TYPE_LABELS[cluster.entity_type]} / ${cluster.canonical_label} / ${candidate.span}`,
      }]
    })
  }, [artifact, clusterById, evidenceRefinement, visibleClusterIds])
  const bodySideItems = useMemo<V3BodySideItem[]>(
    () => visibleClusters.flatMap((cluster) =>
      Array.from(new Set(cluster.evidence_pids)).sort((a, b) => a - b).map((pid) => ({
        id: `${cluster.cluster_id}-p${pid}`,
        pid,
        title: cluster.canonical_label,
        label: TYPE_LABELS[cluster.entity_type],
        tone: cluster.entity_type,
        detail: clusterDetail(cluster),
        meta: [`C${clusterShortId(cluster.cluster_id)}`, `${cluster.mention_count} mentions`],
      })),
    ),
    [visibleClusters],
  )

  if (!artifact) {
    return (
      <EmptyState
        title={running ? "EVID.4 is running" : "No EVID.4 result yet"}
        body="Run EVID.4 after EVID.3 to cluster non-dropped CAST, PLACE, TIME, and OBJECT mentions before event grouping."
      />
    )
  }

  return (
    <div className="grid min-h-0 gap-5 2xl:grid-cols-[minmax(0,1fr)_420px]">
      <section className="min-h-0 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">EVID.4</p>
            <h2 className="mt-1 text-lg font-semibold text-zinc-950">Entity clusters on text</h2>
          </div>
          <div className="flex rounded-lg border border-zinc-200 bg-white p-1">
            {FILTERS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setFilter(item)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  filter === item
                    ? "bg-zinc-900 text-white"
                    : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800"
                }`}
              >
                {item === "all" ? "All" : item.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 max-h-[68vh] overflow-y-auto pr-1">
          <V3BodyResultView
            paragraphs={preparedChapter.raw_chapter.paragraphs}
            highlights={bodyHighlights}
            sideItems={bodySideItems}
            emptyTitle="No clusters match this filter."
            emptyBody="Switch the entity filter or rerun EVID.4 to inspect entity clusters on the source text."
          />
        </div>
      </section>

      <aside className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <StatBlock label="Clusters" value={String(artifact.cluster_stats.entity_clusters)} />
          <StatBlock label="Mentions" value={String(artifact.cluster_stats.entity_like_candidates)} />
          <StatBlock label="Singletons" value={String(artifact.cluster_stats.singleton_clusters)} />
          <StatBlock label="Unclustered" value={String(artifact.cluster_stats.unclustered_candidates)} />
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Clusters by type</p>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            {(["cast", "place", "time", "object"] as V3ClusteredEntityType[]).map((type) => (
              <div key={type} className="flex items-center justify-between gap-3 rounded-md bg-zinc-50 px-3 py-2">
                <dt className="font-medium uppercase text-zinc-600">{type}</dt>
                <dd className="font-mono text-zinc-900">{artifact.cluster_stats.by_type[type] ?? 0}</dd>
              </div>
            ))}
          </dl>
        </div>
      </aside>
    </div>
  )
}
