/**
 * Server-side Firestore data access layer.
 *
 * API routes use Firebase Admin SDK so Firestore security rules do not block
 * document/run/artifact operations. Client components should call API routes
 * instead of importing this module directly.
 */

import { createHash } from "crypto"
import { FieldValue, type DocumentData, type WriteBatch } from "firebase-admin/firestore"
import { PIPELINE_STAGE_EDGES } from "@/config/pipeline-graph"
import {
  buildBookMemorySnapshot,
  createBookMemoryRunId,
  type BookMemoryChapterInput,
} from "./book-memory"
import { explainAdminCredentialError, getAdminDb } from "./firebase-admin"
import { projectKnowledgeGraphArtifact } from "./knowledge-graph"
import { stageKey } from "./stage-key"
import type { EntityGraph, RawChapter, PipelineArtifact, StageId, SupportMemoryLog } from "@/types/schema"
import type { BookMemorySnapshot } from "@/types/book-memory"
import type {
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
  KnowledgeGraphNodeKind,
  KnowledgeGraphQuery,
  KnowledgeGraphQueryResult,
} from "@/types/graph"
import type { StoredSourceFile } from "./storage"

export { stageKey }

export type FirestoreDataSource = "current" | "legacy"

export const CURRENT_DOCUMENTS_COLLECTION = "documents_v2"
export const LEGACY_DOCUMENTS_COLLECTION = "documents"

interface FirestoreReadOptions {
  source?: FirestoreDataSource
}

function collectionName(source: FirestoreDataSource = "current"): string {
  return source === "legacy" ? LEGACY_DOCUMENTS_COLLECTION : CURRENT_DOCUMENTS_COLLECTION
}

export function parseFirestoreDataSource(value: string | null | undefined): FirestoreDataSource {
  return value === "legacy" ? "legacy" : "current"
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
}): QueuedArtifactWrite {
  const { artifactId, payload } = prepareArtifactForStorage(
    params.stageKeyValue,
    params.artifact,
    params.stageRefs,
  )
  params.batch.set(
    sharedArtifactDocRef(params.docId, params.chapterId, artifactId),
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
}): Promise<void> {
  const [nodesSnap, edgesSnap] = await Promise.all([
    graphNodesCollection(params.docId).where("runId", "==", params.runId).get(),
    graphEdgesCollection(params.docId).where("runId", "==", params.runId).get(),
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
}): Promise<void> {
  if (!supportsKnowledgeGraphProjection(params.artifact.stage_id)) return

  const projection = projectKnowledgeGraphArtifact(params)
  await clearKnowledgeGraphProjection({
    docId: params.docId,
    chapterId: params.chapterId,
    runId: params.runId,
    sourceStageId: params.artifact.stage_id,
  })

  const nowFields = {
    updatedAt: FieldValue.serverTimestamp(),
  }
  await commitBatched(projection.nodes, (batch, node) => {
    const nodeData = stripUndefinedDeep(node) as DocumentData
    batch.set(graphNodesCollection(params.docId).doc(node.nodeId), {
      ...nodeData,
      ...nowFields,
    })
  })
  await commitBatched(projection.edges, (batch, edge) => {
    const edgeData = stripUndefinedDeep(edge) as DocumentData
    batch.set(graphEdgesCollection(params.docId).doc(edge.edgeId), {
      ...edgeData,
      ...nowFields,
    })
  })
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
  return withAdminErrorContext(async () => {
    const ref = await documentsCollection("current").add({
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
): Promise<void> {
  await withAdminErrorContext(async () => {
    await documentDocRef(docId).set(
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
): Promise<void> {
  await withAdminErrorContext(async () => {
    await chapterDocRef(docId, chapter.chapter_id).set({ raw: chapter }, { merge: true })
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

export async function listChapters(
  docId: string,
  options: FirestoreReadOptions = {},
): Promise<ChapterMeta[]> {
  return withAdminErrorContext(async () => {
    const snap = await documentDocRef(docId, options.source).collection("chapters").get()

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
): Promise<void> {
  await withAdminErrorContext(async () => {
    const runRef = runDocRef(docId, chapterId, runId)
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
): Promise<void> {
  await withAdminErrorContext(async () => {
    const serialized = Object.fromEntries(
      Object.entries(stageModels)
        .filter((entry): entry is [StageId, string] => typeof entry[1] === "string")
        .map(([stageId, model]) => [stageKey(stageId), model]),
    )

    await runDocRef(docId, chapterId, runId).set(
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
): Promise<void> {
  await withAdminErrorContext(async () => {
    const key = stageKey(stageId)
    const batch = getAdminDb().batch()
    batch.delete(runArtifactDocRef(docId, chapterId, runId, key))
    batch.set(
      runDocRef(docId, chapterId, runId),
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
    })
  })
}

export async function deleteRun(
  docId: string,
  chapterId: string,
  runId: string,
): Promise<void> {
  await withAdminErrorContext(async () => {
    const artifactsSnap = await runArtifactsCollection(docId, chapterId, runId).get()
    const [graphNodesSnap, graphEdgesSnap] = await Promise.all([
      graphNodesCollection(docId).where("runId", "==", runId).get(),
      graphEdgesCollection(docId).where("runId", "==", runId).get(),
    ])
    const batch = getAdminDb().batch()
    for (const artifactDoc of artifactsSnap.docs) {
      batch.delete(artifactDoc.ref)
    }
    for (const nodeDoc of graphNodesSnap.docs) {
      if ((nodeDoc.data() as DocumentData).chapterId === chapterId) {
        batch.delete(nodeDoc.ref)
      }
    }
    for (const edgeDoc of graphEdgesSnap.docs) {
      if ((edgeDoc.data() as DocumentData).chapterId === chapterId) {
        batch.delete(edgeDoc.ref)
      }
    }
    batch.delete(runDocRef(docId, chapterId, runId))
    await batch.commit()
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
