import type { Firestore } from "firebase-admin/firestore"
import { explainAdminCredentialError, getAdminDb } from "@/lib/firebase-admin"
import type {
  V3BookEntityGroup,
  V3BookQACorpusManifest,
} from "@/lib/pipeline/v3-book-qa-types"

const DEFAULT_MAX_GROUPS_PER_BATCH = 400

export interface V3BookQACorpusStoreDocument {
  path: string
  data: Record<string, unknown>
}

export interface V3BookQACorpusStoreListedDocument {
  id: string
  data: Record<string, unknown>
}

export interface V3BookQACorpusStoreAdapter {
  readDocument(path: string): Promise<Record<string, unknown> | null>
  listDocuments(collectionPath: string): Promise<V3BookQACorpusStoreListedDocument[]>
  writeImmutableDocuments(documents: V3BookQACorpusStoreDocument[]): Promise<void>
}

export interface V3BookQACorpusStoreDependencies {
  adapter?: V3BookQACorpusStoreAdapter
  getDb?: () => Firestore
  maxGroupsPerBatch?: number
}

export interface StoredV3BookQACorpus {
  manifest: V3BookQACorpusManifest
  groups: V3BookEntityGroup[]
}

export class V3BookQACorpusImmutableConflictError extends Error {
  readonly statusCode = 409
  readonly status = 409
  readonly code = "book_qa_corpus_immutable_conflict" as const
  readonly documentPath: string

  constructor(documentPath: string) {
    super(`Immutable BOOK.1 record conflicts with existing content: ${documentPath}`)
    this.name = "V3BookQACorpusImmutableConflictError"
    this.documentPath = documentPath
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`
}

function equivalent(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right)
}

function manifestPath(docId: string, qaCorpusId: string): string {
  return `documents_v3/${docId}/qa_corpora/${qaCorpusId}`
}

function groupsPath(docId: string, qaCorpusId: string): string {
  return `${manifestPath(docId, qaCorpusId)}/entity_groups`
}

function groupPath(docId: string, qaCorpusId: string, globalEntityId: string): string {
  return `${groupsPath(docId, qaCorpusId)}/${globalEntityId}`
}

function asRecord(value: unknown, documentPath: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new V3BookQACorpusImmutableConflictError(documentPath)
  }
  return value as Record<string, unknown>
}

function manifestDocument(manifest: V3BookQACorpusManifest, groupCount: number): Record<string, unknown> {
  return {
    ...structuredClone(manifest),
    entity_group_count: groupCount,
  }
}

function groupDocument(
  manifest: V3BookQACorpusManifest,
  group: V3BookEntityGroup,
): Record<string, unknown> {
  return {
    qa_corpus_id: manifest.qa_corpus_id,
    fingerprint: manifest.fingerprint,
    global_entity_id: group.global_entity_id,
    group: structuredClone(group),
  }
}

function canonicalGroups(groups: V3BookEntityGroup[]): V3BookEntityGroup[] {
  const sorted = groups
    .map((group) => structuredClone(group))
    .sort((left, right) => left.global_entity_id.localeCompare(right.global_entity_id))
  const seen = new Set<string>()
  for (const group of sorted) {
    if (!group.global_entity_id || seen.has(group.global_entity_id)) {
      throw new Error(`BOOK.1 entity group IDs must be unique: ${group.global_entity_id}`)
    }
    seen.add(group.global_entity_id)
  }
  return sorted
}

function validatedBatchSize(value: number | undefined): number {
  const batchSize = value ?? DEFAULT_MAX_GROUPS_PER_BATCH
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 400) {
    throw new Error("maxGroupsPerBatch must be an integer between 1 and 400")
  }
  return batchSize
}

class FirestoreV3BookQACorpusStoreAdapter implements V3BookQACorpusStoreAdapter {
  constructor(private readonly getDb: () => Firestore) {}

  async readDocument(path: string): Promise<Record<string, unknown> | null> {
    try {
      const snapshot = await this.getDb().doc(path).get()
      return snapshot.exists ? (snapshot.data() as Record<string, unknown>) : null
    } catch (error) {
      throw explainAdminCredentialError(error)
    }
  }

  async listDocuments(collectionPath: string): Promise<V3BookQACorpusStoreListedDocument[]> {
    try {
      const snapshot = await this.getDb().collection(collectionPath).get()
      return snapshot.docs.map((document) => ({
        id: document.id,
        data: document.data() as Record<string, unknown>,
      }))
    } catch (error) {
      throw explainAdminCredentialError(error)
    }
  }

  async writeImmutableDocuments(documents: V3BookQACorpusStoreDocument[]): Promise<void> {
    if (documents.length === 0) return
    try {
      const db = this.getDb()
      await db.runTransaction(async (transaction) => {
        const references = documents.map((document) => db.doc(document.path))
        const snapshots = []
        for (const reference of references) {
          snapshots.push(await transaction.get(reference))
        }

        for (let index = 0; index < documents.length; index += 1) {
          const snapshot = snapshots[index]
          if (snapshot.exists && !equivalent(snapshot.data(), documents[index].data)) {
            throw new V3BookQACorpusImmutableConflictError(documents[index].path)
          }
        }
        for (let index = 0; index < documents.length; index += 1) {
          if (!snapshots[index].exists) {
            transaction.set(references[index], documents[index].data)
          }
        }
      })
    } catch (error) {
      throw explainAdminCredentialError(error)
    }
  }
}

export class V3BookQACorpusStore {
  private readonly adapter: V3BookQACorpusStoreAdapter
  private readonly maxGroupsPerBatch: number

  constructor(dependencies: V3BookQACorpusStoreDependencies = {}) {
    this.adapter = dependencies.adapter ?? new FirestoreV3BookQACorpusStoreAdapter(
      dependencies.getDb ?? getAdminDb,
    )
    this.maxGroupsPerBatch = validatedBatchSize(dependencies.maxGroupsPerBatch)
  }

  async save(
    manifest: V3BookQACorpusManifest,
    groups: V3BookEntityGroup[],
  ): Promise<void> {
    const canonical = canonicalGroups(groups)
    const entityGroupDocuments = canonical.map((group) => ({
      path: groupPath(manifest.doc_id, manifest.qa_corpus_id, group.global_entity_id),
      data: groupDocument(manifest, group),
    }))

    for (let index = 0; index < entityGroupDocuments.length; index += this.maxGroupsPerBatch) {
      await this.adapter.writeImmutableDocuments(
        entityGroupDocuments.slice(index, index + this.maxGroupsPerBatch),
      )
    }

    await this.adapter.writeImmutableDocuments([{
      path: manifestPath(manifest.doc_id, manifest.qa_corpus_id),
      data: manifestDocument(manifest, canonical.length),
    }])
  }

  async load(docId: string, qaCorpusId: string): Promise<StoredV3BookQACorpus | null> {
    const rootPath = manifestPath(docId, qaCorpusId)
    const storedManifest = await this.adapter.readDocument(rootPath)
    if (!storedManifest) return null

    const manifestRecord = asRecord(storedManifest, rootPath)
    const entityGroupCount = manifestRecord.entity_group_count
    if (
      manifestRecord.doc_id !== docId ||
      manifestRecord.qa_corpus_id !== qaCorpusId ||
      typeof manifestRecord.fingerprint !== "string" ||
      !Number.isSafeInteger(entityGroupCount) ||
      (entityGroupCount as number) < 0
    ) {
      throw new V3BookQACorpusImmutableConflictError(rootPath)
    }

    const manifest = { ...manifestRecord }
    delete manifest.entity_group_count
    const listedGroups = await this.adapter.listDocuments(groupsPath(docId, qaCorpusId))
    const groups = listedGroups.map((document) => {
      const path = groupPath(docId, qaCorpusId, document.id)
      const record = asRecord(document.data, path)
      const group = asRecord(record.group, path) as unknown as V3BookEntityGroup
      if (
        record.qa_corpus_id !== qaCorpusId ||
        record.fingerprint !== manifestRecord.fingerprint ||
        record.global_entity_id !== document.id ||
        group.global_entity_id !== document.id
      ) {
        throw new V3BookQACorpusImmutableConflictError(path)
      }
      return structuredClone(group)
    }).sort((left, right) => left.global_entity_id.localeCompare(right.global_entity_id))

    if (groups.length !== entityGroupCount) {
      throw new V3BookQACorpusImmutableConflictError(rootPath)
    }

    return {
      manifest: structuredClone(manifest) as unknown as V3BookQACorpusManifest,
      groups,
    }
  }
}

export function createV3BookQACorpusStore(
  dependencies: V3BookQACorpusStoreDependencies = {},
): V3BookQACorpusStore {
  return new V3BookQACorpusStore(dependencies)
}
