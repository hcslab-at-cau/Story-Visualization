export type BookMemoryEdgeType =
  | "chapter_sequence"
  | "cross_chapter_character_thread"
  | "cross_chapter_same_place"
  | "cross_chapter_place_shift"
  | "cross_chapter_causal_bridge"
  | "entity_reappearance"

export interface BookMemoryEvidenceRef {
  chapterId: string
  runId: string
  sourceStageId: string
  sceneId?: string
  eventId?: string
  entityId?: string
  text?: string
}

export interface BookMemoryChapterSummary {
  chapterId: string
  chapterIndex: number
  chapterTitle: string
  runId: string
  sceneCount: number
  eventCount: number
  entityCount: number
}

export interface BookMemorySceneRef {
  sceneKey: string
  docId: string
  chapterId: string
  chapterIndex: number
  chapterTitle: string
  runId: string
  sceneId: string
  sceneTitle: string
  summary: string
  place?: string
  time?: string
  activeCast: string[]
  actions: string[]
  startPid: number
  endPid: number
}

export interface BookMemoryEdge {
  edgeId: string
  type: BookMemoryEdgeType
  fromSceneKey: string
  toSceneKey: string
  fromChapterId: string
  toChapterId: string
  label: string
  weight: number
  evidence: BookMemoryEvidenceRef[]
}

export interface BookEntityOccurrence {
  chapterId: string
  chapterIndex: number
  chapterTitle: string
  runId: string
  entityId: string
  canonicalName: string
  mentionType: string
  mentionCount: number
  firstPid?: number
  firstSceneKey?: string
}

export interface BookEntityThread {
  threadId: string
  canonicalKey: string
  canonicalName: string
  mentionType: string
  totalMentions: number
  chapters: string[]
  occurrences: BookEntityOccurrence[]
}

export interface BookMemoryMissingChapter {
  chapterId: string
  chapterIndex: number
  chapterTitle: string
  runId?: string
  reason: string
}

export interface BookMemorySnapshot {
  bookRunId: string
  docId: string
  stageId: "BOOK.0"
  method: "rule"
  chapterRunIds: Record<string, string>
  chapters: BookMemoryChapterSummary[]
  sceneRefs: BookMemorySceneRef[]
  edges: BookMemoryEdge[]
  entityThreads: BookEntityThread[]
  missingChapters: BookMemoryMissingChapter[]
  createdAtIso: string
}

