import type {
  BookEntityOccurrence,
  BookEntityThread,
  BookMemoryEdge,
  BookMemoryEvidenceRef,
  BookMemorySceneRef,
  BookMemorySnapshot,
} from "@/types/book-memory"
import type {
  SupportContextKind,
  SupportContextPayload,
  SupportContextReaderPosition,
} from "@/types/support-context"

function sceneKeyFor(chapterId: string, sceneId: string): string {
  return `${chapterId}:${sceneId}`
}

function sortScenes(scenes: BookMemorySceneRef[]): BookMemorySceneRef[] {
  return [...scenes].sort((a, b) => {
    if (a.chapterIndex !== b.chapterIndex) return a.chapterIndex - b.chapterIndex
    if (a.startPid !== b.startPid) return a.startPid - b.startPid
    return a.sceneKey.localeCompare(b.sceneKey)
  })
}

function edgePriority(edge: BookMemoryEdge): number {
  switch (edge.type) {
    case "cross_chapter_causal_bridge":
      return 0
    case "cross_chapter_place_shift":
      return 1
    case "cross_chapter_same_place":
      return 2
    case "cross_chapter_character_thread":
      return 3
    case "entity_reappearance":
      return 4
    case "chapter_sequence":
    default:
      return 5
  }
}

function filterEdgesForKind(edges: BookMemoryEdge[], supportKind: SupportContextKind): BookMemoryEdge[] {
  if (supportKind === "all") return edges
  if (supportKind === "causal_bridge") {
    return edges.filter((edge) => edge.type === "cross_chapter_causal_bridge")
  }
  if (supportKind === "spatial_continuity" || supportKind === "visual_context") {
    return edges.filter((edge) => (
      edge.type === "cross_chapter_place_shift" ||
      edge.type === "cross_chapter_same_place"
    ))
  }
  if (
    supportKind === "character_focus" ||
    supportKind === "reference_repair" ||
    supportKind === "relation_delta"
  ) {
    return edges.filter((edge) => (
      edge.type === "cross_chapter_character_thread" ||
      edge.type === "entity_reappearance"
    ))
  }
  if (supportKind === "boundary_delta" || supportKind === "snapshot" || supportKind === "reentry_recap") {
    return edges.filter((edge) => edge.type !== "entity_reappearance")
  }
  return edges
}

function uniqueEvidence(edges: BookMemoryEdge[]): BookMemoryEvidenceRef[] {
  const seen = new Set<string>()
  const refs: BookMemoryEvidenceRef[] = []
  for (const ref of edges.flatMap((edge) => edge.evidence)) {
    const key = [
      ref.chapterId,
      ref.runId,
      ref.sourceStageId,
      ref.sceneId,
      ref.eventId,
      ref.entityId,
      ref.text,
    ].join(":")
    if (seen.has(key)) continue
    seen.add(key)
    refs.push(ref)
  }
  return refs
}

function occurrenceSceneKey(occurrence: BookEntityOccurrence): string | undefined {
  return occurrence.firstSceneKey
}

function safeOccurrence(
  occurrence: BookEntityOccurrence,
  allowedSceneKeys: Set<string>,
): boolean {
  const key = occurrenceSceneKey(occurrence)
  return key ? allowedSceneKeys.has(key) : false
}

function buildPlaceChain(
  orderedScenes: BookMemorySceneRef[],
  currentSceneIndex: number,
  currentScene?: BookMemorySceneRef,
): BookMemorySceneRef[] {
  if (!currentScene || currentSceneIndex < 0) return []
  const previous = orderedScenes
    .slice(0, currentSceneIndex)
    .filter((scene) => scene.place && currentScene.place && scene.place === currentScene.place)
    .slice(-2)
  const immediatePrevious = orderedScenes[currentSceneIndex - 1]
  return [...previous, immediatePrevious, currentScene]
    .filter((scene): scene is BookMemorySceneRef => Boolean(scene))
    .filter((scene, index, all) => all.findIndex((item) => item.sceneKey === scene.sceneKey) === index)
}

export function buildSupportContext(
  snapshot: BookMemorySnapshot,
  params: {
    chapterId: string
    sceneId: string
    supportKind?: SupportContextKind
    readerPosition?: SupportContextReaderPosition
  },
): SupportContextPayload {
  const supportKind = params.supportKind ?? "all"
  const readerPosition = params.readerPosition ?? {
    chapterId: params.chapterId,
    sceneId: params.sceneId,
  }
  const sceneKey = sceneKeyFor(params.chapterId, params.sceneId)
  const orderedScenes = sortScenes(snapshot.sceneRefs)
  const currentSceneIndex = orderedScenes.findIndex((scene) => scene.sceneKey === sceneKey)
  const currentScene = currentSceneIndex >= 0 ? orderedScenes[currentSceneIndex] : undefined
  const allowedScenes = currentSceneIndex >= 0
    ? orderedScenes.slice(0, currentSceneIndex + 1)
    : orderedScenes.filter((scene) => (
        scene.chapterId === readerPosition.chapterId &&
        (readerPosition.pid === undefined || scene.startPid <= readerPosition.pid)
      ))
  const allowedSceneKeys = new Set(allowedScenes.map((scene) => scene.sceneKey))

  const safeEdges = snapshot.edges.filter((edge) => (
    allowedSceneKeys.has(edge.fromSceneKey) && allowedSceneKeys.has(edge.toSceneKey)
  ))
  const filteredSafeEdges = filterEdgesForKind(safeEdges, supportKind)
    .sort((a, b) => edgePriority(a) - edgePriority(b) || b.weight - a.weight)
  const incomingEdges = filteredSafeEdges.filter((edge) => edge.toSceneKey === sceneKey)
  const outgoingEdges = filteredSafeEdges.filter((edge) => (
    edge.fromSceneKey === sceneKey && allowedSceneKeys.has(edge.toSceneKey)
  ))
  const causalEdges = incomingEdges.filter((edge) => edge.type === "cross_chapter_causal_bridge")

  let removedFutureThreadOccurrenceCount = 0
  const entityThreads = snapshot.entityThreads
    .map((thread) => {
      const currentOccurrence = thread.occurrences.find((occurrence) => (
        occurrence.chapterId === params.chapterId &&
        occurrenceSceneKey(occurrence) === sceneKey
      )) ?? thread.occurrences.find((occurrence) => occurrence.chapterId === params.chapterId)
      if (!currentOccurrence) return null
      const priorOccurrences = thread.occurrences.filter((occurrence) => safeOccurrence(occurrence, allowedSceneKeys))
      removedFutureThreadOccurrenceCount += Math.max(0, thread.occurrences.length - priorOccurrences.length)
      return {
        thread,
        currentOccurrence,
        priorOccurrences,
      }
    })
    .filter((item): item is {
      thread: BookEntityThread
      currentOccurrence: BookEntityOccurrence
      priorOccurrences: BookEntityOccurrence[]
    } => Boolean(item))
    .filter((item) => item.priorOccurrences.length > 0)

  const nearbyScenes = currentSceneIndex >= 0
    ? orderedScenes.slice(Math.max(0, currentSceneIndex - 2), currentSceneIndex + 1)
    : allowedScenes.slice(-3)

  return {
    docId: snapshot.docId,
    bookRunId: snapshot.bookRunId,
    supportKind,
    sceneKey,
    readerPosition,
    currentScene,
    currentChapterRunId: snapshot.chapterRunIds[params.chapterId],
    incomingEdges,
    outgoingEdges,
    causalEdges,
    placeChain: buildPlaceChain(orderedScenes, currentSceneIndex, currentScene),
    entityThreads,
    nearbyScenes,
    evidenceRefs: uniqueEvidence([...incomingEdges, ...outgoingEdges]),
    safetyFilterResult: {
      currentSceneFound: Boolean(currentScene),
      allowedSceneCount: allowedSceneKeys.size,
      removedFutureEdgeCount: snapshot.edges.length - safeEdges.length,
      removedFutureThreadOccurrenceCount,
    },
    sourceSnapshot: {
      bookRunId: snapshot.bookRunId,
      createdAtIso: snapshot.createdAtIso,
      chapterRunIds: snapshot.chapterRunIds,
    },
  }
}
