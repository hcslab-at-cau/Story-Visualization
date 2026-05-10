import { createHash } from "crypto"
import type {
  EntityGraph,
  SupportEvidenceRef,
  SupportMemoryEvent,
  SupportMemoryLog,
  SupportMemoryScene,
} from "@/types/schema"
import type {
  BookEntityOccurrence,
  BookEntityThread,
  BookMemoryChapterSummary,
  BookMemoryEdge,
  BookMemoryEvidenceRef,
  BookMemoryMissingChapter,
  BookMemorySceneRef,
  BookMemorySnapshot,
} from "@/types/book-memory"

export interface BookMemoryChapterInput {
  docId: string
  chapterId: string
  chapterIndex: number
  chapterTitle: string
  runId: string
  supportMemory: SupportMemoryLog
  entityGraph?: EntityGraph
}

export interface BuildBookMemorySnapshotParams {
  bookRunId: string
  docId: string
  chapters: BookMemoryChapterInput[]
  missingChapters?: BookMemoryMissingChapter[]
}

export function createBookMemoryRunId(seed: unknown): string {
  const hash = createHash("sha256").update(JSON.stringify(seed)).digest("hex").slice(0, 24)
  return `book_${hash}`
}

function normalizedKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9가-힣]+/gi, "_").replace(/^_+|_+$/g, "")
}

function compactStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))))
}

function sceneKey(chapterId: string, sceneId: string): string {
  return `${chapterId}:${sceneId}`
}

function edgeId(parts: string[]): string {
  const hash = createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 24)
  return `book_edge_${hash}`
}

function evidenceFromSupport(
  chapter: BookMemoryChapterInput,
  source: SupportMemoryScene | SupportMemoryEvent,
  fallbackStageId = "SUP.0",
): BookMemoryEvidenceRef[] {
  const evidence = "evidence" in source ? source.evidence : []
  if (evidence.length === 0) {
    return [{
      chapterId: chapter.chapterId,
      runId: chapter.runId,
      sourceStageId: fallbackStageId,
      sceneId: source.scene_id,
    }]
  }
  return evidence.map((item: SupportEvidenceRef) => ({
    chapterId: chapter.chapterId,
    runId: chapter.runId,
    sourceStageId: String(item.source_stage || fallbackStageId),
    sceneId: item.scene_id,
    text: item.text,
  }))
}

function toSceneRef(chapter: BookMemoryChapterInput, scene: SupportMemoryScene): BookMemorySceneRef {
  return {
    sceneKey: sceneKey(chapter.chapterId, scene.scene_id),
    docId: chapter.docId,
    chapterId: chapter.chapterId,
    chapterIndex: chapter.chapterIndex,
    chapterTitle: chapter.chapterTitle,
    runId: chapter.runId,
    sceneId: scene.scene_id,
    sceneTitle: scene.scene_title,
    summary: scene.summary,
    place: scene.place,
    time: scene.time,
    activeCast: scene.active_cast,
    actions: scene.actions,
    startPid: scene.start_pid,
    endPid: scene.end_pid,
  }
}

function findSceneForPid(scenes: BookMemorySceneRef[], pid: number | undefined): BookMemorySceneRef | undefined {
  if (typeof pid !== "number") return undefined
  return scenes.find((scene) => pid >= scene.startPid && pid <= scene.endPid)
}

function chapterSummary(chapter: BookMemoryChapterInput): BookMemoryChapterSummary {
  return {
    chapterId: chapter.chapterId,
    chapterIndex: chapter.chapterIndex,
    chapterTitle: chapter.chapterTitle,
    runId: chapter.runId,
    sceneCount: chapter.supportMemory.memory.scenes.length,
    eventCount: chapter.supportMemory.memory.events.length,
    entityCount: chapter.entityGraph?.entities.length ?? 0,
  }
}

function buildBoundaryEdges(chapters: BookMemoryChapterInput[]): BookMemoryEdge[] {
  const edges: BookMemoryEdge[] = []

  for (let index = 1; index < chapters.length; index += 1) {
    const previousChapter = chapters[index - 1]
    const currentChapter = chapters[index]
    const previousScene = previousChapter.supportMemory.memory.scenes.at(-1)
    const currentScene = currentChapter.supportMemory.memory.scenes[0]
    if (!previousScene || !currentScene) continue

    const fromSceneKey = sceneKey(previousChapter.chapterId, previousScene.scene_id)
    const toSceneKey = sceneKey(currentChapter.chapterId, currentScene.scene_id)
    const base = {
      fromSceneKey,
      toSceneKey,
      fromChapterId: previousChapter.chapterId,
      toChapterId: currentChapter.chapterId,
    }

    edges.push({
      edgeId: edgeId(["chapter_sequence", fromSceneKey, toSceneKey]),
      type: "chapter_sequence",
      ...base,
      label: `${previousChapter.chapterTitle} -> ${currentChapter.chapterTitle}`,
      weight: 0.5,
      evidence: [
        ...evidenceFromSupport(previousChapter, previousScene),
        ...evidenceFromSupport(currentChapter, currentScene),
      ].slice(0, 4),
    })

    const sharedCast = currentScene.active_cast.filter((name) => previousScene.active_cast.includes(name))
    if (sharedCast.length > 0) {
      edges.push({
        edgeId: edgeId(["cross_chapter_character_thread", fromSceneKey, toSceneKey, ...sharedCast]),
        type: "cross_chapter_character_thread",
        ...base,
        label: `continued cast: ${sharedCast.slice(0, 4).join(", ")}`,
        weight: 0.78,
        evidence: [
          ...evidenceFromSupport(previousChapter, previousScene),
          ...evidenceFromSupport(currentChapter, currentScene),
        ].slice(0, 4),
      })
    }

    if (previousScene.place && currentScene.place) {
      const samePlace = previousScene.place === currentScene.place
      edges.push({
        edgeId: edgeId([
          samePlace ? "cross_chapter_same_place" : "cross_chapter_place_shift",
          fromSceneKey,
          toSceneKey,
          previousScene.place,
          currentScene.place,
        ]),
        type: samePlace ? "cross_chapter_same_place" : "cross_chapter_place_shift",
        ...base,
        label: samePlace
          ? `same place continues: ${currentScene.place}`
          : `${previousScene.place} -> ${currentScene.place}`,
        weight: samePlace ? 0.64 : 0.58,
        evidence: [
          ...evidenceFromSupport(previousChapter, previousScene),
          ...evidenceFromSupport(currentChapter, currentScene),
        ].slice(0, 4),
      })
    }

    const previousEvent = previousChapter.supportMemory.memory.events
      .filter((event) => event.scene_id === previousScene.scene_id && event.causal_result)
      .at(-1)
    const currentEvent = currentChapter.supportMemory.memory.events.find((event) => (
      event.scene_id === currentScene.scene_id
    ))
    if (previousEvent?.causal_result && currentEvent) {
      edges.push({
        edgeId: edgeId(["cross_chapter_causal_bridge", previousEvent.event_id, currentEvent.event_id]),
        type: "cross_chapter_causal_bridge",
        ...base,
        label: `${previousEvent.causal_result} -> ${currentEvent.action}`,
        weight: 0.72,
        evidence: [
          ...evidenceFromSupport(previousChapter, previousEvent),
          ...evidenceFromSupport(currentChapter, currentEvent),
        ].slice(0, 6),
      })
    }
  }

  return edges
}

function buildEntityThreads(
  chapters: BookMemoryChapterInput[],
  sceneRefsByChapter: Map<string, BookMemorySceneRef[]>,
): { threads: BookEntityThread[]; edges: BookMemoryEdge[] } {
  const occurrencesByKey = new Map<string, BookEntityOccurrence[]>()

  for (const chapter of chapters) {
    const sceneRefs = sceneRefsByChapter.get(chapter.chapterId) ?? []
    for (const entity of chapter.entityGraph?.entities ?? []) {
      const firstMention = [...entity.mentions].sort((a, b) => a.pid - b.pid)[0]
      const firstScene = findSceneForPid(sceneRefs, firstMention?.pid)
      const canonicalKey = normalizedKey(entity.canonical_name)
      if (!canonicalKey) continue

      const occurrence: BookEntityOccurrence = {
        chapterId: chapter.chapterId,
        chapterIndex: chapter.chapterIndex,
        chapterTitle: chapter.chapterTitle,
        runId: chapter.runId,
        entityId: entity.entity_id,
        canonicalName: entity.canonical_name,
        mentionType: entity.mention_type,
        mentionCount: entity.mentions.length,
        firstPid: firstMention?.pid,
        firstSceneKey: firstScene?.sceneKey,
      }
      occurrencesByKey.set(canonicalKey, [...(occurrencesByKey.get(canonicalKey) ?? []), occurrence])
    }
  }

  const threads: BookEntityThread[] = []
  const edges: BookMemoryEdge[] = []

  for (const [canonicalKey, occurrences] of occurrencesByKey.entries()) {
    const sorted = occurrences.sort((a, b) => a.chapterIndex - b.chapterIndex)
    const chapterIds = compactStrings(sorted.map((item) => item.chapterId))
    if (chapterIds.length < 2) continue

    const canonicalName = sorted[0]?.canonicalName ?? canonicalKey
    const mentionType = sorted[0]?.mentionType ?? "unknown"
    threads.push({
      threadId: `entity_thread_${canonicalKey}`,
      canonicalKey,
      canonicalName,
      mentionType,
      totalMentions: sorted.reduce((sum, item) => sum + item.mentionCount, 0),
      chapters: chapterIds,
      occurrences: sorted,
    })

    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1]
      const current = sorted[index]
      if (!previous.firstSceneKey || !current.firstSceneKey) continue
      edges.push({
        edgeId: edgeId(["entity_reappearance", canonicalKey, previous.chapterId, current.chapterId]),
        type: "entity_reappearance",
        fromSceneKey: previous.firstSceneKey,
        toSceneKey: current.firstSceneKey,
        fromChapterId: previous.chapterId,
        toChapterId: current.chapterId,
        label: `${canonicalName} reappears across chapters`,
        weight: 0.66,
        evidence: [
          {
            chapterId: previous.chapterId,
            runId: previous.runId,
            sourceStageId: "ENT.3",
            entityId: previous.entityId,
          },
          {
            chapterId: current.chapterId,
            runId: current.runId,
            sourceStageId: "ENT.3",
            entityId: current.entityId,
          },
        ],
      })
    }
  }

  return { threads, edges }
}

export function buildBookMemorySnapshot(params: BuildBookMemorySnapshotParams): BookMemorySnapshot {
  const chapters = [...params.chapters].sort((a, b) => a.chapterIndex - b.chapterIndex)
  const sceneRefsByChapter = new Map<string, BookMemorySceneRef[]>()
  const sceneRefs = chapters.flatMap((chapter) => {
    const refs = chapter.supportMemory.memory.scenes.map((scene) => toSceneRef(chapter, scene))
    sceneRefsByChapter.set(chapter.chapterId, refs)
    return refs
  })
  const entityProjection = buildEntityThreads(chapters, sceneRefsByChapter)

  return {
    bookRunId: params.bookRunId,
    docId: params.docId,
    stageId: "BOOK.0",
    method: "rule",
    chapterRunIds: Object.fromEntries(chapters.map((chapter) => [chapter.chapterId, chapter.runId])),
    chapters: chapters.map((chapter) => chapterSummary(chapter)),
    sceneRefs,
    edges: [...buildBoundaryEdges(chapters), ...entityProjection.edges],
    entityThreads: entityProjection.threads,
    missingChapters: params.missingChapters ?? [],
    createdAtIso: new Date().toISOString(),
  }
}

