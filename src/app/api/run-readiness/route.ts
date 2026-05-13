import {
  loadBookMemorySnapshot,
  loadKnowledgeGraph,
  loadRunResults,
  stageKey,
} from "@/lib/firestore"
import { queryNarrativeGraphSnapshot } from "@/lib/narrative-graph"
import type { RunReadinessReport, ReadinessCheck, ReadinessStatus } from "@/types/readiness"
import type { NextRequest } from "next/server"

function hasStage(results: Record<string, unknown>, stageId: Parameters<typeof stageKey>[0]): boolean {
  return Boolean(results[stageKey(stageId)])
}

function check(
  id: string,
  label: string,
  status: ReadinessStatus,
  detail: string,
  action?: string,
): ReadinessCheck {
  return { id, label, status, detail, action }
}

export async function GET(request: NextRequest): Promise<Response> {
  const docId = request.nextUrl.searchParams.get("docId")
  const chapterId = request.nextUrl.searchParams.get("chapterId")
  const runId = request.nextUrl.searchParams.get("runId")

  if (!docId || !chapterId || !runId) {
    return Response.json({ error: "docId, chapterId, and runId required" }, { status: 400 })
  }

  try {
    const [selectedResults, bookMemory, graph] = await Promise.all([
      loadRunResults(docId, chapterId, runId),
      loadBookMemorySnapshot(docId).catch(() => null),
      loadKnowledgeGraph({ docId, chapterId, runId }).catch(() => ({
        nodes: [],
        edges: [],
        totalNodes: 0,
        totalEdges: 0,
      })),
    ])

    const bookChapterRunId = bookMemory?.chapterRunIds[chapterId]
    const effectiveRunId = bookChapterRunId ?? runId
    const effectiveResults = effectiveRunId === runId
      ? selectedResults
      : await loadRunResults(docId, chapterId, effectiveRunId)
    const fallbackToSelectedRun = effectiveRunId !== runId && !hasStage(effectiveResults, "FINAL.1")
    const readerResults = fallbackToSelectedRun ? selectedResults : effectiveResults
    const readerRunId = fallbackToSelectedRun ? runId : effectiveRunId
    const graphProjected = graph.totalNodes > 0 || graph.totalEdges > 0

    const artifacts = {
      ent3: hasStage(selectedResults, "ENT.3"),
      sup0: hasStage(selectedResults, "SUP.0"),
      sup7: hasStage(selectedResults, "SUP.7"),
      final1: hasStage(selectedResults, "FINAL.1"),
      final2: hasStage(selectedResults, "FINAL.2"),
    }

    const reader = {
      effectiveRunId: readerRunId,
      final1OnEffectiveRun: hasStage(readerResults, "FINAL.1"),
      final2OnEffectiveRun: hasStage(readerResults, "FINAL.2"),
      fallbackToSelectedRun,
    }
    const narrativeGraph = bookMemory
      ? queryNarrativeGraphSnapshot(bookMemory, { chapterId })
      : null
    const narrativeGraphAvailable = Boolean(narrativeGraph && narrativeGraph.claims.length > 0)

    const checks: ReadinessCheck[] = [
      check(
        "ent3",
        "ENT.3 entity graph",
        artifacts.ent3 ? "ready" : "missing",
        artifacts.ent3 ? "Entity/mention source exists on the selected run." : "Entity/mention source is missing on the selected run.",
        artifacts.ent3 ? undefined : "Run ENT.3 before rebuilding the graph projection.",
      ),
      check(
        "sup0",
        "SUP.0 support memory",
        artifacts.sup0 ? "ready" : "missing",
        artifacts.sup0 ? "Scene/event memory exists on the selected run." : "SUP.0 is missing, so Graph and BOOK.0 cannot be built from this run.",
        artifacts.sup0 ? undefined : "Run SUP.0 after SCENE/SUB stages are ready.",
      ),
      check(
        "graph",
        "Knowledge graph projection",
        graphProjected ? "ready" : artifacts.ent3 || artifacts.sup0 ? "warning" : "missing",
        graphProjected
          ? `${graph.totalNodes} nodes and ${graph.totalEdges} edges are projected.`
          : "No graph_nodes/graph_edges projection was found for this chapter/run.",
        graphProjected ? undefined : "Click Projection rebuild in the Graph panel.",
      ),
      check(
        "book0",
        "BOOK.0 cross-chapter memory",
        bookMemory ? "ready" : "missing",
        bookMemory
          ? `Latest BOOK.0: ${bookMemory.bookRunId}`
          : "No BOOK.0 snapshot was found for this document.",
        bookMemory ? undefined : "Build BOOK.0 from runs that contain SUP.0.",
      ),
      check(
        "book-run-match",
        "BOOK.0 chapter run link",
        !bookMemory
          ? "unknown"
          : bookChapterRunId === runId
            ? "ready"
            : bookChapterRunId
              ? "warning"
              : "missing",
        !bookMemory
          ? "BOOK.0 is unavailable."
          : bookChapterRunId === runId
            ? "BOOK.0 points to the selected run."
            : bookChapterRunId
              ? `BOOK.0 points to ${bookChapterRunId}, not the selected run.`
              : "BOOK.0 does not include this chapter.",
        bookChapterRunId && bookChapterRunId !== runId
          ? "Either switch to the BOOK.0 run or rebuild BOOK.0 with this run."
          : undefined,
      ),
      check(
        "nrg0",
        "NRG.0 reader-safe claims",
        !bookMemory
          ? "missing"
          : narrativeGraphAvailable
            ? "ready"
            : "warning",
        !bookMemory
          ? "BOOK.0 is unavailable, so NRG.0 cannot be derived."
          : narrativeGraphAvailable && narrativeGraph
            ? `${narrativeGraph.claims.length} reader-safe claims and ${narrativeGraph.relations.length} relations are available.`
            : "BOOK.0 exists, but no reader-safe NRG claims were derived for this chapter.",
        !bookMemory
          ? "Build BOOK.0 before running SUP.7/FINAL.1 for NRG-based support."
          : narrativeGraphAvailable
            ? undefined
            : "Check that BOOK.0 includes this chapter and has scene/edge memory.",
      ),
      check(
        "sup7-final1",
        "Reader support package",
        reader.final1OnEffectiveRun ? "ready" : "missing",
        reader.final1OnEffectiveRun
          ? `Reader will load FINAL.1 from ${reader.effectiveRunId}.`
          : `FINAL.1 is missing on the effective reader run ${reader.effectiveRunId}.`,
        reader.final1OnEffectiveRun ? undefined : "Run SUP.7 and FINAL.1 on the effective reader run.",
      ),
    ]

    const recommendations = checks
      .filter((item) => item.action)
      .map((item) => item.action as string)

    const report: RunReadinessReport = {
      docId,
      chapterId,
      selectedRunId: runId,
      artifacts,
      graph: {
        projected: graphProjected,
        totalNodes: graph.totalNodes,
        totalEdges: graph.totalEdges,
      },
      bookMemory: {
        exists: Boolean(bookMemory),
        bookRunId: bookMemory?.bookRunId,
        chapterRunId: bookChapterRunId,
        runMatchesSelected: Boolean(bookChapterRunId && bookChapterRunId === runId),
        missingReason: bookMemory?.missingChapters.find((item) => item.chapterId === chapterId)?.reason,
      },
      narrativeGraph: {
        available: narrativeGraphAvailable,
        claimCount: narrativeGraph?.claims.length ?? 0,
        relationCount: narrativeGraph?.relations.length ?? 0,
        removedFutureClaimCount: narrativeGraph?.safetyFilter.removedFutureClaimCount ?? 0,
      },
      reader,
      checks,
      recommendations: Array.from(new Set(recommendations)),
    }

    return Response.json({ report })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
