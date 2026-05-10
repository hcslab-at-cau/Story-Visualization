import type {
  BookEntityThread,
  BookMemoryEdge,
  BookMemoryEvidenceRef,
  BookMemorySceneRef,
  BookMemorySnapshot,
} from "@/types/book-memory"
import type { SupportUnitKind } from "@/types/schema"

export type SupportContextKind = SupportUnitKind | "all"

export interface SupportContextReaderPosition {
  chapterId: string
  sceneId?: string
  pid?: number
}

export interface SupportContextEntityThread {
  thread: BookEntityThread
  currentOccurrence?: BookEntityThread["occurrences"][number]
  priorOccurrences: BookEntityThread["occurrences"]
}

export interface SupportContextSafetyFilterResult {
  currentSceneFound: boolean
  allowedSceneCount: number
  removedFutureEdgeCount: number
  removedFutureThreadOccurrenceCount: number
}

export interface SupportContextPayload {
  docId: string
  bookRunId: string
  supportKind: SupportContextKind
  sceneKey: string
  readerPosition: SupportContextReaderPosition
  currentScene?: BookMemorySceneRef
  currentChapterRunId?: string
  incomingEdges: BookMemoryEdge[]
  outgoingEdges: BookMemoryEdge[]
  causalEdges: BookMemoryEdge[]
  placeChain: BookMemorySceneRef[]
  entityThreads: SupportContextEntityThread[]
  nearbyScenes: BookMemorySceneRef[]
  evidenceRefs: BookMemoryEvidenceRef[]
  safetyFilterResult: SupportContextSafetyFilterResult
  sourceSnapshot: Pick<BookMemorySnapshot, "bookRunId" | "createdAtIso" | "chapterRunIds">
}
