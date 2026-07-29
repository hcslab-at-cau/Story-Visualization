import { workspaceCorpusRevisionId } from "@/lib/corpus-import"
import type { FirestoreDataSource } from "@/lib/data-source"
import type { RawChapter } from "@/types/schema"

export interface EmbeddedChapterRecord {
  chapterId: string
  raw?: RawChapter
}

export type CorpusAwareChapterListing =
  | { kind: "canonical"; chapters: RawChapter[] }
  | { kind: "embedded"; chapters: EmbeddedChapterRecord[] }

export interface CorpusAwareFirestoreReadDependencies<TDocument extends object> {
  listWorkspaceDocuments(source: FirestoreDataSource): Promise<TDocument[]>
  loadWorkspace(docId: string, source: FirestoreDataSource): Promise<unknown>
  isCanonicalRevisionComplete(corpusRevisionId: string): Promise<boolean>
  loadCanonicalRawChapter(corpusRevisionId: string, chapterId: string): Promise<RawChapter | null>
  loadEmbeddedRawChapter(
    docId: string,
    chapterId: string,
    source: FirestoreDataSource,
  ): Promise<RawChapter | null>
  listCanonicalRawChapters(corpusRevisionId: string): Promise<RawChapter[]>
  listEmbeddedChapters(
    docId: string,
    source: FirestoreDataSource,
  ): Promise<EmbeddedChapterRecord[]>
  listCanonicalChapterIds(corpusRevisionId: string): Promise<string[]>
  listEmbeddedChapterIds(docId: string, source: FirestoreDataSource): Promise<string[]>
}

export function createCorpusAwareFirestoreReads<TDocument extends object>(
  dependencies: CorpusAwareFirestoreReadDependencies<TDocument>,
) {
  async function loadCorpusRevisionId(
    docId: string,
    source: FirestoreDataSource,
  ): Promise<string | null> {
    return workspaceCorpusRevisionId(await dependencies.loadWorkspace(docId, source))
  }

  return {
    async listDocuments(source: FirestoreDataSource): Promise<TDocument[]> {
      const documents = await dependencies.listWorkspaceDocuments(source)
      const visible = await Promise.all(documents.map(async (document) => {
        const corpusRevisionId = workspaceCorpusRevisionId(document)
        return corpusRevisionId === null
          || dependencies.isCanonicalRevisionComplete(corpusRevisionId)
      }))
      return documents.filter((_, index) => visible[index])
    },

    async loadRawChapter(
      docId: string,
      chapterId: string,
      source: FirestoreDataSource,
    ): Promise<RawChapter | null> {
      const corpusRevisionId = await loadCorpusRevisionId(docId, source)
      if (corpusRevisionId !== null) {
        return dependencies.loadCanonicalRawChapter(corpusRevisionId, chapterId)
      }
      return dependencies.loadEmbeddedRawChapter(docId, chapterId, source)
    },

    async listChapters(
      docId: string,
      source: FirestoreDataSource,
    ): Promise<CorpusAwareChapterListing> {
      const corpusRevisionId = await loadCorpusRevisionId(docId, source)
      if (corpusRevisionId !== null) {
        return {
          kind: "canonical",
          chapters: await dependencies.listCanonicalRawChapters(corpusRevisionId),
        }
      }
      return {
        kind: "embedded",
        chapters: await dependencies.listEmbeddedChapters(docId, source),
      }
    },

    async listCleanupChapterIds(
      docId: string,
      source: FirestoreDataSource,
    ): Promise<string[]> {
      const corpusRevisionId = await loadCorpusRevisionId(docId, source)
      if (corpusRevisionId !== null) {
        return dependencies.listCanonicalChapterIds(corpusRevisionId)
      }
      return dependencies.listEmbeddedChapterIds(docId, source)
    },
  }
}
