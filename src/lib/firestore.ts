/**
 * Firestore data access layer.
 *
 * Firestore structure:
 *   /documents/{docId}/
 *     title: string
 *     createdAt: Timestamp
 *     /chapters/{chapterId}/
 *       raw: RawChapter
 *       /runs/{runId}/
 *         pre1: PreparedChapter
 *         pre2: ContentUnits
 *         ent1: MentionCandidates
 *         ...
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  serverTimestamp,
  query,
  orderBy,
  limit,
  type DocumentData,
} from "firebase/firestore"
import { getDb } from "./firebase"
import type { RawChapter, PipelineArtifact, StageId } from "@/types/schema"
import type { StoredSourceFile } from "./storage"

// ---------------------------------------------------------------------------
// Document-level helpers
// ---------------------------------------------------------------------------

export interface DocumentMeta {
  docId: string
  title: string
  createdAt?: unknown
  sourceFile?: StoredSourceFile
}

export async function createDocument(
  title: string,
  sourceFile?: StoredSourceFile,
): Promise<string> {
  const db = getDb()
  const ref = await addDoc(collection(db, "documents"), {
    title,
    createdAt: serverTimestamp(),
    ...(sourceFile ? { sourceFile } : {}),
  })
  return ref.id
}

export async function setDocumentSourceFile(
  docId: string,
  sourceFile: StoredSourceFile,
): Promise<void> {
  const db = getDb()
  await setDoc(
    doc(db, "documents", docId),
    { sourceFile, updatedAt: serverTimestamp() },
    { merge: true },
  )
}

export async function listDocuments(): Promise<DocumentMeta[]> {
  const db = getDb()
  const snap = await getDocs(
    query(collection(db, "documents"), orderBy("createdAt", "desc")),
  )
  return snap.docs.map((d) => ({
    docId: d.id,
    ...(d.data() as Omit<DocumentMeta, "docId">),
  }))
}

// ---------------------------------------------------------------------------
// Chapter-level helpers
// ---------------------------------------------------------------------------

export interface ChapterMeta {
  chapterId: string
  title: string
  index: number
}

export async function saveRawChapter(
  docId: string,
  chapter: RawChapter,
): Promise<void> {
  const db = getDb()
  await setDoc(
    doc(db, "documents", docId, "chapters", chapter.chapter_id),
    { raw: chapter },
    { merge: true },
  )
}

export async function loadRawChapter(
  docId: string,
  chapterId: string,
): Promise<RawChapter | null> {
  const db = getDb()
  const snap = await getDoc(
    doc(db, "documents", docId, "chapters", chapterId),
  )
  if (!snap.exists()) return null
  const data = snap.data() as DocumentData
  return (data.raw as RawChapter) ?? null
}

export async function listChapters(docId: string): Promise<ChapterMeta[]> {
  const db = getDb()
  const snap = await getDocs(
    collection(db, "documents", docId, "chapters"),
  )
  return snap.docs
    .map((d) => {
      const data = d.data() as DocumentData
      const raw = data.raw as RawChapter | undefined
      return {
        chapterId: d.id,
        title: raw?.title ?? d.id,
        index: parseInt(d.id.replace(/\D/g, "") || "0", 10),
      }
    })
    .sort((a, b) => a.index - b.index)
}

// ---------------------------------------------------------------------------
// Run / artifact helpers
// ---------------------------------------------------------------------------

/** Save a pipeline stage artifact into /documents/{docId}/chapters/{chapterId}/runs/{runId}/{stageKey} */
export async function saveStageResult(
  docId: string,
  chapterId: string,
  runId: string,
  stageKey: string,
  artifact: PipelineArtifact,
): Promise<void> {
  const db = getDb()
  await setDoc(
    doc(db, "documents", docId, "chapters", chapterId, "runs", runId),
    { [stageKey]: artifact, updatedAt: serverTimestamp() },
    { merge: true },
  )
}

/** Load a single stage artifact from a run document. */
export async function loadStageResult<T extends PipelineArtifact>(
  docId: string,
  chapterId: string,
  runId: string,
  stageKey: string,
): Promise<T | null> {
  const db = getDb()
  const snap = await getDoc(
    doc(db, "documents", docId, "chapters", chapterId, "runs", runId),
  )
  if (!snap.exists()) return null
  const data = snap.data() as DocumentData
  return (data[stageKey] as T) ?? null
}

/** Load all stage results from a run document. */
export async function loadRunResults(
  docId: string,
  chapterId: string,
  runId: string,
): Promise<Record<string, unknown>> {
  const db = getDb()
  const snap = await getDoc(
    doc(db, "documents", docId, "chapters", chapterId, "runs", runId),
  )
  if (!snap.exists()) return {}
  return snap.data() as Record<string, unknown>
}

export async function forkRunResults(
  docId: string,
  chapterId: string,
  sourceRunId: string,
  targetRunId: string,
  stagesToCopy: StageId[],
): Promise<void> {
  const db = getDb()
  const source = await loadRunResults(docId, chapterId, sourceRunId)
  const nextData: Record<string, unknown> = {
    forkedFrom: sourceRunId,
    updatedAt: serverTimestamp(),
  }

  for (const stageId of stagesToCopy) {
    const key = stageKey(stageId)
    if (source[key] !== undefined) {
      nextData[key] = source[key]
    }
  }

  await setDoc(
    doc(db, "documents", docId, "chapters", chapterId, "runs", targetRunId),
    nextData,
  )
}

/** List runs for a chapter (most recent first). */
export async function listRuns(
  docId: string,
  chapterId: string,
  maxRuns = 20,
): Promise<Array<{ runId: string; updatedAt: unknown }>> {
  const db = getDb()
  const snap = await getDocs(
    query(
      collection(db, "documents", docId, "chapters", chapterId, "runs"),
      orderBy("updatedAt", "desc"),
      limit(maxRuns),
    ),
  )
  return snap.docs.map((d) => ({
    runId: d.id,
    updatedAt: (d.data() as DocumentData).updatedAt,
  }))
}

/** stageId → Firestore field key (e.g. "PRE.1" → "pre1") */
export function stageKey(stageId: StageId): string {
  return stageId.replace(".", "").toLowerCase()
}
