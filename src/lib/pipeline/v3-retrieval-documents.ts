import type { ContentUnits, Paragraph, PreparedChapter } from "@/types/schema"
import type { V3EvidenceClusteringArtifact } from "@/lib/pipeline/v3-evidence-clustering-types"
import {
  V3_RETRIEVAL_INDEX_VERSION,
  type V3RetrievalIndexArtifact,
  type V3RetrievalTextDocument,
  type V3StructuredRetrievalRecord,
} from "@/lib/pipeline/v3-narrative-memory-types"

function fallbackSourceParagraphId(chapterId: string, pid: number): string {
  return `${chapterId}_${pid}`
}

function sourceParagraphId(chapterId: string, paragraph: Paragraph): string {
  return paragraph.paragraph_id ?? fallbackSourceParagraphId(chapterId, paragraph.pid)
}

function compareTextDocumentIds(
  left: V3RetrievalTextDocument,
  right: V3RetrievalTextDocument,
): number {
  if (left.text_doc_id < right.text_doc_id) return -1
  if (left.text_doc_id > right.text_doc_id) return 1
  return 0
}

export function buildV3ParagraphRetrievalRecords(params: {
  chapterId: string
  preparedChapter: PreparedChapter
  contentUnits: ContentUnits
  evidenceClusters: V3EvidenceClusteringArtifact
}): V3StructuredRetrievalRecord[] {
  const storyPids = new Set(
    params.contentUnits.units
      .filter((unit) => unit.is_story_text)
      .map((unit) => unit.pid),
  )

  return params.preparedChapter.raw_chapter.paragraphs
    .filter((paragraph) => storyPids.has(paragraph.pid))
    .map((paragraph) => {
      const canonicalSourceId = sourceParagraphId(params.chapterId, paragraph)
      const entityRefs = params.evidenceClusters.entity_clusters
        .filter((cluster) => cluster.evidence_pids.includes(paragraph.pid))
        .map((cluster) => cluster.cluster_id)
        .sort()

      return {
        record_id: `PARAGRAPH_${canonicalSourceId}`,
        record_type: "paragraph",
        label: `Paragraph P${paragraph.pid}`,
        source_paragraph_id: canonicalSourceId,
        entity_refs: entityRefs,
        evidence_refs: [],
        progress_start: paragraph.pid,
        progress_end: paragraph.pid,
      }
    })
}

function requirePreparedChapter(
  retrievalIndex: V3RetrievalIndexArtifact,
  preparedChapter: PreparedChapter | null | undefined,
): PreparedChapter {
  if (!preparedChapter) {
    throw new Error(
      `IDX.1 ${retrievalIndex.artifact_version} requires PRE.1 to hydrate paragraph descriptors.`,
    )
  }
  if (preparedChapter.doc_id !== retrievalIndex.doc_id) {
    throw new Error(
      `PRE.1 document mismatch for IDX.1: expected ${retrievalIndex.doc_id} but received ${preparedChapter.doc_id}.`,
    )
  }
  if (preparedChapter.chapter_id !== retrievalIndex.chapter_id) {
    throw new Error(
      `PRE.1 chapter mismatch for IDX.1: expected ${retrievalIndex.chapter_id} but received ${preparedChapter.chapter_id}.`,
    )
  }
  if (preparedChapter.raw_chapter.doc_id !== retrievalIndex.doc_id) {
    throw new Error(
      `PRE.1 raw chapter document mismatch for IDX.1: expected ${retrievalIndex.doc_id} but received ${preparedChapter.raw_chapter.doc_id}.`,
    )
  }
  if (preparedChapter.raw_chapter.chapter_id !== retrievalIndex.chapter_id) {
    throw new Error(
      `PRE.1 raw chapter mismatch for IDX.1: expected ${retrievalIndex.chapter_id} but received ${preparedChapter.raw_chapter.chapter_id}.`,
    )
  }
  return preparedChapter
}

function indexPreparedParagraphs(
  retrievalIndex: V3RetrievalIndexArtifact,
  preparedChapter: PreparedChapter,
): Map<string, Paragraph> {
  const paragraphsBySourceId = new Map<string, Paragraph>()
  const pids = new Set<number>()

  for (const paragraph of preparedChapter.raw_chapter.paragraphs) {
    const canonicalSourceId = sourceParagraphId(retrievalIndex.chapter_id, paragraph)
    if (paragraphsBySourceId.has(canonicalSourceId)) {
      throw new Error(`PRE.1 contains duplicate canonical paragraph ID ${canonicalSourceId}.`)
    }
    if (pids.has(paragraph.pid)) {
      throw new Error(`PRE.1 contains duplicate paragraph PID ${paragraph.pid}.`)
    }
    paragraphsBySourceId.set(canonicalSourceId, paragraph)
    pids.add(paragraph.pid)
  }

  return paragraphsBySourceId
}

function hydrateParagraphDocument(
  record: V3StructuredRetrievalRecord,
  paragraphsBySourceId: Map<string, Paragraph>,
): V3RetrievalTextDocument {
  const canonicalSourceId = record.source_paragraph_id
  if (!canonicalSourceId) {
    throw new Error(`Paragraph descriptor ${record.record_id} is missing source_paragraph_id.`)
  }

  const expectedRecordId = `PARAGRAPH_${canonicalSourceId}`
  if (record.record_id !== expectedRecordId) {
    throw new Error(
      `Paragraph descriptor ${record.record_id} does not match source_paragraph_id ${canonicalSourceId}; expected ${expectedRecordId}.`,
    )
  }

  if (
    record.progress_start === undefined
    || record.progress_end === undefined
    || record.progress_start !== record.progress_end
  ) {
    throw new Error(
      `Paragraph descriptor ${record.record_id} must have one exact PID in progress_start/progress_end.`,
    )
  }

  const paragraph = paragraphsBySourceId.get(canonicalSourceId)
  if (!paragraph) {
    throw new Error(
      `Paragraph descriptor ${record.record_id} source paragraph ${canonicalSourceId} was not found in PRE.1.`,
    )
  }
  if (record.progress_start !== paragraph.pid) {
    throw new Error(
      `Paragraph descriptor ${record.record_id} PID ${record.progress_start} does not match PRE.1 PID ${paragraph.pid}.`,
    )
  }

  return {
    text_doc_id: `TEXT_${record.record_id}`,
    doc_type: "paragraph",
    text: paragraph.text,
    evidence_refs: [...record.evidence_refs],
  }
}

export function hydrateV3RetrievalDocuments(params: {
  retrievalIndex: V3RetrievalIndexArtifact
  preparedChapter?: PreparedChapter | null
}): V3RetrievalTextDocument[] {
  const paragraphRecords = params.retrievalIndex.structured_records
    .filter((record) => record.record_type === "paragraph")

  if (paragraphRecords.length === 0) {
    return [...params.retrievalIndex.text_documents].sort(compareTextDocumentIds)
  }
  if (params.retrievalIndex.artifact_version !== V3_RETRIEVAL_INDEX_VERSION) {
    throw new Error(
      `IDX.1 ${params.retrievalIndex.artifact_version} cannot contain paragraph descriptors.`,
    )
  }

  const preparedChapter = requirePreparedChapter(params.retrievalIndex, params.preparedChapter)
  const paragraphsBySourceId = indexPreparedParagraphs(params.retrievalIndex, preparedChapter)
  const descriptorIds = new Set<string>()
  const sourceParagraphIds = new Set<string>()
  const hydratedParagraphs = paragraphRecords.map((record) => {
    if (descriptorIds.has(record.record_id)) {
      throw new Error(`IDX.1 contains duplicate paragraph descriptor ID ${record.record_id}.`)
    }
    descriptorIds.add(record.record_id)

    if (record.source_paragraph_id && sourceParagraphIds.has(record.source_paragraph_id)) {
      throw new Error(
        `IDX.1 contains duplicate paragraph source ID ${record.source_paragraph_id}.`,
      )
    }
    if (record.source_paragraph_id) sourceParagraphIds.add(record.source_paragraph_id)

    return hydrateParagraphDocument(record, paragraphsBySourceId)
  })

  return [...params.retrievalIndex.text_documents, ...hydratedParagraphs]
    .sort(compareTextDocumentIds)
}
