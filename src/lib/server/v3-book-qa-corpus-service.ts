import {
  listBookQAChapters,
  listRuns,
  loadStageResultByArtifactId,
  resolveRunStageArtifactRefs,
  stageKey,
  type ChapterMeta,
  type RunMeta,
} from "@/lib/firestore"
import {
  buildV3BookQACorpusManifest,
} from "@/lib/pipeline/v3-book-qa-corpus"
import { buildV3BookEntityGroups } from "@/lib/pipeline/v3-book-entity-grouping"
import {
  isV3EvidenceClusteringArtifact,
  type V3EvidenceClusteringArtifact,
} from "@/lib/pipeline/v3-evidence-clustering-types"
import {
  isV3EvidenceGateArtifact,
  V3_EVIDENCE_GATE_VERSION,
  type V3EvidenceGateArtifact,
} from "@/lib/pipeline/v3-evidence-gate-types"
import {
  V3_RETRIEVAL_INDEX_VERSION,
  type V3RetrievalIndexArtifact,
} from "@/lib/pipeline/v3-narrative-memory-types"
import {
  V3_BOOK_QA_PINNED_STAGE_IDS,
  type V3BookEntityGroupingChapterInput,
  type V3BookQAChapterRef,
  type V3BookQAPinnedStageId,
  type V3BookQAReadinessDiagnostic,
} from "@/lib/pipeline/v3-book-qa-types"
import type { PipelineArtifact, PreparedChapter } from "@/types/schema"
import {
  createV3BookQACorpusStore,
  type StoredV3BookQACorpus,
  type V3BookQACorpusStore,
} from "./v3-book-qa-corpus-store"

const BUILD_REQUEST_KEYS = new Set(["source", "docId", "chapterRunIds"])
const FIRESTORE_ID_MAX_LENGTH = 1_500

export interface V3BookQACorpusBuildRequest {
  source: "v3"
  docId: string
  chapterRunIds?: Record<string, string>
}

export interface V3BookQACorpusServiceStore {
  save: V3BookQACorpusStore["save"]
  load: V3BookQACorpusStore["load"]
}

export interface V3BookQACorpusServiceDependencies {
  listOrderedChapters(
    docId: string,
    options: { source: "v3" },
  ): Promise<ChapterMeta[]>
  listRuns(
    docId: string,
    chapterId: string,
    maxRuns: number,
    options: { source: "v3" },
  ): Promise<RunMeta[]>
  resolveRunStageArtifactRefs(
    docId: string,
    chapterId: string,
    runId: string,
    options: { source: "v3" },
  ): Promise<Record<string, string>>
  loadStageResultByArtifactId(
    docId: string,
    chapterId: string,
    artifactId: string,
    expectedStageKey: string,
    options: { source: "v3" },
  ): Promise<PipelineArtifact | null>
  store: V3BookQACorpusServiceStore
}

export class V3BookQACorpusRequestError extends Error {
  readonly status = 400
  readonly statusCode = 400
  readonly code = "book_qa_corpus_invalid_request" as const

  constructor(message: string) {
    super(message)
    this.name = "V3BookQACorpusRequestError"
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function validFirestoreId(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > FIRESTORE_ID_MAX_LENGTH ||
    value.trim() !== value ||
    value.includes("/") ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new V3BookQACorpusRequestError(`${label} must be a valid non-empty Firestore document ID`)
  }
  return value
}

export function parseV3BookQACorpusBuildRequest(value: unknown): V3BookQACorpusBuildRequest {
  if (!isRecord(value)) {
    throw new V3BookQACorpusRequestError("Request body must be an object")
  }
  const unexpectedKey = Object.keys(value).find((key) => !BUILD_REQUEST_KEYS.has(key))
  if (unexpectedKey) {
    throw new V3BookQACorpusRequestError(`Unexpected request field: ${unexpectedKey}`)
  }
  if (value.source !== "v3") {
    throw new V3BookQACorpusRequestError('source must be exactly "v3"')
  }
  const docId = validFirestoreId(value.docId, "docId")
  if (value.chapterRunIds === undefined) return { source: "v3", docId }
  if (!isRecord(value.chapterRunIds)) {
    throw new V3BookQACorpusRequestError("chapterRunIds must be an object map")
  }

  const chapterRunIds: Record<string, string> = {}
  for (const [chapterIdValue, runIdValue] of Object.entries(value.chapterRunIds)) {
    const chapterId = validFirestoreId(chapterIdValue, "chapterRunIds chapter ID")
    chapterRunIds[chapterId] = validFirestoreId(runIdValue, `chapterRunIds.${chapterId}`)
  }
  return { source: "v3", docId, chapterRunIds }
}

function timestampMillis(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (value instanceof Date) return value.getTime()
  if (typeof value === "string") {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY
  }
  if (isRecord(value)) {
    const toMillis = value.toMillis
    if (typeof toMillis === "function") {
      try {
        const result = (toMillis as () => unknown).call(value)
        if (typeof result === "number" && Number.isFinite(result)) return result
      } catch {
        return Number.NEGATIVE_INFINITY
      }
    }
    const seconds = typeof value.seconds === "number"
      ? value.seconds
      : typeof value._seconds === "number"
        ? value._seconds
        : undefined
    const nanoseconds = typeof value.nanoseconds === "number"
      ? value.nanoseconds
      : typeof value._nanoseconds === "number"
        ? value._nanoseconds
        : 0
    if (seconds !== undefined && Number.isFinite(seconds) && Number.isFinite(nanoseconds)) {
      return seconds * 1_000 + nanoseconds / 1_000_000
    }
  }
  return Number.NEGATIVE_INFINITY
}

function compareText(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function deterministicRunOrder(left: RunMeta, right: RunMeta): number {
  const favoriteOrder = Number(right.favorite === true) - Number(left.favorite === true)
  if (favoriteOrder !== 0) return favoriteOrder
  const leftUpdatedAt = timestampMillis(left.updatedAt)
  const rightUpdatedAt = timestampMillis(right.updatedAt)
  if (leftUpdatedAt !== rightUpdatedAt) return leftUpdatedAt > rightUpdatedAt ? -1 : 1
  return compareText(left.runId, right.runId)
}

function selectRun(
  chapter: ChapterMeta,
  runs: RunMeta[],
  requestedRunId: string | undefined,
): string {
  const validRuns = runs.filter((run) => {
    try {
      validFirestoreId(run.runId, "saved run ID")
      return true
    } catch {
      return false
    }
  })
  if (requestedRunId) {
    if (!validRuns.some((run) => run.runId === requestedRunId)) {
      throw new V3BookQACorpusRequestError(
        `Selected run ${requestedRunId} does not exist for chapter ${chapter.chapterId}`,
      )
    }
    return requestedRunId
  }
  const selected = [...validRuns].sort(deterministicRunOrder)[0]
  if (!selected) {
    throw new V3BookQACorpusRequestError(`No saved run exists for chapter ${chapter.chapterId}`)
  }
  return selected.runId
}

function validateRequestedRunCoverage(
  chapters: ChapterMeta[],
  requested: Record<string, string> | undefined,
): void {
  if (!requested) return
  const expected = new Set(chapters.map((chapter) => chapter.chapterId))
  const missing = chapters
    .map((chapter) => chapter.chapterId)
    .filter((chapterId) => requested[chapterId] === undefined)
  const extra = Object.keys(requested).filter((chapterId) => !expected.has(chapterId)).sort(compareText)
  if (missing.length > 0) {
    throw new V3BookQACorpusRequestError(
      `chapterRunIds is missing mappings for: ${missing.join(", ")}`,
    )
  }
  if (extra.length > 0) {
    throw new V3BookQACorpusRequestError(
      `chapterRunIds contains unknown chapters: ${extra.join(", ")}`,
    )
  }
}

function readiness(
  chapterId: string,
  runId: string,
  stageId: V3BookQAPinnedStageId,
  code: string,
  message: string,
): V3BookQAReadinessDiagnostic {
  return { chapter_id: chapterId, run_id: runId, stage_id: stageId, code, message }
}

function isArtifactIdentityValid(
  artifact: PipelineArtifact,
  params: { docId: string; chapterId: string; runId: string; stageId: V3BookQAPinnedStageId },
): boolean {
  return artifact.stage_id === params.stageId &&
    artifact.doc_id === params.docId &&
    artifact.chapter_id === params.chapterId &&
    artifact.run_id === params.runId
}

function preparedChapterEndPid(value: PipelineArtifact): number | null {
  if (value.stage_id !== "PRE.1") return null
  const prepared = value as PreparedChapter
  const paragraphs = prepared.raw_chapter?.paragraphs
  if (!Array.isArray(paragraphs)) return null
  const pids = paragraphs.map((paragraph) => paragraph?.pid)
  if (pids.some((pid) => !Number.isSafeInteger(pid) || (pid ?? -1) < 0)) return null
  return pids.length > 0 ? Math.max(...(pids as number[])) : 0
}

function paragraphCapableIndex(value: V3RetrievalIndexArtifact): boolean {
  return value.structured_records.some((record) =>
    record.record_type === "paragraph" &&
    typeof record.source_paragraph_id === "string" &&
    record.source_paragraph_id.length > 0 &&
    Number.isSafeInteger(record.progress_start) &&
    record.progress_start! >= 0 &&
    record.progress_end === record.progress_start)
}

function defaultDependencies(): V3BookQACorpusServiceDependencies {
  const store = createV3BookQACorpusStore()
  return {
    listOrderedChapters: (docId, options) => listBookQAChapters(docId, options),
    listRuns: (docId, chapterId, maxRuns, options) => listRuns(docId, chapterId, maxRuns, options),
    resolveRunStageArtifactRefs: (docId, chapterId, runId, options) =>
      resolveRunStageArtifactRefs(docId, chapterId, runId, options),
    loadStageResultByArtifactId: (docId, chapterId, artifactId, expectedStageKey, options) =>
      loadStageResultByArtifactId<PipelineArtifact>(
        docId,
        chapterId,
        artifactId,
        expectedStageKey,
        options,
      ),
    store,
  }
}

export class V3BookQACorpusService {
  private readonly dependencies: V3BookQACorpusServiceDependencies

  constructor(dependencies: V3BookQACorpusServiceDependencies = defaultDependencies()) {
    this.dependencies = dependencies
  }

  async load(docIdValue: unknown, qaCorpusIdValue: unknown): Promise<StoredV3BookQACorpus | null> {
    const docId = validFirestoreId(docIdValue, "docId")
    const qaCorpusId = validFirestoreId(qaCorpusIdValue, "qaCorpusId")
    return this.dependencies.store.load(docId, qaCorpusId)
  }

  async build(value: unknown): Promise<StoredV3BookQACorpus> {
    const request = parseV3BookQACorpusBuildRequest(value)
    const chapters = await this.dependencies.listOrderedChapters(request.docId, { source: "v3" })
    if (chapters.length === 0) {
      throw new V3BookQACorpusRequestError("No story chapters are available for this document")
    }
    const chapterIds = chapters.map((chapter) => validFirestoreId(chapter.chapterId, "chapter ID"))
    if (new Set(chapterIds).size !== chapterIds.length) {
      throw new V3BookQACorpusRequestError("Authoritative chapter order contains duplicate IDs")
    }
    validateRequestedRunCoverage(chapters, request.chapterRunIds)

    const chapterRefs: V3BookQAChapterRef[] = []
    const diagnostics: V3BookQAReadinessDiagnostic[] = []
    const groupingArtifacts: Array<{
      chapterId: string
      chapterIndex: number
      runId: string
      evidenceGate?: V3EvidenceGateArtifact
      evidenceClusters?: V3EvidenceClusteringArtifact
    }> = []

    for (const chapter of chapters) {
      const availableRuns = await this.dependencies.listRuns(
        request.docId,
        chapter.chapterId,
        1_000,
        { source: "v3" },
      )
      const runId = selectRun(chapter, availableRuns, request.chapterRunIds?.[chapter.chapterId])
      const resolvedRefs = await this.dependencies.resolveRunStageArtifactRefs(
        request.docId,
        chapter.chapterId,
        runId,
        { source: "v3" },
      )
      const artifactIds: V3BookQAChapterRef["artifact_ids"] = {}
      const loaded = new Map<V3BookQAPinnedStageId, PipelineArtifact>()

      for (const stageId of V3_BOOK_QA_PINNED_STAGE_IDS) {
        const artifactIdValue = resolvedRefs[stageKey(stageId)]
        const artifactId = typeof artifactIdValue === "string" && artifactIdValue.length > 0
          ? artifactIdValue
          : undefined
        if (!artifactId) {
          diagnostics.push(stageId === "IDX.2"
            ? readiness(
              chapter.chapterId,
              runId,
              stageId,
              "optional_semantic_index_missing",
              `Optional ${stageId} content-addressed artifact reference is missing.`,
            )
            : readiness(
              chapter.chapterId,
              runId,
              stageId,
              "missing_artifact_ref",
              `Required ${stageId} content-addressed artifact reference is missing.`,
            ))
          continue
        }
        artifactIds[stageId] = artifactId

        const artifact = await this.dependencies.loadStageResultByArtifactId(
          request.docId,
          chapter.chapterId,
          artifactId,
          stageKey(stageId),
          { source: "v3" },
        )
        if (!artifact || !isArtifactIdentityValid(artifact, {
          docId: request.docId,
          chapterId: chapter.chapterId,
          runId,
          stageId,
        })) {
          diagnostics.push(readiness(
            chapter.chapterId,
            runId,
            stageId,
            stageId === "IDX.2" ? "optional_artifact_missing_or_corrupt" : "artifact_missing_or_corrupt",
            `${stageId} artifact ${artifactId} is missing, corrupt, or has mismatched identity.`,
          ))
          continue
        }
        if (artifact.artifact_id !== undefined && artifact.artifact_id !== artifactId) {
          diagnostics.push(readiness(
            chapter.chapterId,
            runId,
            stageId,
            stageId === "IDX.2" ? "optional_artifact_missing_or_corrupt" : "artifact_missing_or_corrupt",
            `${stageId} artifact ${artifactId} has a mismatched content-addressed ID.`,
          ))
          continue
        }
        loaded.set(stageId, artifact)
      }

      const evidenceGateCandidate = loaded.get("EVID.3")
      let evidenceGate: V3EvidenceGateArtifact | undefined
      if (evidenceGateCandidate) {
        if (!isV3EvidenceGateArtifact(evidenceGateCandidate)) {
          diagnostics.push(readiness(
            chapter.chapterId,
            runId,
            "EVID.3",
            "artifact_missing_or_corrupt",
            "EVID.3 artifact is not a valid evidence-gate payload.",
          ))
        } else if (evidenceGateCandidate.artifact_version !== V3_EVIDENCE_GATE_VERSION) {
          diagnostics.push(readiness(
            chapter.chapterId,
            runId,
            "EVID.3",
            "unsupported_artifact_version",
            `EVID.3 must use ${V3_EVIDENCE_GATE_VERSION} with paragraph provenance.`,
          ))
        } else {
          evidenceGate = evidenceGateCandidate
        }
      }

      const evidenceClustersCandidate = loaded.get("EVID.4")
      const evidenceClusters = evidenceClustersCandidate && isV3EvidenceClusteringArtifact(evidenceClustersCandidate)
        ? evidenceClustersCandidate
        : undefined
      if (evidenceClustersCandidate && !evidenceClusters) {
        diagnostics.push(readiness(
          chapter.chapterId,
          runId,
          "EVID.4",
          "artifact_missing_or_corrupt",
          "EVID.4 artifact is not a valid evidence-clustering payload.",
        ))
      }

      const retrievalIndexCandidate = loaded.get("IDX.1") as V3RetrievalIndexArtifact | undefined
      if (retrievalIndexCandidate) {
        if (retrievalIndexCandidate.artifact_version !== V3_RETRIEVAL_INDEX_VERSION) {
          diagnostics.push(readiness(
            chapter.chapterId,
            runId,
            "IDX.1",
            "unsupported_artifact_version",
            `IDX.1 must use ${V3_RETRIEVAL_INDEX_VERSION} with paragraph descriptors.`,
          ))
        } else if (!paragraphCapableIndex(retrievalIndexCandidate)) {
          diagnostics.push(readiness(
            chapter.chapterId,
            runId,
            "IDX.1",
            "paragraph_descriptors_missing",
            "IDX.1 contains no valid paragraph descriptors.",
          ))
        }
      }

      const prepared = loaded.get("PRE.1")
      const progressEndPid = prepared ? preparedChapterEndPid(prepared) : null
      if (prepared && progressEndPid === null) {
        diagnostics.push(readiness(
          chapter.chapterId,
          runId,
          "PRE.1",
          "artifact_missing_or_corrupt",
          "PRE.1 artifact does not contain valid chapter paragraphs.",
        ))
      }

      chapterRefs.push({
        chapter_id: chapter.chapterId,
        chapter_title: chapter.title,
        chapter_index: chapter.index,
        run_id: runId,
        progress_end_pid: progressEndPid ?? 0,
        artifact_ids: artifactIds,
      })
      groupingArtifacts.push({
        chapterId: chapter.chapterId,
        chapterIndex: chapter.index,
        runId,
        evidenceGate,
        evidenceClusters,
      })
    }

    const manifest = buildV3BookQACorpusManifest({
      docId: request.docId,
      chapters: chapterRefs,
      readiness: diagnostics,
    })
    const groupingInputs = groupingArtifacts.flatMap((chapter): V3BookEntityGroupingChapterInput[] =>
      chapter.evidenceGate && chapter.evidenceClusters
        ? [{
          chapterId: chapter.chapterId,
          chapterIndex: chapter.chapterIndex,
          runId: chapter.runId,
          evidenceGate: chapter.evidenceGate,
          evidenceClusters: chapter.evidenceClusters,
        }]
        : [])
    const groups = buildV3BookEntityGroups({
      qaCorpusId: manifest.qa_corpus_id,
      chapters: groupingInputs,
    }).groups
    await this.dependencies.store.save(manifest, groups)
    return { manifest, groups }
  }
}

export function createV3BookQACorpusService(
  dependencies?: V3BookQACorpusServiceDependencies,
): V3BookQACorpusService {
  return new V3BookQACorpusService(dependencies)
}

export async function buildAndSaveV3BookQACorpus(
  request: unknown,
): Promise<StoredV3BookQACorpus> {
  return createV3BookQACorpusService().build(request)
}

export async function loadStoredV3BookQACorpus(
  docId: unknown,
  qaCorpusId: unknown,
): Promise<StoredV3BookQACorpus | null> {
  return createV3BookQACorpusService().load(docId, qaCorpusId)
}
