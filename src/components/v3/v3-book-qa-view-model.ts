import type { V3BookQAAnswerCitation } from "@/lib/pipeline/v3-book-qa-answer-types"
import type {
  V3BookQACorpusManifest,
  V3BookQAReadinessDiagnostic,
  V3BookReaderPosition,
} from "@/lib/pipeline/v3-book-qa-types"
import { createV3WorkbenchHref } from "./v3-navigation"

export type V3BookQAReadinessViewModel = {
  status: "ready" | "blocked" | "invalid"
  message: string
  diagnostics: V3BookQAReadinessDiagnostic[]
  readableChapterCount: number
}

export type V3BookCitationAction =
  | { kind: "scroll"; label: string; targetId: string }
  | { kind: "navigate"; label: string; href: string }
  | { kind: "unavailable"; label: string; reason: string }

function chapterIndex(manifest: V3BookQACorpusManifest, chapterId: string): number {
  return manifest.ordered_chapter_ids.indexOf(chapterId)
}

function hasValidReaderPosition(
  manifest: V3BookQACorpusManifest,
  readerPosition: V3BookReaderPosition,
): boolean {
  const chapter = manifest.chapters.find((item) => item.chapter_id === readerPosition.chapter_id)
  return Boolean(
    chapter
    && chapterIndex(manifest, readerPosition.chapter_id) >= 0
    && Number.isInteger(readerPosition.pid)
    && readerPosition.pid >= 0
    && readerPosition.pid <= chapter.progress_end_pid,
  )
}

export function createV3BookQAReadinessViewModel(
  manifest: V3BookQACorpusManifest,
  readerPosition: V3BookReaderPosition,
): V3BookQAReadinessViewModel {
  if (!hasValidReaderPosition(manifest, readerPosition)) {
    return {
      status: "invalid",
      message: "Reader position is not valid for this corpus.",
      diagnostics: [],
      readableChapterCount: 0,
    }
  }

  const readableChapterCount = chapterIndex(manifest, readerPosition.chapter_id) + 1
  const readableChapterIds = new Set(manifest.ordered_chapter_ids.slice(0, readableChapterCount))
  const diagnostics = manifest.readiness.filter((item) => readableChapterIds.has(item.chapter_id))
  if (diagnostics.length > 0) {
    return {
      status: "blocked",
      message: `${diagnostics.length} readiness issue${diagnostics.length === 1 ? "" : "s"} across ${readableChapterCount} readable chapter${readableChapterCount === 1 ? "" : "s"}.`,
      diagnostics,
      readableChapterCount,
    }
  }

  return {
    status: "ready",
    message: `Ready across ${readableChapterCount} readable chapter${readableChapterCount === 1 ? "" : "s"}.`,
    diagnostics: [],
    readableChapterCount,
  }
}

export function createV3BookParagraphDomId(chapterId: string, pid: number): string {
  return `v3-qa-paragraph-${encodeURIComponent(chapterId)}-${pid}`
}

export function isV3BookParagraphReadable(
  manifest: V3BookQACorpusManifest,
  readerPosition: V3BookReaderPosition,
  chapterId: string,
  pid: number,
): boolean {
  if (!hasValidReaderPosition(manifest, readerPosition)) return false
  const readerChapterIndex = chapterIndex(manifest, readerPosition.chapter_id)
  const paragraphChapterIndex = chapterIndex(manifest, chapterId)
  if (paragraphChapterIndex < 0 || paragraphChapterIndex > readerChapterIndex) return false
  if (paragraphChapterIndex < readerChapterIndex) return true
  return pid <= readerPosition.pid
}

export function createV3BookCitationAction(params: {
  docId: string
  displayedChapterId: string
  qaCorpusId: string
  readerPosition: V3BookReaderPosition
  manifest: V3BookQACorpusManifest
  citation: Pick<V3BookQAAnswerCitation, "chapter_id" | "chapter_title" | "pid">
}): V3BookCitationAction {
  const label = `${params.citation.chapter_title} / P${params.citation.pid}`
  if (params.citation.chapter_id === params.displayedChapterId) {
    return {
      kind: "scroll",
      label,
      targetId: createV3BookParagraphDomId(params.citation.chapter_id, params.citation.pid),
    }
  }

  const chapter = params.manifest.chapters.find((item) => item.chapter_id === params.citation.chapter_id)
  if (!chapter) {
    return {
      kind: "unavailable",
      label,
      reason: "The citation chapter is not pinned in this BOOK.1 corpus.",
    }
  }

  return {
    kind: "navigate",
    label,
    href: createV3WorkbenchHref({
      docId: params.docId,
      chapterId: chapter.chapter_id,
      runId: chapter.run_id,
      source: "v3",
      view: "qa",
      qaCorpusId: params.qaCorpusId,
      readerPosition: params.readerPosition,
    }),
  }
}
