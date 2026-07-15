/**
 * Server-side Firestore data access layer.
 *
 * API routes use Firebase Admin SDK so Firestore security rules do not block
 * document/run/artifact operations. Client components should call API routes
 * instead of importing this module directly.
 */

import { createHash } from "crypto"
import { FieldPath, FieldValue, Timestamp, type DocumentData, type WriteBatch } from "firebase-admin/firestore"
import { PIPELINE_STAGE_EDGES } from "@/config/pipeline-graph"
import {
  buildBookMemorySnapshot,
  createBookMemoryRunId,
  type BookMemoryChapterInput,
} from "./book-memory"
import { displayChapterTitle, isLikelyNonStoryChapter } from "./chapter-normalization"
import {
  CURRENT_DOCUMENTS_COLLECTION,
  LEGACY_DOCUMENTS_COLLECTION,
  firestoreDocumentsCollectionName,
  parseFirestoreDataSource,
  type FirestoreDataSource,
} from "./data-source"
import { explainAdminCredentialError, getAdminDb } from "./firebase-admin"
import { projectKnowledgeGraphArtifact } from "./knowledge-graph"
import { stageKey } from "./stage-key"
import type {
  EntityGraph,
  PipelineArtifact,
  RawChapter,
  ReaderSupportEvent,
  StageId,
  SupportMemoryLog,
} from "@/types/schema"
import type { BookMemorySnapshot } from "@/types/book-memory"
import type {
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
  KnowledgeGraphNodeKind,
  KnowledgeGraphQuery,
  KnowledgeGraphQueryResult,
} from "@/types/graph"
import type { StoredSourceFile } from "./storage"
import {
  createV3QAHistoryScopeId,
  decodeV3QAHistoryCursor,
  normalizeV3QAHistoryPage,
  normalizeV3QAHistoryStoredEntry,
  V3QAHistoryValidationError,
  type NormalizedV3QAHistoryCreateInput,
} from "./server/v3-qa-history"
import {
  V3_QA_HISTORY_PAGE_SIZE,
  V3_QA_HISTORY_SCHEMA_VERSION,
  type V3QAHistoryDeleteRequest,
  type V3QAHistoryEntry,
  type V3QAHistoryPage,
  type V3QAHistoryScopeRequest,
} from "./v3-qa-history-types"

export { stageKey }

export {
  CURRENT_DOCUMENTS_COLLECTION,
  LEGACY_DOCUMENTS_COLLECTION,
  parseFirestoreDataSource,
}

interface FirestoreReadOptions {
  source?: FirestoreDataSource
}

function collectionName(source: FirestoreDataSource = "current"): string {
  return firestoreDocumentsCollectionName(source)
}

function documentsCollection(source: FirestoreDataSource = "current") {
  return getAdminDb().collection(collectionName(source))
}

function documentDocRef(docId: string, source: FirestoreDataSource = "current") {
  return documentsCollection(source).doc(docId)
}

function chapterDocRef(
  docId: string,
  chapterId: string,
  source: FirestoreDataSource = "current",
) {
  return documentDocRef(docId, source).collection("chapters").doc(chapterId)
}

function runDocRef(
  docId: string,
  chapterId: string,
  runId: string,
  source: FirestoreDataSource = "current",
) {
  return getAdminDb()
    .collection(collectionName(source))
    .doc(docId)
    .collection("chapters")
    .doc(chapterId)
    .collection("runs")
    .doc(runId)
}

function runArtifactsCollection(
  docId: string,
  chapterId: string,
  runId: string,
  source: FirestoreDataSource = "current",
) {
  return runDocRef(docId, chapterId, runId, source).collection("artifacts")
}

function runArtifactDocRef(
  docId: string,
  chapterId: string,
  runId: string,
  stageKeyValue: string,
  source: FirestoreDataSource = "current",
) {
  return runArtifactsCollection(docId, chapterId, runId, source).doc(stageKeyValue)
}

function sharedArtifactsCollection(
  docId: string,
  chapterId: string,
  source: FirestoreDataSource = "current",
) {
  return chapterDocRef(docId, chapterId, source).collection("artifacts")
}

function sharedArtifactDocRef(
  docId: string,
  chapterId: string,
  artifactId: string,
  source: FirestoreDataSource = "current",
) {
  return sharedArtifactsCollection(docId, chapterId, source).doc(artifactId)
}

function graphNodesCollection(docId: string, source: FirestoreDataSource = "current") {
  return documentDocRef(docId, source).collection("graph_nodes")
}

function graphEdgesCollection(docId: string, source: FirestoreDataSource = "current") {
  return documentDocRef(docId, source).collection("graph_edges")
}

function bookMemoriesCollection(docId: string, source: FirestoreDataSource = "current") {
  return documentDocRef(docId, source).collection("book_memories")
}

function supportEventsCollection(docId: string, source: FirestoreDataSource = "current") {
  return documentDocRef(docId, source).collection("support_events")
}

function v3QAHistoryScopeRef(docId: string, scopeId: string) {
  return documentDocRef(docId, "v3").collection("qa_history").doc(scopeId)
}

function v3QAHistoryEntriesCollection(docId: string, scopeId: string) {
  return v3QAHistoryScopeRef(docId, scopeId).collection("entries")
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

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`
  }

  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`
}

function artifactIdFor(stageKeyValue: string, artifact: unknown): string {
  const hash = createHash("sha256")
    .update(stableStringify(artifact))
    .digest("hex")
    .slice(0, 24)
  return `${stageKeyValue}_${hash}`
}

function readStageRefs(data: DocumentData | undefined): Record<string, string> {
  const raw = data?.stageRefs
  if (!raw || typeof raw !== "object") return {}
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  )
}

const KNOWN_STAGE_IDS = Array.from(
  new Set(PIPELINE_STAGE_EDGES.flatMap((edge) => [edge.from, edge.to])),
) as StageId[]

const REQUIRED_STAGE_DEPENDENCIES: Partial<Record<StageId, StageId[]>> = {
  "PRE.2": ["PRE.1"],
  "EVID.1A": ["PRE.2"],
  "EVID.1B": ["PRE.2"],
  "EVID.1C": ["PRE.2"],
  "EVID.1D": ["PRE.2"],
  "EVID.2": ["EVID.1A", "EVID.1B", "EVID.1C", "EVID.1D"],
  "EVID.3": ["EVID.2"],
  "EVID.4": ["EVID.3"],
  "EVENT.1": ["EVID.3", "EVID.4"],
  "SCENE.0": ["EVENT.1"],
  "MEM.0": ["EVENT.1", "SCENE.0"],
  "MEM.1": ["MEM.0"],
  "EVENT.2": ["MEM.0", "MEM.1"],
  "GOAL.1": ["EVENT.2", "MEM.0", "MEM.1"],
  "CAUS.1": ["EVENT.2", "GOAL.1", "MEM.0"],
  "MEM.2": ["MEM.1", "EVENT.2", "GOAL.1", "CAUS.1"],
  "IDX.1": ["MEM.1", "EVENT.2", "GOAL.1", "CAUS.1", "MEM.2"],
  "IDX.2": ["IDX.1"],
  "ENT.1": ["PRE.2"],
  "ENT.2": ["ENT.1"],
  "ENT.3": ["ENT.2"],
  "STATE.1": ["ENT.3"],
  "STATE.2": ["STATE.1", "ENT.3", "PRE.2"],
  "STATE.3": ["STATE.2"],
  "SCENE.1": ["STATE.3", "STATE.2", "STATE.1", "ENT.3"],
  "SCENE.2": ["SCENE.1"],
  "SCENE.3": ["SCENE.1", "SCENE.2", "ENT.3", "STATE.2"],
  "VIS.1": ["SCENE.1"],
  "VIS.2": ["SCENE.1", "SCENE.3"],
  "VIS.3": ["VIS.2"],
  "VIS.4": ["VIS.3"],
  "SUB.1": ["SCENE.3", "SCENE.1"],
  "SUB.2": ["SUB.1", "SCENE.1", "SCENE.3"],
  "SUB.3": ["SUB.1", "SUB.2", "SCENE.1", "SCENE.3"],
  "SUB.4": ["SUB.3", "SCENE.1", "SCENE.3"],
  "SUP.0": ["SCENE.1", "STATE.3", "SCENE.3"],
  "SUP.1": ["SUP.0"],
  "SUP.2": ["SUP.1"],
  "SUP.3": ["SUP.1", "SUP.0"],
  "SUP.4": ["SUP.1", "SUP.0"],
  "SUP.5": ["SUP.1", "SUP.0"],
  "SUP.6": ["SUP.2", "SUP.3", "SUP.4", "SUP.5"],
  "SUP.7": ["SUP.6", "SUP.1"],
  "FINAL.1": ["SCENE.3", "SUB.3", "SCENE.1", "STATE.3"],
  "FINAL.2": ["FINAL.1"],
}

interface StageDependencyIssue {
  stageId: StageId
  missingStageId: StageId
}

function readPresentStageKeys(data: DocumentData | undefined): Set<string> {
  const keys = new Set(Object.keys(readStageRefs(data)))
  for (const stageId of KNOWN_STAGE_IDS) {
    const key = stageKey(stageId)
    if (data?.[key] !== undefined) {
      keys.add(key)
    }
  }
  return keys
}

function findStageDependencyIssue(data: DocumentData | undefined): StageDependencyIssue | null {
  const presentStageKeys = readPresentStageKeys(data)
  if (presentStageKeys.size === 0) return null

  for (const stageId of KNOWN_STAGE_IDS) {
    if (!presentStageKeys.has(stageKey(stageId))) continue
    for (const dependencyStageId of REQUIRED_STAGE_DEPENDENCIES[stageId] ?? []) {
      if (!presentStageKeys.has(stageKey(dependencyStageId))) {
        return {
          stageId,
          missingStageId: dependencyStageId,
        }
      }
    }
  }

  return null
}

function uniqueStageRefArtifactIds(data: DocumentData | undefined): string[] {
  return uniqueStrings(Object.values(readStageRefs(data)))
}

async function findSharedArtifactIdsUnusedByOtherRuns(params: {
  docId: string
  chapterId: string
  runId: string
  artifactIds: string[]
  source?: FirestoreDataSource
}): Promise<string[]> {
  const candidates = new Set(params.artifactIds)
  if (candidates.size === 0) return []

  const runsSnap = await chapterDocRef(params.docId, params.chapterId, params.source)
    .collection("runs")
    .get()

  for (const runDoc of runsSnap.docs) {
    if (runDoc.id === params.runId) continue
    for (const artifactId of uniqueStageRefArtifactIds(runDoc.data() as DocumentData)) {
      candidates.delete(artifactId)
    }
    if (candidates.size === 0) break
  }

  return [...candidates]
}

function buildParentRefs(stageId: string, stageRefs: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    PIPELINE_STAGE_EDGES
      .filter((edge) => edge.to === stageId)
      .map((edge) => [edge.from, stageRefs[stageKey(edge.from)] ?? ""] as const)
      .filter(([, artifactId]) => artifactId.length > 0),
  )
}

function prepareArtifactForStorage(
  stageKeyValue: string,
  artifact: PipelineArtifact,
  stageRefs: Record<string, string>,
): { artifactId: string; payload: Record<string, unknown> } {
  const parents = {
    ...(artifact.parents ?? {}),
    ...buildParentRefs(artifact.stage_id, stageRefs),
  }
  const sanitizedArtifact = stripUndefinedDeep({
    ...artifact,
    parents,
  }) as Record<string, unknown>
  const artifactId = artifactIdFor(stageKeyValue, sanitizedArtifact)

  return {
    artifactId,
    payload: {
      ...sanitizedArtifact,
      artifact_id: artifactId,
    },
  }
}

interface QueuedArtifactWrite {
  artifactId: string
  payload: Record<string, unknown>
}

function queueSharedArtifactWrite(params: {
  batch: WriteBatch
  docId: string
  chapterId: string
  stageKeyValue: string
  artifact: PipelineArtifact
  stageRefs: Record<string, string>
  source?: FirestoreDataSource
}): QueuedArtifactWrite {
  const { artifactId, payload } = prepareArtifactForStorage(
    params.stageKeyValue,
    params.artifact,
    params.stageRefs,
  )
  params.batch.set(
    sharedArtifactDocRef(params.docId, params.chapterId, artifactId, params.source),
    {
      artifactId,
      stageKey: params.stageKeyValue,
      stageId: params.artifact.stage_id,
      docId: params.docId,
      chapterId: params.chapterId,
      payload,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )
  return { artifactId, payload }
}

function artifactPayloadFromDoc(data: DocumentData | undefined): Record<string, unknown> | null {
  if (!data) return null
  const payload = data.payload
  if (payload && typeof payload === "object") {
    return payload as Record<string, unknown>
  }
  return data as Record<string, unknown>
}

async function withAdminErrorContext<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw explainAdminCredentialError(error)
  }
}

function supportsKnowledgeGraphProjection(stageId: string): boolean {
  return stageId === "SUP.0" || stageId === "ENT.3"
}

async function commitBatched<T>(
  items: T[],
  apply: (batch: WriteBatch, item: T) => void,
): Promise<void> {
  for (let index = 0; index < items.length; index += 400) {
    const batch = getAdminDb().batch()
    for (const item of items.slice(index, index + 400)) {
      apply(batch, item)
    }
    await batch.commit()
  }
}

async function clearKnowledgeGraphProjection(params: {
  docId: string
  chapterId: string
  runId: string
  sourceStageId: string
  source?: FirestoreDataSource
}): Promise<void> {
  const [nodesSnap, edgesSnap] = await Promise.all([
    graphNodesCollection(params.docId, params.source).where("runId", "==", params.runId).get(),
    graphEdgesCollection(params.docId, params.source).where("runId", "==", params.runId).get(),
  ])
  const docsToDelete = [...nodesSnap.docs, ...edgesSnap.docs].filter((docSnap) => {
    const data = docSnap.data() as DocumentData
    return data.chapterId === params.chapterId && data.sourceStageId === params.sourceStageId
  })

  await commitBatched(docsToDelete, (batch, docSnap) => {
    batch.delete(docSnap.ref)
  })
}

async function replaceKnowledgeGraphProjection(params: {
  docId: string
  chapterId: string
  runId: string
  sourceArtifactId: string
  artifact: PipelineArtifact
  source?: FirestoreDataSource
}): Promise<void> {
  if (!supportsKnowledgeGraphProjection(params.artifact.stage_id)) return

  const projection = projectKnowledgeGraphArtifact(params)
  await clearKnowledgeGraphProjection({
    docId: params.docId,
    chapterId: params.chapterId,
    runId: params.runId,
    sourceStageId: params.artifact.stage_id,
    source: params.source,
  })

  const nowFields = {
    updatedAt: FieldValue.serverTimestamp(),
  }
  await commitBatched(projection.nodes, (batch, node) => {
    const nodeData = stripUndefinedDeep(node) as DocumentData
    batch.set(graphNodesCollection(params.docId, params.source).doc(node.nodeId), {
      ...nodeData,
      ...nowFields,
    })
  })
  await commitBatched(projection.edges, (batch, edge) => {
    const edgeData = stripUndefinedDeep(edge) as DocumentData
    batch.set(graphEdgesCollection(params.docId, params.source).doc(edge.edgeId), {
      ...edgeData,
      ...nowFields,
    })
  })
}

// ---------------------------------------------------------------------------
// Document-level helpers
// ---------------------------------------------------------------------------

function historyTimestampIso(value: unknown): string {
  if (value instanceof Timestamp) return value.toDate().toISOString()
  if (value && typeof value === "object" && "toDate" in value) {
    const date = (value as { toDate: () => Date }).toDate()
    if (date instanceof Date && Number.isFinite(date.getTime())) return date.toISOString()
  }
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString()
  }
  throw new Error("QA history entry has no valid created_at timestamp")
}

function historyEntryFromDoc(docSnap: { id: string; data: () => DocumentData | undefined }): V3QAHistoryEntry {
  const data = docSnap.data()
  if (!data) throw new Error(`QA history entry ${docSnap.id} has no data`)
  return normalizeV3QAHistoryStoredEntry({
    ...data,
    entry_id: docSnap.id,
    created_at: historyTimestampIso(data.created_at),
  })
}

export async function saveV3QAHistoryEntry(
  input: NormalizedV3QAHistoryCreateInput,
): Promise<V3QAHistoryEntry> {
  return withAdminErrorContext(async () => {
    const scopeId = createV3QAHistoryScopeId(input.chapterId, input.runId)
    const scopeRef = v3QAHistoryScopeRef(input.docId, scopeId)
    const entryRef = scopeRef.collection("entries").doc()
    const batch = getAdminDb().batch()

    batch.set(scopeRef, {
      chapter_id: input.chapterId,
      run_id: input.runId,
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true })
    batch.set(entryRef, {
      schema_version: V3_QA_HISTORY_SCHEMA_VERSION,
      entry_id: entryRef.id,
      doc_id: input.docId,
      chapter_id: input.chapterId,
      run_id: input.runId,
      question: input.question,
      progress_end_pid: input.progressEndPid,
      answer_snapshot: stripUndefinedDeep(input.answer_snapshot),
      created_at: FieldValue.serverTimestamp(),
    })
    await batch.commit()

    const saved = await entryRef.get()
    return historyEntryFromDoc(saved)
  })
}

export async function listV3QAHistoryEntries(
  input: V3QAHistoryScopeRequest,
): Promise<V3QAHistoryPage> {
  return withAdminErrorContext(async () => {
    const scopeId = createV3QAHistoryScopeId(input.chapterId, input.runId)
    const entries = v3QAHistoryEntriesCollection(input.docId, scopeId)
    const cursor = input.cursor ? decodeV3QAHistoryCursor(input.cursor) : null
    if (input.cursor && !cursor) throw new V3QAHistoryValidationError("Invalid QA history cursor")

    const ordered = entries
      .orderBy("created_at", "desc")
      .orderBy(FieldPath.documentId(), "desc")
    const query = cursor
      ? ordered.startAfter(Timestamp.fromMillis(cursor.createdAtMs), cursor.entryId)
      : ordered
    const snapshot = await query.limit(V3_QA_HISTORY_PAGE_SIZE + 1).get()
    return normalizeV3QAHistoryPage(snapshot.docs.map(historyEntryFromDoc))
  })
}

export async function deleteV3QAHistoryEntry(
  input: V3QAHistoryDeleteRequest,
): Promise<boolean> {
  return withAdminErrorContext(async () => {
    const scopeId = createV3QAHistoryScopeId(input.chapterId, input.runId)
    const entryRef = v3QAHistoryEntriesCollection(input.docId, scopeId).doc(input.entryId)
    const saved = await entryRef.get()
    if (!saved.exists) return false
    const data = saved.data() as DocumentData
    if (data.doc_id !== input.docId || data.chapter_id !== input.chapterId || data.run_id !== input.runId) {
      return false
    }
    await entryRef.delete()
    return true
  })
}

export interface DocumentMeta {
  docId: string
  title: string
  createdAt?: unknown
  sourceFile?: StoredSourceFile
}

export async function createDocument(
  title: string,
  sourceFile?: StoredSourceFile,
  options: FirestoreReadOptions = {},
): Promise<string> {
  return withAdminErrorContext(async () => {
    const ref = await documentsCollection(options.source).add({
      title,
      createdAt: FieldValue.serverTimestamp(),
      storageVersion: 2,
      ...(sourceFile ? { sourceFile } : {}),
    })
    return ref.id
  })
}

export async function setDocumentSourceFile(
  docId: string,
  sourceFile: StoredSourceFile,
  options: FirestoreReadOptions = {},
): Promise<void> {
  await withAdminErrorContext(async () => {
    await documentDocRef(docId, options.source).set(
      { sourceFile, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    )
  })
}

export async function listDocuments(options: FirestoreReadOptions = {}): Promise<DocumentMeta[]> {
  return withAdminErrorContext(async () => {
    const snap = await documentsCollection(options.source)
      .orderBy("createdAt", "desc")
      .get()

    return snap.docs.map((d) => ({
      docId: d.id,
      ...(d.data() as Omit<DocumentMeta, "docId">),
    }))
  })
}

export async function loadDocumentMeta(
  docId: string,
  options: FirestoreReadOptions = {},
): Promise<DocumentMeta | null> {
  return withAdminErrorContext(async () => {
    const snap = await documentDocRef(docId, options.source).get()
    if (!snap.exists) return null
    return {
      docId: snap.id,
      ...(snap.data() as Omit<DocumentMeta, "docId">),
    }
  })
}

// ---------------------------------------------------------------------------
// Chapter-level helpers
// ---------------------------------------------------------------------------

export interface ChapterMeta {
  chapterId: string
  title: string
  index: number
}

export interface RunMeta {
  runId: string
  updatedAt: unknown
  favorite?: boolean
}

export async function saveRawChapter(
  docId: string,
  chapter: RawChapter,
  options: FirestoreReadOptions = {},
): Promise<void> {
  await withAdminErrorContext(async () => {
    await chapterDocRef(docId, chapter.chapter_id, options.source).set({ raw: chapter }, { merge: true })
  })
}

export async function loadRawChapter(
  docId: string,
  chapterId: string,
  options: FirestoreReadOptions = {},
): Promise<RawChapter | null> {
  return withAdminErrorContext(async () => {
    const snap = await chapterDocRef(docId, chapterId, options.source).get()
    if (!snap.exists) return null
    const data = snap.data() as DocumentData
    return (data.raw as RawChapter) ?? null
  })
}

const RAW_CHAPTER_DUPLICATE_MIN_CHARS = 400

function rawChapterDuplicateFingerprint(raw: RawChapter | undefined): string | undefined {
  const text = raw?.text.replace(/\s+/g, " ").trim()
  if (!text || text.length < RAW_CHAPTER_DUPLICATE_MIN_CHARS) return undefined
  return createHash("sha256").update(text).digest("hex")
}

export async function listChapters(
  docId: string,
  options: FirestoreReadOptions = {},
): Promise<ChapterMeta[]> {
  return withAdminErrorContext(async () => {
    const snap = await documentDocRef(docId, options.source).collection("chapters").get()
    const seenFingerprints = new Set<string>()

    return snap.docs
      .map((d) => {
        const data = d.data() as DocumentData
        const raw = data.raw as RawChapter | undefined
        const index = parseInt(d.id.replace(/\D/g, "") || "0", 10)
        return {
          chapterId: d.id,
          title: displayChapterTitle(raw, d.id, index),
          index,
          raw,
        }
      })
      .filter((chapter) => !isLikelyNonStoryChapter(chapter.raw, chapter.chapterId))
      .sort((a, b) => a.index - b.index)
      .filter((chapter) => {
        const fingerprint = rawChapterDuplicateFingerprint(chapter.raw)
        if (!fingerprint) return true
        if (seenFingerprints.has(fingerprint)) return false
        seenFingerprints.add(fingerprint)
        return true
      })
      .map((chapter) => ({
        chapterId: chapter.chapterId,
        title: chapter.title,
        index: chapter.index,
      }))
  })
}

// ---------------------------------------------------------------------------
// Run / artifact helpers
// ---------------------------------------------------------------------------

export async function saveStageResult(
  docId: string,
  chapterId: string,
  runId: string,
  stageKeyValue: string,
  artifact: PipelineArtifact,
  options: FirestoreReadOptions = {},
): Promise<void> {
  await withAdminErrorContext(async () => {
    const runRef = runDocRef(docId, chapterId, runId, options.source)
    const runSnap = await runRef.get()
    const stageRefs = readStageRefs(runSnap.data())
    const batch = getAdminDb().batch()
    const queuedArtifact = queueSharedArtifactWrite({
      batch,
      docId,
      chapterId,
      stageKeyValue,
      artifact,
      stageRefs,
      source: options.source,
    })
    batch.set(
      runRef,
      {
        storageVersion: 2,
        stageRefs: {
          [stageKeyValue]: queuedArtifact.artifactId,
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    await batch.commit()

    await replaceKnowledgeGraphProjection({
      docId,
      chapterId,
      runId,
      sourceArtifactId: queuedArtifact.artifactId,
      artifact: queuedArtifact.payload as unknown as PipelineArtifact,
      source: options.source,
    })
  })
}

export async function loadStageResult<T extends PipelineArtifact>(
  docId: string,
  chapterId: string,
  runId: string,
  stageKeyValue: string,
  options: FirestoreReadOptions = {},
): Promise<T | null> {
  return withAdminErrorContext(async () => {
    const runSnap = await runDocRef(docId, chapterId, runId, options.source).get()
    const runData = runSnap.data()
    const referencedArtifactId = readStageRefs(runData)[stageKeyValue]
    if (referencedArtifactId) {
      const artifactSnap = await sharedArtifactDocRef(
        docId,
        chapterId,
        referencedArtifactId,
        options.source,
      ).get()
      const payload = artifactPayloadFromDoc(artifactSnap.data())
      if (payload) return payload as T
    }

    const artifactSnap = await runArtifactDocRef(
      docId,
      chapterId,
      runId,
      stageKeyValue,
      options.source,
    ).get()
    if (artifactSnap.exists) {
      return artifactSnap.data() as T
    }

    if (!runSnap.exists) return null
    return (runData?.[stageKeyValue] as T) ?? null
  })
}

export interface StageResultResolution<T extends PipelineArtifact> {
  result: T | null
  runId?: string
  candidateRunIds: string[]
  usedFallback: boolean
}

export async function loadStageResultFromRunOrUnique<T extends PipelineArtifact>(
  docId: string,
  chapterId: string,
  preferredRunId: string,
  stageKeyValue: string,
  options: FirestoreReadOptions = {},
): Promise<StageResultResolution<T>> {
  return withAdminErrorContext(async () => {
    const preferredResult = await loadStageResult<T>(docId, chapterId, preferredRunId, stageKeyValue, options)
    if (preferredResult) {
      return {
        result: preferredResult,
        runId: preferredRunId,
        candidateRunIds: [preferredRunId],
        usedFallback: false,
      }
    }

    const runsSnap = await chapterDocRef(docId, chapterId, options.source).collection("runs").get()
    const candidatePairs = await Promise.all(
      runsSnap.docs
        .map((doc) => doc.id)
        .filter((runId) => runId !== preferredRunId)
        .map(async (runId) => ({
          runId,
          result: await loadStageResult<T>(docId, chapterId, runId, stageKeyValue, options),
        })),
    )
    const candidates = candidatePairs.filter((item): item is { runId: string; result: T } => item.result !== null)

    if (candidates.length === 1) {
      return {
        result: candidates[0].result,
        runId: candidates[0].runId,
        candidateRunIds: [candidates[0].runId],
        usedFallback: true,
      }
    }

    return {
      result: null,
      candidateRunIds: candidates.map((item) => item.runId),
      usedFallback: false,
    }
  })
}

export async function loadRunResults(
  docId: string,
  chapterId: string,
  runId: string,
  options: FirestoreReadOptions = {},
): Promise<Record<string, unknown>> {
  return withAdminErrorContext(async () => {
    const [runSnap, artifactsSnap] = await Promise.all([
      runDocRef(docId, chapterId, runId, options.source).get(),
      runArtifactsCollection(docId, chapterId, runId, options.source).get(),
    ])

    if (!runSnap.exists && artifactsSnap.empty) return {}

    const merged = runSnap.exists
      ? { ...(runSnap.data() as Record<string, unknown>) }
      : {}

    for (const artifactDoc of artifactsSnap.docs) {
      merged[artifactDoc.id] = artifactDoc.data()
    }

    const stageRefs = readStageRefs(runSnap.data())
    await Promise.all(
      Object.entries(stageRefs).map(async ([key, artifactId]) => {
        const artifactSnap = await sharedArtifactDocRef(
          docId,
          chapterId,
          artifactId,
          options.source,
        ).get()
        const payload = artifactPayloadFromDoc(artifactSnap.data())
        if (payload) {
          merged[key] = payload
        }
      }),
    )

    return merged
  })
}

export interface BuildBookMemoryOptions {
  docId: string
  runId?: string
  bookRunId?: string
  chapterRunIds?: Record<string, string>
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))))
}

async function resolveBookMemoryChapterInput(
  chapter: ChapterMeta,
  options: BuildBookMemoryOptions,
): Promise<{
  input?: BookMemoryChapterInput
  missing?: BookMemorySnapshot["missingChapters"][number]
  resolvedRunId?: string
}> {
  const explicitRunId = options.chapterRunIds?.[chapter.chapterId]
  if (explicitRunId) {
    const [supportMemory, entityGraph] = await Promise.all([
      loadStageResult<SupportMemoryLog>(options.docId, chapter.chapterId, explicitRunId, stageKey("SUP.0")),
      loadStageResult<EntityGraph>(options.docId, chapter.chapterId, explicitRunId, stageKey("ENT.3")),
    ])

    if (!supportMemory) {
      return {
        resolvedRunId: explicitRunId,
        missing: {
          chapterId: chapter.chapterId,
          chapterIndex: chapter.index,
          chapterTitle: chapter.title,
          runId: explicitRunId,
          reason: "SUP.0 result not found for the explicitly selected run.",
        },
      }
    }

    return {
      resolvedRunId: explicitRunId,
      input: {
        docId: options.docId,
        chapterId: chapter.chapterId,
        chapterIndex: chapter.index,
        chapterTitle: chapter.title,
        runId: explicitRunId,
        supportMemory,
        entityGraph: entityGraph ?? undefined,
      },
    }
  }

  const runs = await listRuns(options.docId, chapter.chapterId, 20)
  const favoriteRunId = runs.find((run) => run.favorite)?.runId
  const candidateRunIds = uniqueStrings([
    options.runId,
    favoriteRunId,
    ...runs.map((run) => run.runId),
  ])

  if (candidateRunIds.length === 0) {
    return {
      missing: {
        chapterId: chapter.chapterId,
        chapterIndex: chapter.index,
        chapterTitle: chapter.title,
        reason: "No saved run found for this chapter.",
      },
    }
  }

  let firstMissingRunId: string | undefined
  for (const candidateRunId of candidateRunIds) {
    const supportMemory = await loadStageResult<SupportMemoryLog>(
      options.docId,
      chapter.chapterId,
      candidateRunId,
      stageKey("SUP.0"),
    )
    if (!supportMemory) {
      firstMissingRunId ??= candidateRunId
      continue
    }

    const entityGraph = await loadStageResult<EntityGraph>(
      options.docId,
      chapter.chapterId,
      candidateRunId,
      stageKey("ENT.3"),
    )

    return {
      resolvedRunId: candidateRunId,
      input: {
        docId: options.docId,
        chapterId: chapter.chapterId,
        chapterIndex: chapter.index,
        chapterTitle: chapter.title,
        runId: candidateRunId,
        supportMemory,
        entityGraph: entityGraph ?? undefined,
      },
    }
  }

  return {
    resolvedRunId: firstMissingRunId,
    missing: {
      chapterId: chapter.chapterId,
      chapterIndex: chapter.index,
      chapterTitle: chapter.title,
      runId: firstMissingRunId,
      reason: options.runId
        ? "SUP.0 result not found for the preferred/current run or any fallback run."
        : "SUP.0 result not found in available runs.",
    },
  }
}

export async function saveBookMemorySnapshot(
  snapshot: BookMemorySnapshot,
): Promise<void> {
  await withAdminErrorContext(async () => {
    const data = stripUndefinedDeep(snapshot) as DocumentData
    await bookMemoriesCollection(snapshot.docId).doc(snapshot.bookRunId).set(
      {
        ...data,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
  })
}

export async function loadBookMemorySnapshot(
  docId: string,
  bookRunId?: string,
): Promise<BookMemorySnapshot | null> {
  return withAdminErrorContext(async () => {
    if (bookRunId) {
      const snap = await bookMemoriesCollection(docId).doc(bookRunId).get()
      return snap.exists ? (snap.data() as BookMemorySnapshot) : null
    }

    const snap = await bookMemoriesCollection(docId)
      .orderBy("updatedAt", "desc")
      .limit(1)
      .get()
    const latest = snap.docs[0]
    return latest ? (latest.data() as BookMemorySnapshot) : null
  })
}

export async function saveReaderSupportEvent(event: ReaderSupportEvent): Promise<void> {
  await withAdminErrorContext(async () => {
    const data = stripUndefinedDeep(event) as DocumentData
    await supportEventsCollection(event.doc_id).doc(event.event_id).set(
      {
        ...data,
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
  })
}

export async function listReaderSupportEvents(
  docId: string,
  options: {
    sessionId?: string
    maxEvents?: number
  } = {},
): Promise<ReaderSupportEvent[]> {
  return withAdminErrorContext(async () => {
    const maxEvents = Math.max(1, Math.min(options.maxEvents ?? 200, 500))
    const snap = await supportEventsCollection(docId)
      .orderBy("createdAt", "desc")
      .limit(maxEvents)
      .get()
    const events = snap.docs
      .map((docSnap) => docSnap.data() as ReaderSupportEvent)
      .filter((event) => !options.sessionId || event.session_id === options.sessionId)
    return events
  })
}

export async function buildAndSaveBookMemorySnapshot(
  options: BuildBookMemoryOptions,
): Promise<BookMemorySnapshot> {
  return withAdminErrorContext(async () => {
    const chapters = await listChapters(options.docId)
    const chapterInputs: BookMemoryChapterInput[] = []
    const missingChapters: BookMemorySnapshot["missingChapters"] = []
    const resolvedChapterRunIds: Record<string, string> = {}

    for (const chapter of chapters) {
      const resolved = await resolveBookMemoryChapterInput(chapter, options)
      if (resolved.resolvedRunId) {
        resolvedChapterRunIds[chapter.chapterId] = resolved.resolvedRunId
      }
      if (resolved.input) {
        chapterInputs.push(resolved.input)
      } else if (resolved.missing) {
        missingChapters.push(resolved.missing)
      }
    }

    const bookRunId = options.bookRunId ?? createBookMemoryRunId({
      docId: options.docId,
      runId: options.runId,
      chapterRunIds: Object.keys(options.chapterRunIds ?? {}).length > 0
        ? options.chapterRunIds
        : resolvedChapterRunIds,
    })
    const snapshot = buildBookMemorySnapshot({
      bookRunId,
      docId: options.docId,
      chapters: chapterInputs,
      missingChapters,
    })

    await saveBookMemorySnapshot(snapshot)
    return snapshot
  })
}

export async function forkRunResults(
  docId: string,
  chapterId: string,
  sourceRunId: string,
  targetRunId: string,
  stagesToCopy: StageId[],
): Promise<void> {
  await withAdminErrorContext(async () => {
    const sourceRunRef = runDocRef(docId, chapterId, sourceRunId)
    const sourceRunSnap = await sourceRunRef.get()
    const sourceRunData = sourceRunSnap.data()
    const sourceStageRefs = readStageRefs(sourceRunData)
    const source = await loadRunResults(docId, chapterId, sourceRunId)

    const batch = getAdminDb().batch()
    const nextStageRefs: Record<string, string> = {}
    const graphProjectionQueue: Array<{ artifactId: string; artifact: PipelineArtifact }> = []
    for (const stageId of stagesToCopy) {
      const key = stageKey(stageId)
      const referencedArtifactId = sourceStageRefs[key]
      if (referencedArtifactId) {
        nextStageRefs[key] = referencedArtifactId
        const referencedArtifact = source[key] as PipelineArtifact | undefined
        if (referencedArtifact && supportsKnowledgeGraphProjection(referencedArtifact.stage_id)) {
          graphProjectionQueue.push({
            artifactId: referencedArtifactId,
            artifact: referencedArtifact,
          })
        }
        continue
      }

      const artifact = source[key] as PipelineArtifact | undefined
      if (artifact !== undefined) {
        const queuedArtifact = queueSharedArtifactWrite({
          batch,
          docId,
          chapterId,
          stageKeyValue: key,
          artifact,
          stageRefs: nextStageRefs,
        })
        nextStageRefs[key] = queuedArtifact.artifactId
        if (supportsKnowledgeGraphProjection(artifact.stage_id)) {
          graphProjectionQueue.push({
            artifactId: queuedArtifact.artifactId,
            artifact: queuedArtifact.payload as unknown as PipelineArtifact,
          })
        }
      }
    }

    batch.set(
      runDocRef(docId, chapterId, targetRunId),
      {
        storageVersion: 2,
        forkedFrom: sourceRunId,
        stageRefs: nextStageRefs,
        ...(sourceRunData?.stageModels ? { stageModels: sourceRunData.stageModels } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    await batch.commit()

    await Promise.all(
      graphProjectionQueue.map((item) =>
        replaceKnowledgeGraphProjection({
          docId,
          chapterId,
          runId: targetRunId,
          sourceArtifactId: item.artifactId,
          artifact: item.artifact,
        }),
      ),
    )
  })
}

export async function saveRunStageModels(
  docId: string,
  chapterId: string,
  runId: string,
  stageModels: Partial<Record<StageId, string>>,
  options: FirestoreReadOptions = {},
): Promise<void> {
  await withAdminErrorContext(async () => {
    const serialized = Object.fromEntries(
      Object.entries(stageModels)
        .filter((entry): entry is [StageId, string] => typeof entry[1] === "string")
        .map(([stageId, model]) => [stageKey(stageId), model]),
    )

    await runDocRef(docId, chapterId, runId, options.source).set(
      {
        storageVersion: 2,
        stageModels: serialized,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
  })
}

export async function deleteStageResult(
  docId: string,
  chapterId: string,
  runId: string,
  stageId: StageId,
  options: FirestoreReadOptions = {},
): Promise<void> {
  await withAdminErrorContext(async () => {
    const key = stageKey(stageId)
    const runSnap = await runDocRef(docId, chapterId, runId, options.source).get()
    const referencedArtifactId = readStageRefs(runSnap.data())[key]
    const sharedArtifactIdsToDelete = await findSharedArtifactIdsUnusedByOtherRuns({
      docId,
      chapterId,
      runId,
      artifactIds: referencedArtifactId ? [referencedArtifactId] : [],
      source: options.source,
    })
    const batch = getAdminDb().batch()
    batch.delete(runArtifactDocRef(docId, chapterId, runId, key, options.source))
    for (const artifactId of sharedArtifactIdsToDelete) {
      batch.delete(sharedArtifactDocRef(docId, chapterId, artifactId, options.source))
    }
    batch.set(
      runDocRef(docId, chapterId, runId, options.source),
      {
        stageRefs: {
          [key]: FieldValue.delete(),
        },
        [key]: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    await batch.commit()
    await clearKnowledgeGraphProjection({
      docId,
      chapterId,
      runId,
      sourceStageId: stageId,
      source: options.source,
    })
  })
}

export interface RunDeletionSummary {
  runDeleted: number
  runArtifactsDeleted: number
  sharedArtifactsDeleted: number
  graphNodesDeleted: number
  graphEdgesDeleted: number
}

export async function deleteRun(
  docId: string,
  chapterId: string,
  runId: string,
): Promise<RunDeletionSummary> {
  return withAdminErrorContext(async () => {
    const [runSnap, artifactsSnap, graphNodesSnap, graphEdgesSnap] = await Promise.all([
      runDocRef(docId, chapterId, runId).get(),
      runArtifactsCollection(docId, chapterId, runId).get(),
      graphNodesCollection(docId).where("runId", "==", runId).get(),
      graphEdgesCollection(docId).where("runId", "==", runId).get(),
    ])
    const sharedArtifactIdsToDelete = await findSharedArtifactIdsUnusedByOtherRuns({
      docId,
      chapterId,
      runId,
      artifactIds: uniqueStageRefArtifactIds(runSnap.data()),
    })
    const batch = getAdminDb().batch()
    let graphNodesDeleted = 0
    let graphEdgesDeleted = 0
    for (const artifactDoc of artifactsSnap.docs) {
      batch.delete(artifactDoc.ref)
    }
    for (const artifactId of sharedArtifactIdsToDelete) {
      batch.delete(sharedArtifactDocRef(docId, chapterId, artifactId))
    }
    for (const nodeDoc of graphNodesSnap.docs) {
      if ((nodeDoc.data() as DocumentData).chapterId === chapterId) {
        batch.delete(nodeDoc.ref)
        graphNodesDeleted += 1
      }
    }
    for (const edgeDoc of graphEdgesSnap.docs) {
      if ((edgeDoc.data() as DocumentData).chapterId === chapterId) {
        batch.delete(edgeDoc.ref)
        graphEdgesDeleted += 1
      }
    }
    batch.delete(runDocRef(docId, chapterId, runId))
    await batch.commit()
    return {
      runDeleted: runSnap.exists ? 1 : 0,
      runArtifactsDeleted: artifactsSnap.size,
      sharedArtifactsDeleted: sharedArtifactIdsToDelete.length,
      graphNodesDeleted,
      graphEdgesDeleted,
    }
  })
}

export interface DocumentStorageCleanupResult {
  docId: string
  chaptersScanned: number
  invalidRunsDeleted: number
  orphanSharedArtifactsDeleted: number
  invalidRuns: Array<{
    chapterId: string
    runId: string
    stageId: StageId
    missingStageId: StageId
  }>
}

async function deleteUnreferencedSharedArtifacts(
  docId: string,
  chapterId: string,
): Promise<number> {
  const [runsSnap, sharedArtifactsSnap] = await Promise.all([
    chapterDocRef(docId, chapterId).collection("runs").get(),
    sharedArtifactsCollection(docId, chapterId).get(),
  ])
  if (sharedArtifactsSnap.empty) return 0

  const referencedArtifactIds = new Set<string>()
  for (const runDoc of runsSnap.docs) {
    for (const artifactId of uniqueStageRefArtifactIds(runDoc.data() as DocumentData)) {
      referencedArtifactIds.add(artifactId)
    }
  }

  const orphanArtifactDocs = sharedArtifactsSnap.docs.filter(
    (artifactDoc) => !referencedArtifactIds.has(artifactDoc.id),
  )
  await commitBatched(orphanArtifactDocs, (batch, artifactDoc) => {
    batch.delete(artifactDoc.ref)
  })
  return orphanArtifactDocs.length
}

export async function cleanupDocumentStorage(
  docId: string,
): Promise<DocumentStorageCleanupResult> {
  return withAdminErrorContext(async () => {
    const chaptersSnap = await documentDocRef(docId).collection("chapters").get()
    const invalidRuns: DocumentStorageCleanupResult["invalidRuns"] = []
    let orphanSharedArtifactsDeleted = 0

    for (const chapterDoc of chaptersSnap.docs) {
      const chapterId = chapterDoc.id
      const runsSnap = await chapterDocRef(docId, chapterId).collection("runs").get()

      for (const runDoc of runsSnap.docs) {
        const issue = findStageDependencyIssue(runDoc.data() as DocumentData)
        if (!issue) continue

        invalidRuns.push({
          chapterId,
          runId: runDoc.id,
          stageId: issue.stageId,
          missingStageId: issue.missingStageId,
        })
      }

      for (const invalidRun of invalidRuns.filter((run) => run.chapterId === chapterId)) {
        const deletion = await deleteRun(docId, chapterId, invalidRun.runId)
        orphanSharedArtifactsDeleted += deletion.sharedArtifactsDeleted
      }

      orphanSharedArtifactsDeleted += await deleteUnreferencedSharedArtifacts(docId, chapterId)
    }

    return {
      docId,
      chaptersScanned: chaptersSnap.size,
      invalidRunsDeleted: invalidRuns.length,
      orphanSharedArtifactsDeleted,
      invalidRuns,
    }
  })
}

export async function setRunFavorite(
  docId: string,
  chapterId: string,
  runId: string,
  favorite: boolean,
): Promise<void> {
  await withAdminErrorContext(async () => {
    if (!favorite) {
      await runDocRef(docId, chapterId, runId).set(
        {
          favorite: false,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      return
    }

    const runsSnap = await getAdminDb()
      .collection(collectionName("current"))
      .doc(docId)
      .collection("chapters")
      .doc(chapterId)
      .collection("runs")
      .get()
    const batch = getAdminDb().batch()

    for (const runDoc of runsSnap.docs) {
      batch.set(
        runDoc.ref,
        { favorite: runDoc.id === runId },
        { merge: true },
      )
    }

    batch.set(
      runDocRef(docId, chapterId, runId),
      { favorite: true, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    )

    await batch.commit()
  })
}

export async function listRuns(
  docId: string,
  chapterId: string,
  maxRuns = 20,
  options: FirestoreReadOptions = {},
): Promise<RunMeta[]> {
  return withAdminErrorContext(async () => {
    const snap = await getAdminDb()
      .collection(collectionName(options.source))
      .doc(docId)
      .collection("chapters")
      .doc(chapterId)
      .collection("runs")
      .orderBy("updatedAt", "desc")
      .limit(maxRuns)
      .get()

    return snap.docs.map((d) => ({
      runId: d.id,
      updatedAt: (d.data() as DocumentData).updatedAt,
      favorite: (d.data() as DocumentData).favorite === true,
    }))
  })
}

function isKnowledgeGraphNodeKind(value: string | undefined): value is KnowledgeGraphNodeKind {
  return Boolean(value && ["scene", "event", "character", "place", "entity", "mention"].includes(value))
}

function parseGraphNode(data: DocumentData): KnowledgeGraphNode {
  return {
    nodeId: String(data.nodeId),
    localId: String(data.localId),
    kind: data.kind as KnowledgeGraphNodeKind,
    label: String(data.label ?? data.nodeId),
    docId: String(data.docId),
    chapterId: String(data.chapterId),
    runId: String(data.runId),
    sourceStageId: String(data.sourceStageId),
    sourceArtifactId: String(data.sourceArtifactId),
    sceneId: typeof data.sceneId === "string" ? data.sceneId : undefined,
    eventId: typeof data.eventId === "string" ? data.eventId : undefined,
    entityId: typeof data.entityId === "string" ? data.entityId : undefined,
    tags: Array.isArray(data.tags) ? data.tags.filter((item: unknown): item is string => typeof item === "string") : [],
    searchText: String(data.searchText ?? ""),
    metadata: data.metadata && typeof data.metadata === "object"
      ? data.metadata as Record<string, unknown>
      : {},
  }
}

function parseGraphEdge(data: DocumentData): KnowledgeGraphEdge {
  return {
    edgeId: String(data.edgeId),
    localId: String(data.localId),
    type: data.type,
    fromNodeId: String(data.fromNodeId),
    toNodeId: String(data.toNodeId),
    label: String(data.label ?? data.type),
    docId: String(data.docId),
    chapterId: String(data.chapterId),
    runId: String(data.runId),
    sourceStageId: String(data.sourceStageId),
    sourceArtifactId: String(data.sourceArtifactId),
    sceneId: typeof data.sceneId === "string" ? data.sceneId : undefined,
    evidence: Array.isArray(data.evidence)
      ? data.evidence.filter((item: unknown): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      : [],
    metadata: data.metadata && typeof data.metadata === "object"
      ? data.metadata as Record<string, unknown>
      : {},
  }
}

export async function loadKnowledgeGraph(
  query: KnowledgeGraphQuery,
): Promise<KnowledgeGraphQueryResult> {
  return withAdminErrorContext(async () => {
    const [nodesSnap, edgesSnap] = await Promise.all([
      graphNodesCollection(query.docId).where("runId", "==", query.runId).get(),
      graphEdgesCollection(query.docId).where("runId", "==", query.runId).get(),
    ])
    const allNodes = nodesSnap.docs
      .map((docSnap) => parseGraphNode(docSnap.data() as DocumentData))
      .filter((node) => node.chapterId === query.chapterId)
    const allEdges = edgesSnap.docs
      .map((docSnap) => parseGraphEdge(docSnap.data() as DocumentData))
      .filter((edge) => edge.chapterId === query.chapterId)

    let nodes = allNodes
    let edges = allEdges

    if (query.nodeId) {
      const depth = Math.max(0, Math.min(query.depth ?? 1, 3))
      const selected = new Set<string>([query.nodeId])
      for (let step = 0; step < depth; step += 1) {
        for (const edge of allEdges) {
          if (selected.has(edge.fromNodeId) || selected.has(edge.toNodeId)) {
            selected.add(edge.fromNodeId)
            selected.add(edge.toNodeId)
          }
        }
      }
      nodes = allNodes.filter((node) => selected.has(node.nodeId))
      edges = allEdges.filter((edge) => selected.has(edge.fromNodeId) && selected.has(edge.toNodeId))
    } else {
      const q = query.q?.trim().toLowerCase()
      if (q) {
        nodes = nodes.filter((node) => node.searchText.includes(q) || node.label.toLowerCase().includes(q))
      }
      if (isKnowledgeGraphNodeKind(query.kind)) {
        nodes = nodes.filter((node) => node.kind === query.kind)
      }
      const nodeIds = new Set(nodes.map((node) => node.nodeId))
      edges = edges.filter((edge) => nodeIds.has(edge.fromNodeId) && nodeIds.has(edge.toNodeId))
    }

    return {
      nodes,
      edges,
      totalNodes: allNodes.length,
      totalEdges: allEdges.length,
    }
  })
}

export async function projectKnowledgeGraphForRun(
  docId: string,
  chapterId: string,
  runId: string,
): Promise<{ projectedStages: string[]; nodes: number; edges: number }> {
  return withAdminErrorContext(async () => {
    const runSnap = await runDocRef(docId, chapterId, runId).get()
    const stageRefs = readStageRefs(runSnap.data())
    const results = await loadRunResults(docId, chapterId, runId)
    const projectedStages: string[] = []
    let nodeCount = 0
    let edgeCount = 0

    for (const stageId of ["ENT.3", "SUP.0"] as StageId[]) {
      const key = stageKey(stageId)
      const artifact = results[key] as PipelineArtifact | undefined
      if (!artifact || !supportsKnowledgeGraphProjection(artifact.stage_id)) continue
      const sourceArtifactId =
        typeof artifact.artifact_id === "string"
          ? artifact.artifact_id
          : (stageRefs[key] ?? `${key}_legacy_projection`)
      const projection = projectKnowledgeGraphArtifact({
        docId,
        chapterId,
        runId,
        sourceArtifactId,
        artifact,
      })
      await replaceKnowledgeGraphProjection({
        docId,
        chapterId,
        runId,
        sourceArtifactId,
        artifact,
      })
      projectedStages.push(stageId)
      nodeCount += projection.nodes.length
      edgeCount += projection.edges.length
    }

    return { projectedStages, nodes: nodeCount, edges: edgeCount }
  })
}
