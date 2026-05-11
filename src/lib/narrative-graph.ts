import type {
  BookEntityThread,
  BookMemoryEdge,
  BookMemoryEdgeType,
  BookMemoryEvidenceRef,
  BookMemorySceneRef,
  BookMemorySnapshot,
} from "@/types/book-memory"
import type {
  NarrativeGraphClaim,
  NarrativeGraphClaimType,
  NarrativeGraphQueryResult,
  NarrativeGraphRelation,
  NarrativeGraphSnapshot,
} from "@/types/narrative-graph"
import type { SupportContextKind } from "@/types/support-context"

function boundedScore(value: number, fallback = 0.6): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(0, Math.min(1, value))
}

function sceneKey(chapterId: string, sceneId: string): string {
  return `${chapterId}:${sceneId}`
}

function sortScenes(scenes: BookMemorySceneRef[]): BookMemorySceneRef[] {
  return [...scenes].sort((a, b) => {
    if (a.chapterIndex !== b.chapterIndex) return a.chapterIndex - b.chapterIndex
    if (a.startPid !== b.startPid) return a.startPid - b.startPid
    return a.sceneKey.localeCompare(b.sceneKey)
  })
}

function claimId(parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(":").replace(/[^a-zA-Z0-9:_-]/g, "_").slice(0, 180)
}

function edgeClaimType(type: BookMemoryEdgeType): NarrativeGraphClaimType {
  switch (type) {
    case "cross_chapter_causal_bridge":
      return "causal"
    case "cross_chapter_place_shift":
    case "cross_chapter_same_place":
      return "place"
    case "cross_chapter_character_thread":
    case "entity_reappearance":
      return "relation"
    case "chapter_sequence":
    default:
      return "event"
  }
}

function sourceRunIdFromEvidence(evidence: BookMemoryEvidenceRef[], fallback = ""): string {
  return evidence.find((ref) => ref.runId)?.runId ?? fallback
}

function sceneStateClaims(scene: BookMemorySceneRef): NarrativeGraphClaim[] {
  const base = {
    subjectRefs: [scene.sceneKey],
    evidenceRefs: [{
      chapterId: scene.chapterId,
      runId: scene.runId,
      sourceStageId: "SUP.0",
      sceneId: scene.sceneId,
      text: scene.summary,
    }],
    confidence: 0.74,
    revealStart: {
      chapter_id: scene.chapterId,
      scene_id: scene.sceneId,
      pid: scene.startPid,
    },
    spoilerRisk: "none" as const,
    scope: "actual" as const,
    sourceRunId: scene.runId,
    chapterId: scene.chapterId,
    sceneId: scene.sceneId,
    sceneKey: scene.sceneKey,
  }
  const claims: NarrativeGraphClaim[] = []

  if (scene.summary) {
    claims.push({
      ...base,
      claimId: claimId(["claim", scene.sceneKey, "state"]),
      claimType: "state",
      text: scene.summary,
      objectRefs: [],
      supportLevel: "explicit",
    })
  }

  if (scene.place) {
    claims.push({
      ...base,
      claimId: claimId(["claim", scene.sceneKey, "place", scene.place]),
      claimType: "place",
      text: `Current place: ${scene.place}`,
      objectRefs: [scene.place],
      supportLevel: "explicit",
      confidence: 0.78,
    })
  }

  for (const action of scene.actions.slice(0, 4)) {
    claims.push({
      ...base,
      claimId: claimId(["claim", scene.sceneKey, "event", action]),
      claimType: "event",
      text: action,
      objectRefs: scene.activeCast,
      supportLevel: "explicit",
      confidence: 0.68,
    })
  }

  return claims
}

function edgeClaim(edge: BookMemoryEdge): NarrativeGraphClaim {
  const toSceneId = edge.toSceneKey.split(":").slice(1).join(":")
  return {
    claimId: claimId(["claim", edge.edgeId]),
    claimType: edgeClaimType(edge.type),
    text: edge.label,
    subjectRefs: [edge.fromSceneKey],
    objectRefs: [edge.toSceneKey],
    evidenceRefs: edge.evidence,
    supportLevel: edge.type === "cross_chapter_causal_bridge" ? "strong_inference" : "explicit",
    confidence: boundedScore(edge.weight, edge.type === "cross_chapter_causal_bridge" ? 0.72 : 0.65),
    revealStart: {
      chapter_id: edge.toChapterId,
      scene_id: toSceneId,
    },
    spoilerRisk: "none",
    scope: "actual",
    sourceRunId: sourceRunIdFromEvidence(edge.evidence),
    chapterId: edge.toChapterId,
    sceneId: toSceneId,
    sceneKey: edge.toSceneKey,
  }
}

function entityClaims(thread: BookEntityThread): NarrativeGraphClaim[] {
  return thread.occurrences.slice(0, 12).map((occurrence) => {
    const occurrenceSceneKey = occurrence.firstSceneKey ?? sceneKey(occurrence.chapterId, occurrence.entityId)
    return {
      claimId: claimId(["claim", "entity", thread.threadId, occurrence.chapterId, occurrence.firstSceneKey]),
      claimType: "relation",
      text: `${thread.canonicalName} appears in ${occurrence.chapterTitle}.`,
      subjectRefs: [thread.threadId, thread.canonicalName],
      objectRefs: [occurrenceSceneKey],
      evidenceRefs: [{
        chapterId: occurrence.chapterId,
        runId: occurrence.runId,
        sourceStageId: "ENT.3",
        entityId: occurrence.entityId,
      }],
      supportLevel: "explicit" as const,
      confidence: 0.64,
      revealStart: {
        chapter_id: occurrence.chapterId,
        pid: occurrence.firstPid,
      },
      spoilerRisk: "none" as const,
      scope: "actual" as const,
      sourceRunId: occurrence.runId,
      chapterId: occurrence.chapterId,
      sceneKey: occurrence.firstSceneKey,
    }
  })
}

export function buildNarrativeGraphSnapshot(snapshot: BookMemorySnapshot): NarrativeGraphSnapshot {
  const sceneClaims = snapshot.sceneRefs.flatMap(sceneStateClaims)
  const edgeClaims = snapshot.edges.map(edgeClaim)
  const entityThreadClaims = snapshot.entityThreads.flatMap(entityClaims)
  const claims = [...sceneClaims, ...edgeClaims, ...entityThreadClaims]
  const claimBySceneState = new Map(
    sceneClaims
      .filter((claim) => claim.claimType === "state" && claim.sceneKey)
      .map((claim) => [claim.sceneKey as string, claim.claimId]),
  )
  const edgeRelations: NarrativeGraphRelation[] = snapshot.edges
    .flatMap((edge) => {
      const fromClaimId = claimBySceneState.get(edge.fromSceneKey)
      const toClaimId = claimBySceneState.get(edge.toSceneKey)
      if (!fromClaimId || !toClaimId) return []
      return [{
        relationId: claimId(["relation", edge.edgeId]),
        relationType: edge.type,
        fromClaimId,
        toClaimId,
        label: edge.label,
        confidence: boundedScore(edge.weight),
        evidenceRefs: edge.evidence,
      }]
    })

  return {
    docId: snapshot.docId,
    bookRunId: snapshot.bookRunId,
    claims,
    relations: edgeRelations,
    createdAtIso: snapshot.createdAtIso,
  }
}

function claimAllowed(
  claim: NarrativeGraphClaim,
  allowedSceneKeys: Set<string>,
  fallbackChapterId?: string,
): boolean {
  if (claim.sceneKey) return allowedSceneKeys.has(claim.sceneKey)
  return Boolean(fallbackChapterId && claim.chapterId === fallbackChapterId)
}

function claimMatchesSupportKind(claim: NarrativeGraphClaim, supportKind: SupportContextKind): boolean {
  if (supportKind === "all") return true
  if (supportKind === "causal_bridge") return claim.claimType === "causal"
  if (supportKind === "spatial_continuity" || supportKind === "visual_context") {
    return claim.claimType === "place"
  }
  if (
    supportKind === "character_focus" ||
    supportKind === "reference_repair" ||
    supportKind === "relation_delta"
  ) {
    return claim.claimType === "relation"
  }
  if (supportKind === "snapshot" || supportKind === "boundary_delta" || supportKind === "reentry_recap") {
    return claim.claimType === "state" || claim.claimType === "event" || claim.claimType === "place"
  }
  return true
}

export function queryNarrativeGraphSnapshot(
  snapshot: BookMemorySnapshot,
  params: {
    chapterId?: string
    sceneId?: string
    supportKind?: SupportContextKind
  } = {},
): NarrativeGraphQueryResult {
  const graph = buildNarrativeGraphSnapshot(snapshot)
  const orderedScenes = sortScenes(snapshot.sceneRefs)
  const readerSceneKey = params.chapterId && params.sceneId
    ? sceneKey(params.chapterId, params.sceneId)
    : undefined
  const readerSceneIndex = readerSceneKey
    ? orderedScenes.findIndex((scene) => scene.sceneKey === readerSceneKey)
    : -1
  const allowedScenes = readerSceneIndex >= 0
    ? orderedScenes.slice(0, readerSceneIndex + 1)
    : params.chapterId
      ? orderedScenes.filter((scene) => scene.chapterId === params.chapterId)
      : orderedScenes
  const allowedSceneKeys = new Set(allowedScenes.map((scene) => scene.sceneKey))
  const safeClaims = graph.claims
    .filter((claim) => claimAllowed(claim, allowedSceneKeys, params.chapterId))
    .filter((claim) => claimMatchesSupportKind(claim, params.supportKind ?? "all"))
  const safeClaimIds = new Set(safeClaims.map((claim) => claim.claimId))
  const safeRelations = graph.relations.filter((relation) => (
    safeClaimIds.has(relation.fromClaimId) &&
    safeClaimIds.has(relation.toClaimId)
  ))

  return {
    ...graph,
    claims: safeClaims,
    relations: safeRelations,
    totalClaims: graph.claims.length,
    totalRelations: graph.relations.length,
    safetyFilter: {
      readerSceneKey,
      allowedClaimCount: safeClaims.length,
      removedFutureClaimCount: graph.claims.length - safeClaims.length,
    },
  }
}
