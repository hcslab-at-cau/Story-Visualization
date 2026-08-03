import { randomUUID } from "node:crypto"
import {
  FieldPath,
  FieldValue,
  Timestamp,
  type Firestore,
  type Query,
} from "firebase-admin/firestore"
import { explainAdminCredentialError, getAdminDb } from "@/lib/firebase-admin"
import {
  V3_BOOK_QA_HISTORY_PAGE_SIZE,
  V3_BOOK_QA_HISTORY_SCHEMA_VERSION,
  type V3BookQAHistoryEntry,
  type V3BookQAHistoryPage,
  type V3BookQAHistoryScopeRequest,
  type V3BookQAHistoryDeleteRequest,
} from "@/lib/v3-book-qa-history-types"
import {
  createV3BookQAHistoryScopeId,
  decodeV3BookQAHistoryCursor,
  normalizeV3BookQAHistoryPage,
  normalizeV3BookQAHistoryStoredEntry,
  type NormalizedV3BookQAHistoryCreateInput,
  V3BookQAHistoryValidationError,
} from "@/lib/server/v3-book-qa-history"

export interface V3BookQAHistoryStoreDocument {
  path: string
  data: Record<string, unknown>
  merge?: boolean
  createOnly?: boolean
}

export interface V3BookQAHistoryStoreListedDocument {
  id: string
  data: Record<string, unknown>
}

export interface V3BookQAHistoryStoreCursor {
  createdAtMs: number
  entryId: string
}

export interface V3BookQAHistoryStoreListQuery {
  collectionPath: string
  orderBy: Array<{
    field: "created_at" | "__name__"
    direction: "desc"
  }>
  cursor?: V3BookQAHistoryStoreCursor
  limit: number
}

export interface V3BookQAHistoryStoreAdapter {
  readDocument(path: string): Promise<Record<string, unknown> | null>
  writeDocuments(documents: V3BookQAHistoryStoreDocument[]): Promise<void>
  listDocuments(query: V3BookQAHistoryStoreListQuery): Promise<V3BookQAHistoryStoreListedDocument[]>
  deleteDocument(path: string): Promise<boolean>
}

export interface V3BookQAHistoryStoreDependencies {
  adapter?: V3BookQAHistoryStoreAdapter
  getDb?: () => Firestore
  now?: () => Date
  createEntryId?: () => string
}

export class V3BookQAHistoryStoreIntegrityError extends Error {
  readonly status = 409
  readonly statusCode = 409
  readonly code = "book_qa_history_integrity_error" as const

  constructor(message: string) {
    super(message)
    this.name = "V3BookQAHistoryStoreIntegrityError"
  }
}

function scopePath(docId: string, qaCorpusId: string): string {
  const scopeId = createV3BookQAHistoryScopeId(qaCorpusId)
  return `documents_v3/${docId}/book_qa_history/${scopeId}`
}

function entriesPath(docId: string, qaCorpusId: string): string {
  return `${scopePath(docId, qaCorpusId)}/entries`
}

function entryPath(docId: string, qaCorpusId: string, entryId: string): string {
  return `${entriesPath(docId, qaCorpusId)}/${entryId}`
}

function stripUndefinedDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefinedDeep)
  if (!value || typeof value !== "object") return value
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return value
  return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .map(([key, item]) => [key, stripUndefinedDeep(item)]))
}

function timestampIso(value: unknown, path: string): string {
  if (value instanceof Timestamp) return value.toDate().toISOString()
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString()
  if (value && typeof value === "object" && "toDate" in value) {
    const date = (value as { toDate: () => Date }).toDate()
    if (date instanceof Date && Number.isFinite(date.getTime())) return date.toISOString()
  }
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString()
  }
  throw new V3BookQAHistoryStoreIntegrityError(
    `Book QA history timestamp is invalid: ${path}`,
  )
}

function validEntryId(entryId: string): boolean {
  return entryId.length > 0
    && entryId.length <= 512
    && entryId.trim() === entryId
    && !entryId.includes("/")
    && !/[\u0000-\u001f\u007f]/u.test(entryId)
}

function scopeMatches(
  data: Record<string, unknown>,
  docId: string,
  qaCorpusId: string,
): boolean {
  return data.schema_version === V3_BOOK_QA_HISTORY_SCHEMA_VERSION
    && data.scope_id === createV3BookQAHistoryScopeId(qaCorpusId)
    && data.doc_id === docId
    && data.qa_corpus_id === qaCorpusId
}

function assertScope(
  data: Record<string, unknown>,
  docId: string,
  qaCorpusId: string,
  path: string,
): void {
  if (!scopeMatches(data, docId, qaCorpusId)) {
    throw new V3BookQAHistoryStoreIntegrityError(
      `Book QA history scope ownership does not match: ${path}`,
    )
  }
  timestampIso(data.updated_at, path)
}

function storedEntryFromDocument(
  document: V3BookQAHistoryStoreListedDocument,
  path: string,
): V3BookQAHistoryEntry {
  if (document.data.entry_id !== document.id) {
    throw new V3BookQAHistoryStoreIntegrityError(
      `Book QA history entry ID does not match its document: ${path}`,
    )
  }
  try {
    return normalizeV3BookQAHistoryStoredEntry({
      ...document.data,
      created_at: timestampIso(document.data.created_at, path),
    })
  } catch (error) {
    if (error instanceof V3BookQAHistoryStoreIntegrityError) throw error
    throw new V3BookQAHistoryStoreIntegrityError(
      `Malformed book QA history entry at ${path}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

class FirestoreV3BookQAHistoryStoreAdapter implements V3BookQAHistoryStoreAdapter {
  constructor(private readonly getDb: () => Firestore) {}

  async readDocument(path: string): Promise<Record<string, unknown> | null> {
    try {
      const snapshot = await this.getDb().doc(path).get()
      return snapshot.exists ? (snapshot.data() as Record<string, unknown>) : null
    } catch (error) {
      throw explainAdminCredentialError(error)
    }
  }

  async writeDocuments(documents: V3BookQAHistoryStoreDocument[]): Promise<void> {
    if (documents.length === 0) return
    try {
      const db = this.getDb()
      const batch = db.batch()
      for (const document of documents) {
        const reference = db.doc(document.path)
        if (document.createOnly) {
          batch.create(reference, document.data)
        } else if (document.merge) {
          batch.set(reference, document.data, { merge: true })
        } else {
          batch.set(reference, document.data)
        }
      }
      await batch.commit()
    } catch (error) {
      throw explainAdminCredentialError(error)
    }
  }

  async listDocuments(
    queryInput: V3BookQAHistoryStoreListQuery,
  ): Promise<V3BookQAHistoryStoreListedDocument[]> {
    try {
      let query: Query = this.getDb()
        .collection(queryInput.collectionPath)
        .orderBy("created_at", "desc")
        .orderBy(FieldPath.documentId(), "desc")
      if (queryInput.cursor) {
        query = query.startAfter(
          Timestamp.fromMillis(queryInput.cursor.createdAtMs),
          queryInput.cursor.entryId,
        )
      }
      const snapshot = await query.limit(queryInput.limit).get()
      return snapshot.docs.map((document) => ({
        id: document.id,
        data: document.data() as Record<string, unknown>,
      }))
    } catch (error) {
      throw explainAdminCredentialError(error)
    }
  }

  async deleteDocument(path: string): Promise<boolean> {
    try {
      await this.getDb().doc(path).delete()
      return true
    } catch (error) {
      throw explainAdminCredentialError(error)
    }
  }
}

export class V3BookQAHistoryStore {
  private readonly adapter: V3BookQAHistoryStoreAdapter
  private readonly createEntryId: () => string
  private readonly createTimestamp: () => unknown

  constructor(dependencies: V3BookQAHistoryStoreDependencies = {}) {
    this.adapter = dependencies.adapter ?? new FirestoreV3BookQAHistoryStoreAdapter(
      dependencies.getDb ?? getAdminDb,
    )
    this.createEntryId = dependencies.createEntryId ?? randomUUID
    this.createTimestamp = dependencies.now
      ? () => {
          const date = dependencies.now!()
          if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
            throw new Error("Book QA history now() must return a valid Date")
          }
          return date.toISOString()
        }
      : () => FieldValue.serverTimestamp()
  }

  async save(input: NormalizedV3BookQAHistoryCreateInput): Promise<V3BookQAHistoryEntry> {
    const rootPath = scopePath(input.docId, input.qaCorpusId)
    const existingScope = await this.adapter.readDocument(rootPath)
    if (existingScope) assertScope(existingScope, input.docId, input.qaCorpusId, rootPath)

    const newEntryId = this.createEntryId()
    if (!validEntryId(newEntryId)) throw new Error("Book QA history entry ID is invalid")
    const newEntryPath = entryPath(input.docId, input.qaCorpusId, newEntryId)
    const timestamp = this.createTimestamp()
    const scopeId = createV3BookQAHistoryScopeId(input.qaCorpusId)
    const entryData = stripUndefinedDeep({
      schema_version: V3_BOOK_QA_HISTORY_SCHEMA_VERSION,
      entry_id: newEntryId,
      doc_id: input.docId,
      qa_corpus_id: input.qaCorpusId,
      question: input.question,
      reader_position: input.readerPosition,
      answer_snapshot: input.answer_snapshot,
      created_at: timestamp,
    }) as Record<string, unknown>

    await this.adapter.writeDocuments([
      {
        path: rootPath,
        merge: true,
        data: {
          schema_version: V3_BOOK_QA_HISTORY_SCHEMA_VERSION,
          scope_id: scopeId,
          doc_id: input.docId,
          qa_corpus_id: input.qaCorpusId,
          updated_at: timestamp,
        },
      },
      {
        path: newEntryPath,
        createOnly: true,
        data: entryData,
      },
    ])

    const saved = await this.adapter.readDocument(newEntryPath)
    if (!saved) {
      throw new V3BookQAHistoryStoreIntegrityError(
        `Saved book QA history entry could not be read: ${newEntryPath}`,
      )
    }
    return storedEntryFromDocument({ id: newEntryId, data: saved }, newEntryPath)
  }

  async list(input: V3BookQAHistoryScopeRequest): Promise<V3BookQAHistoryPage> {
    const rootPath = scopePath(input.docId, input.qaCorpusId)
    const scope = await this.adapter.readDocument(rootPath)
    if (!scope) return normalizeV3BookQAHistoryPage([])
    assertScope(scope, input.docId, input.qaCorpusId, rootPath)

    const cursor = input.cursor ? decodeV3BookQAHistoryCursor(input.cursor) : null
    if (input.cursor && !cursor) {
      throw new V3BookQAHistoryValidationError("Invalid book QA history cursor")
    }
    const collectionPath = entriesPath(input.docId, input.qaCorpusId)
    const documents = await this.adapter.listDocuments({
      collectionPath,
      orderBy: [
        { field: "created_at", direction: "desc" },
        { field: "__name__", direction: "desc" },
      ],
      ...(cursor ? { cursor } : {}),
      limit: V3_BOOK_QA_HISTORY_PAGE_SIZE + 1,
    })
    const entries = documents.map((document) =>
      storedEntryFromDocument(document, `${collectionPath}/${document.id}`))
    return normalizeV3BookQAHistoryPage(entries)
  }

  async delete(input: V3BookQAHistoryDeleteRequest): Promise<boolean> {
    const rootPath = scopePath(input.docId, input.qaCorpusId)
    const scope = await this.adapter.readDocument(rootPath)
    if (!scope) return false
    assertScope(scope, input.docId, input.qaCorpusId, rootPath)

    const targetPath = entryPath(input.docId, input.qaCorpusId, input.entryId)
    const entry = await this.adapter.readDocument(targetPath)
    if (!entry) return false
    const stored = storedEntryFromDocument({ id: input.entryId, data: entry }, targetPath)
    if (stored.doc_id !== input.docId || stored.qa_corpus_id !== input.qaCorpusId) {
      throw new V3BookQAHistoryStoreIntegrityError(
        `Book QA history entry ownership does not match: ${targetPath}`,
      )
    }
    return this.adapter.deleteDocument(targetPath)
  }
}

export function createV3BookQAHistoryStore(
  dependencies: V3BookQAHistoryStoreDependencies = {},
): V3BookQAHistoryStore {
  return new V3BookQAHistoryStore(dependencies)
}
