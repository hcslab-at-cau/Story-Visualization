"use client"

import { useCallback, useEffect, useState } from "react"
import {
  loadKnowledgeGraph,
  rebuildKnowledgeGraph,
} from "@/lib/client-data"
import type {
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
  KnowledgeGraphNodeKind,
  KnowledgeGraphQueryResult,
} from "@/types/graph"

const NODE_KIND_OPTIONS: Array<{ value: KnowledgeGraphNodeKind | "all"; label: string }> = [
  { value: "all", label: "All nodes" },
  { value: "scene", label: "Scenes" },
  { value: "event", label: "Events" },
  { value: "character", label: "Characters" },
  { value: "place", label: "Places" },
  { value: "entity", label: "Entities" },
  { value: "mention", label: "Mentions" },
]

const NODE_KIND_CLASS: Record<KnowledgeGraphNodeKind, string> = {
  scene: "border-sky-200 bg-sky-50 text-sky-800",
  event: "border-emerald-200 bg-emerald-50 text-emerald-800",
  character: "border-amber-200 bg-amber-50 text-amber-800",
  place: "border-cyan-200 bg-cyan-50 text-cyan-800",
  entity: "border-zinc-300 bg-zinc-100 text-zinc-800",
  mention: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800",
}

function nodeSummary(node: KnowledgeGraphNode): string {
  const pieces = [
    node.sceneId ? `scene ${node.sceneId}` : "",
    node.eventId ? `event ${node.eventId}` : "",
    node.entityId ? `entity ${node.entityId}` : "",
  ].filter(Boolean)
  return pieces.join(" · ") || node.localId
}

function connectedEdges(nodeId: string | null, edges: KnowledgeGraphEdge[]): KnowledgeGraphEdge[] {
  if (!nodeId) return []
  return edges.filter((edge) => edge.fromNodeId === nodeId || edge.toNodeId === nodeId)
}

export default function KnowledgeGraphExplorer({
  docId,
  chapterId,
  runId,
}: {
  docId: string
  chapterId: string
  runId: string
}) {
  const [queryText, setQueryText] = useState("")
  const [kind, setKind] = useState<KnowledgeGraphNodeKind | "all">("all")
  const [depth, setDepth] = useState(1)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [graph, setGraph] = useState<KnowledgeGraphQueryResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const loadGraph = useCallback(async (nextSelectedNodeId = selectedNodeId) => {
    if (!docId || !chapterId || !runId) return
    setLoading(true)
    setError(null)
    try {
      const loaded = await loadKnowledgeGraph({
        docId,
        chapterId,
        runId,
        q: nextSelectedNodeId ? undefined : queryText,
        kind: nextSelectedNodeId ? "all" : kind,
        nodeId: nextSelectedNodeId ?? undefined,
        depth,
      })
      setGraph(loaded)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [chapterId, depth, docId, kind, queryText, runId, selectedNodeId])

  useEffect(() => {
    setSelectedNodeId(null)
    setGraph(null)
    setNotice(null)
  }, [docId, chapterId, runId])

  useEffect(() => {
    void loadGraph()
  }, [loadGraph])

  async function handleRebuild() {
    if (!docId || !chapterId || !runId) return
    setRebuilding(true)
    setError(null)
    setNotice(null)
    try {
      const result = await rebuildKnowledgeGraph(docId, chapterId, runId)
      setNotice(
        `Projected ${result.nodes} nodes and ${result.edges} edges from ${result.projectedStages.join(", ") || "no graph stages"}.`,
      )
      setSelectedNodeId(null)
      await loadGraph(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRebuilding(false)
    }
  }

  const nodes = graph?.nodes ?? []
  const edges = graph?.edges ?? []
  const selectedNode = selectedNodeId
    ? nodes.find((node) => node.nodeId === selectedNodeId) ?? null
    : null
  const selectedEdges = connectedEdges(selectedNodeId, edges)

  return (
    <section className="flex min-h-0 flex-col gap-5 rounded-2xl border border-zinc-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Knowledge Graph</p>
          <h2 className="mt-1 text-xl font-semibold text-zinc-900">Queryable graph projection</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500">
            SUP.0/ENT.3 artifact를 node와 edge로 투영해 현재 run 기준으로 검색하고, 선택 node의 주변 hop을 확인합니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          <span className="rounded-full bg-zinc-100 px-3 py-1">nodes {graph?.totalNodes ?? 0}</span>
          <span className="rounded-full bg-zinc-100 px-3 py-1">edges {graph?.totalEdges ?? 0}</span>
          <button
            type="button"
            onClick={() => void handleRebuild()}
            disabled={rebuilding || loading || !runId}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
          >
            {rebuilding ? "Rebuilding..." : "Rebuild Projection"}
          </button>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_180px_140px_auto]">
        <input
          value={queryText}
          onChange={(event) => {
            setQueryText(event.target.value)
            setSelectedNodeId(null)
          }}
          placeholder="Search character, place, scene, event..."
          className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700"
        />
        <select
          value={kind}
          onChange={(event) => {
            setKind(event.target.value as KnowledgeGraphNodeKind | "all")
            setSelectedNodeId(null)
          }}
          className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700"
        >
          {NODE_KIND_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <select
          value={depth}
          onChange={(event) => setDepth(Number(event.target.value))}
          className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700"
        >
          <option value={0}>0 hop</option>
          <option value={1}>1 hop</option>
          <option value={2}>2 hops</option>
          <option value={3}>3 hops</option>
        </select>
        <button
          type="button"
          onClick={() => {
            setSelectedNodeId(null)
            void loadGraph(null)
          }}
          disabled={loading || !runId}
          className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
        >
          {loading ? "Loading..." : "Search"}
        </button>
      </div>

      {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}
      {!loading && graph && graph.totalNodes === 0 && (
        <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-sm text-zinc-500">
          No graph projection found. Run ENT.3/SUP.0 or click Rebuild Projection after those stages exist.
        </div>
      )}

      <div className="grid min-h-[560px] gap-5 xl:grid-cols-[minmax(320px,0.85fr)_minmax(0,1.15fr)]">
        <div className="min-h-0 overflow-hidden rounded-xl border border-zinc-200">
          <div className="border-b border-zinc-200 bg-zinc-50 px-4 py-3">
            <p className="text-sm font-semibold text-zinc-800">Nodes ({nodes.length})</p>
          </div>
          <div className="max-h-[640px] space-y-2 overflow-y-auto p-3">
            {nodes.map((node) => (
              <button
                key={node.nodeId}
                type="button"
                onClick={() => {
                  setSelectedNodeId(node.nodeId)
                  void loadGraph(node.nodeId)
                }}
                className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                  selectedNodeId === node.nodeId
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold">{node.label}</span>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${NODE_KIND_CLASS[node.kind]}`}>
                    {node.kind}
                  </span>
                </div>
                <p className={`mt-1 truncate text-xs ${selectedNodeId === node.nodeId ? "text-zinc-300" : "text-zinc-400"}`}>
                  {nodeSummary(node)}
                </p>
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 overflow-hidden rounded-xl border border-zinc-200">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-3">
            <p className="text-sm font-semibold text-zinc-800">
              {selectedNode ? `Neighborhood: ${selectedNode.label}` : `Edges (${edges.length})`}
            </p>
            {selectedNode && (
              <button
                type="button"
                onClick={() => {
                  setSelectedNodeId(null)
                  void loadGraph(null)
                }}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
              >
                Clear Focus
              </button>
            )}
          </div>

          <div className="max-h-[640px] overflow-y-auto p-4">
            {selectedNode && (
              <div className="mb-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2.5 py-1 text-xs ${NODE_KIND_CLASS[selectedNode.kind]}`}>
                    {selectedNode.kind}
                  </span>
                  <h3 className="text-base font-semibold text-zinc-900">{selectedNode.label}</h3>
                </div>
                <p className="mt-2 text-sm text-zinc-500">{nodeSummary(selectedNode)}</p>
                {selectedNode.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {selectedNode.tags.slice(0, 12).map((tag) => (
                      <span key={`${selectedNode.nodeId}:${tag}`} className="rounded-full bg-white px-2 py-0.5 text-[11px] text-zinc-500">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-3">
              {(selectedNode ? selectedEdges : edges).map((edge) => {
                const from = nodes.find((node) => node.nodeId === edge.fromNodeId)
                const to = nodes.find((node) => node.nodeId === edge.toNodeId)
                return (
                  <article key={edge.edgeId} className="rounded-xl border border-zinc-200 bg-white p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600">
                        {edge.type}
                      </span>
                      <span className="text-sm font-semibold text-zinc-800">{edge.label}</span>
                    </div>
                    <p className="mt-2 text-sm text-zinc-500">
                      {from?.label ?? edge.fromNodeId} {"->"} {to?.label ?? edge.toNodeId}
                    </p>
                    {edge.evidence.length > 0 && (
                      <p className="mt-2 text-xs text-zinc-400">evidence refs: {edge.evidence.length}</p>
                    )}
                  </article>
                )
              })}
              {!loading && (selectedNode ? selectedEdges : edges).length === 0 && (
                <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-400">
                  No edges for the current query.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
