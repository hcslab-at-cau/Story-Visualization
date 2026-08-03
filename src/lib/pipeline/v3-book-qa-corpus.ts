import { createHash } from "node:crypto"
import {
  V3_BOOK_QA_CORPUS_VERSION,
  V3_BOOK_QA_PINNED_STAGE_IDS,
  V3_BOOK_QA_STAGE_ID,
  type V3BookQAChapterRef,
  type V3BookQACorpusManifest,
  type V3BookQAPinnedStageId,
  type V3BookQAReadinessDiagnostic,
  type V3BookQAReadableChapter,
  type V3BookReaderPosition,
} from "./v3-book-qa-types"

export type V3BookReaderPositionValidationCode =
  | "unknown_chapter"
  | "invalid_pid"
  | "pid_after_chapter_end"

export class V3BookReaderPositionValidationError extends Error {
  readonly code: V3BookReaderPositionValidationCode
  readonly position: V3BookReaderPosition

  constructor(
    code: V3BookReaderPositionValidationCode,
    message: string,
    position: V3BookReaderPosition,
  ) {
    super(message)
    this.name = "V3BookReaderPositionValidationError"
    this.code = code
    this.position = { ...position }
  }
}

function assertValidChapterOrder(chapters: V3BookQAChapterRef[]): void {
  const seenChapterIds = new Set<string>()
  let previousIndex: number | undefined

  for (const chapter of chapters) {
    if (seenChapterIds.has(chapter.chapter_id)) {
      throw new Error(`Duplicate chapter_id: ${chapter.chapter_id}`)
    }
    seenChapterIds.add(chapter.chapter_id)

    if (!Number.isInteger(chapter.chapter_index)) {
      throw new Error(`chapter_index must be an integer for ${chapter.chapter_id}`)
    }
    if (previousIndex !== undefined && chapter.chapter_index <= previousIndex) {
      throw new Error("chapter_index values are inconsistent with supplied server order")
    }
    previousIndex = chapter.chapter_index

    if (!Number.isInteger(chapter.progress_end_pid) || chapter.progress_end_pid < 0) {
      throw new Error(`progress_end_pid must be a non-negative integer for ${chapter.chapter_id}`)
    }
  }
}

function identityArtifactEntries(
  artifactIds: V3BookQAChapterRef["artifact_ids"],
): Array<[V3BookQAPinnedStageId, string | null]> {
  return V3_BOOK_QA_PINNED_STAGE_IDS.map((stageId) => [stageId, artifactIds[stageId] ?? null])
}

export function serializeV3BookQACorpusIdentity(
  docId: string,
  chapters: V3BookQAChapterRef[],
): string {
  assertValidChapterOrder(chapters)
  return JSON.stringify({
    doc_id: docId,
    chapters: chapters.map((chapter) => ({
      chapter_id: chapter.chapter_id,
      chapter_title: chapter.chapter_title,
      chapter_index: chapter.chapter_index,
      run_id: chapter.run_id,
      progress_end_pid: chapter.progress_end_pid,
      artifacts: identityArtifactEntries(chapter.artifact_ids),
    })),
  })
}

export function fingerprintV3BookQACorpus(
  docId: string,
  chapters: V3BookQAChapterRef[],
): string {
  return createHash("sha256")
    .update(serializeV3BookQACorpusIdentity(docId, chapters))
    .digest("hex")
}

function readinessSortKey(
  diagnostic: V3BookQAReadinessDiagnostic,
  chapterOrder: Map<string, number>,
): [number, number, string, string, string] {
  return [
    chapterOrder.get(diagnostic.chapter_id) ?? Number.MAX_SAFE_INTEGER,
    V3_BOOK_QA_PINNED_STAGE_IDS.indexOf(diagnostic.stage_id),
    diagnostic.run_id,
    diagnostic.code,
    diagnostic.message,
  ]
}

function compareTuple(
  left: Array<number | string>,
  right: Array<number | string>,
): number {
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index]
    const rightValue = right[index]
    if (leftValue === rightValue) continue
    if (typeof leftValue === "number" && typeof rightValue === "number") {
      return leftValue - rightValue
    }
    return String(leftValue).localeCompare(String(rightValue))
  }
  return 0
}

export function buildV3BookQACorpusManifest(params: {
  docId: string
  chapters: V3BookQAChapterRef[]
  readiness?: V3BookQAReadinessDiagnostic[]
}): V3BookQACorpusManifest {
  assertValidChapterOrder(params.chapters)
  const chapters = params.chapters.map((chapter) => ({
    ...chapter,
    artifact_ids: { ...chapter.artifact_ids },
  }))
  const fingerprint = fingerprintV3BookQACorpus(params.docId, chapters)
  const chapterOrder = new Map(chapters.map((chapter, index) => [chapter.chapter_id, index]))
  const readiness = [...(params.readiness ?? [])]
    .map((diagnostic) => ({ ...diagnostic }))
    .sort((left, right) => compareTuple(
      readinessSortKey(left, chapterOrder),
      readinessSortKey(right, chapterOrder),
    ))

  return {
    stage_id: V3_BOOK_QA_STAGE_ID,
    artifact_version: V3_BOOK_QA_CORPUS_VERSION,
    qa_corpus_id: `BOOK1_${fingerprint.slice(0, 32)}`,
    doc_id: params.docId,
    ordered_chapter_ids: chapters.map((chapter) => chapter.chapter_id),
    chapters,
    fingerprint,
    readiness,
  }
}

export function validateV3BookReaderPosition(
  manifest: V3BookQACorpusManifest,
  position: V3BookReaderPosition,
): V3BookReaderPosition {
  const chapter = manifest.chapters.find((item) => item.chapter_id === position.chapter_id)
  if (!chapter) {
    throw new V3BookReaderPositionValidationError(
      "unknown_chapter",
      `Reader chapter is not in BOOK.1: ${position.chapter_id}`,
      position,
    )
  }
  if (!Number.isInteger(position.pid) || position.pid < 0) {
    throw new V3BookReaderPositionValidationError(
      "invalid_pid",
      `Reader PID must be a non-negative integer: ${position.pid}`,
      position,
    )
  }
  if (position.pid > chapter.progress_end_pid) {
    throw new V3BookReaderPositionValidationError(
      "pid_after_chapter_end",
      `Reader PID ${position.pid} exceeds ${position.chapter_id} end PID ${chapter.progress_end_pid}`,
      position,
    )
  }
  return { ...position }
}

export function selectV3BookReadableChapters(
  manifest: V3BookQACorpusManifest,
  position: V3BookReaderPosition,
): V3BookQAReadableChapter[] {
  validateV3BookReaderPosition(manifest, position)
  const currentIndex = manifest.ordered_chapter_ids.indexOf(position.chapter_id)

  return manifest.chapters.slice(0, currentIndex + 1).map((chapter) => {
    const isCurrent = chapter.chapter_id === position.chapter_id
    return {
      ...chapter,
      artifact_ids: { ...chapter.artifact_ids },
      readable_through_pid: isCurrent ? position.pid : chapter.progress_end_pid,
      is_current: isCurrent,
    }
  })
}
