/**
 * PRE.1 — EPUB to RawChapter JSON
 *
 * The EPUB is parsed during upload and stored as chapter-level `raw` data.
 * This stage materializes that normalized chapter JSON into the current run so
 * the user can inspect the pipeline from the very first pre-processing step.
 */

import type { PreparedChapter, RawChapter } from "@/types/schema"

export async function runRawChapterPreparation(
  chapter: RawChapter,
  docId: string,
  chapterId: string,
  parents: Record<string, string> = {},
  onProgress?: (msg: string) => void,
): Promise<PreparedChapter> {
  onProgress?.("PRE.1: packaging raw chapter JSON...")

  const runId = `raw_chapter__${docId}__${chapterId}`
  return {
    run_id: runId,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: "PRE.1",
    parents,
    method: "epub+rule",
    chapter_title: chapter.title,
    source_type: chapter.source?.type,
    paragraph_count: chapter.paragraphs.length,
    char_count: chapter.text.length,
    raw_chapter: chapter,
  }
}
