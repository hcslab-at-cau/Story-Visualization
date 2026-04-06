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
 *         updatedAt: Timestamp
 *         stageModels: Record<string, string>
 *         ...
 *         /artifacts/{stageKey}/
 *           ...stage artifact payload
 *
 * Legacy runs may still embed stage payloads directly on /runs/{runId}.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  deleteDoc,
  deleteField,
  serverTimestamp,
  query,
  orderBy,
  limit,
  type DocumentData,
} from "firebase/firestore"
import { getDb } from "./firebase"
import type { RawChapter, PipelineArtifact, StageId } from "@/types/schema"
import type { StoredSourceFile } from "./storage"

function runDocRef(docId: string, chapterId: string, runId: string) {
  const db = getDb()
  return doc(db, "documents", docId, "chapters", chapterId, "runs", runId)
}

function runArtifactsCollection(docId: string, chapterId: string, runId: string) {
  const db = getDb()
  return collection(db, "documents", docId, "chapters", chapterId, "runs", runId, "artifacts")
}

function runArtifactDocRef(
  docId: string,
  chapterId: string,
  runId: string,
  stageKeyValue: string,
) {
  const db = getDb()
  return doc(
    db,
    "documents",
    docId,
    "chapters",
    chapterId,
    "runs",
    runId,
    "artifacts",
    stageKeyValue,
  )
}

function stripUndefinedDeep(value: unknown): unknown {
  if (value === undefined) return undefined
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const sanitized = stripUndefinedDeep(item)
      return sanitized === undefined ? [] : [sanitized]
    })
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).flatMap(([key, nestedValue]) => {
      const sanitized = stripUndefinedDeep(nestedValue)
      return sanitized === undefined ? [] : [[key, sanitized] as const]
    })
    return Object.fromEntries(entries)
  }
  return value
}

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
  const sanitizedArtifact = stripUndefinedDeep(artifact)
  await setDoc(
    runArtifactDocRef(docId, chapterId, runId, stageKey),
    sanitizedArtifact as Record<string, unknown>,
  )
  await setDoc(
    runDocRef(docId, chapterId, runId),
    { updatedAt: serverTimestamp() },
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
  const artifactSnap = await getDoc(
    runArtifactDocRef(docId, chapterId, runId, stageKey),
  )
  if (artifactSnap.exists()) {
    return artifactSnap.data() as T
  }

  const legacySnap = await getDoc(runDocRef(docId, chapterId, runId))
  if (!legacySnap.exists()) return null
  const data = legacySnap.data() as DocumentData
  return (data[stageKey] as T) ?? null
}

/** Load all stage results from a run document. */
export async function loadRunResults(
  docId: string,
  chapterId: string,
  runId: string,
): Promise<Record<string, unknown>> {
  const [runSnap, artifactsSnap] = await Promise.all([
    getDoc(runDocRef(docId, chapterId, runId)),
    getDocs(runArtifactsCollection(docId, chapterId, runId)),
  ])

  if (!runSnap.exists() && artifactsSnap.empty) return {}

  const merged = runSnap.exists()
    ? { ...(runSnap.data() as Record<string, unknown>) }
    : {}

  for (const artifactDoc of artifactsSnap.docs) {
    merged[artifactDoc.id] = artifactDoc.data()
  }

  return merged
}

export async function forkRunResults(
  docId: string,
  chapterId: string,
  sourceRunId: string,
  targetRunId: string,
  stagesToCopy: StageId[],
): Promise<void> {
  const source = await loadRunResults(docId, chapterId, sourceRunId)
  const nextData: Record<string, unknown> = {
    forkedFrom: sourceRunId,
    updatedAt: serverTimestamp(),
  }

  await setDoc(
    runDocRef(docId, chapterId, targetRunId),
    nextData,
  )

  for (const stageId of stagesToCopy) {
    const key = stageKey(stageId)
    const artifact = source[key]
    if (artifact !== undefined) {
      await setDoc(
        runArtifactDocRef(docId, chapterId, targetRunId, key),
        stripUndefinedDeep(artifact) as Record<string, unknown>,
      )
    }
  }
}

export async function saveRunStageModels(
  docId: string,
  chapterId: string,
  runId: string,
  stageModels: Partial<Record<StageId, string>>,
): Promise<void> {
  const serialized = Object.fromEntries(
    Object.entries(stageModels)
      .filter((entry): entry is [StageId, string] => typeof entry[1] === "string")
      .map(([stageId, model]) => [stageKey(stageId), model]),
  )

  await setDoc(
    runDocRef(docId, chapterId, runId),
    {
      stageModels: serialized,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}

export async function deleteStageResult(
  docId: string,
  chapterId: string,
  runId: string,
  stageId: StageId,
): Promise<void> {
  const key = stageKey(stageId)
  await deleteDoc(runArtifactDocRef(docId, chapterId, runId, key))
  await setDoc(
    runDocRef(docId, chapterId, runId),
    {
      [key]: deleteField(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}

export async function deleteRun(
  docId: string,
  chapterId: string,
  runId: string,
): Promise<void> {
  const artifactsSnap = await getDocs(runArtifactsCollection(docId, chapterId, runId))
  await Promise.all(artifactsSnap.docs.map((artifactDoc) => deleteDoc(artifactDoc.ref)))
  await deleteDoc(runDocRef(docId, chapterId, runId))
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
