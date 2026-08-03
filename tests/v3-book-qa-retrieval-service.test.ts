import test from "node:test"
import assert from "node:assert/strict"
import {
  V3BookQARequestError,
  V3BookQARetrievalService,
  type V3BookQARetrievalServiceDependencies,
} from "../src/lib/server/v3-book-qa-retrieval-service.ts"
import { buildV3BookQACorpusManifest } from "../src/lib/pipeline/v3-book-qa-corpus.ts"
import type {
  V3BookQAChapterRef,
  V3BookQAPinnedStageId,
  V3BookQACorpusManifest,
} from "../src/lib/pipeline/v3-book-qa-types.ts"
import { hydrateV3RetrievalDocuments } from "../src/lib/pipeline/v3-retrieval-documents.ts"
import {
  createV3SemanticVectorPayload,
  fingerprintRetrievalDocuments,
} from "../src/lib/pipeline/v3-semantic-index.ts"
import {
  V3_SEMANTIC_INDEX_LEGACY_VERSION,
  V3_SEMANTIC_INDEX_VERSION,
  V3_SEMANTIC_VECTOR_LEGACY_VERSION,
  type V3SemanticIndexArtifact,
  type V3SemanticVectorPayload,
} from "../src/lib/pipeline/v3-semantic-index-types.ts"
import {
  V3_RETRIEVAL_INDEX_LEGACY_VERSION,
  V3_RETRIEVAL_INDEX_VERSION,
  type V3RetrievalIndexArtifact,
} from "../src/lib/pipeline/v3-narrative-memory-types.ts"
import type { V3MemoryContractArtifact } from "../src/lib/pipeline/v3-memory-contract-types.ts"
import type {
  V3EventFramesArtifact,
  V3SceneSituationCardsArtifact,
} from "../src/lib/pipeline/v3-memory-frames-types.ts"
import { V3SemanticVectorIntegrityError } from "../src/lib/storage.ts"
import type { PipelineArtifact, PreparedChapter, StageId } from "../src/types/schema.ts"

const REQUIRED_STAGES: V3BookQAPinnedStageId[] = [
  "PRE.1",
  "PRE.2",
  "EVID.3",
  "EVID.4",
  "MEM.0",
  "MEM.1",
  "EVENT.2",
  "IDX.1",
  "IDX.2",
]

interface Fixture {
  manifest: V3BookQACorpusManifest
  artifacts: Map<string, PipelineArtifact>
  vectors: Map<string, V3SemanticVectorPayload>
}

function artifactId(chapterId: string, stageId: V3BookQAPinnedStageId): string {
  return `${chapterId}-${stageId.toLowerCase().replace(".", "")}`
}

function chapterRef(chapterId: string, chapterIndex: number): V3BookQAChapterRef {
  return {
    chapter_id: chapterId,
    chapter_title: `Chapter ${chapterIndex}`,
    chapter_index: chapterIndex,
    run_id: `run-${chapterId}`,
    progress_end_pid: 8,
    artifact_ids: Object.fromEntries(
      REQUIRED_STAGES.map((stageId) => [stageId, artifactId(chapterId, stageId)]),
    ),
  }
}

function preparedChapter(chapterId: string, chapterIndex: number): PreparedChapter {
  const pid = chapterId === "ch01" ? 7 : chapterId === "ch02" ? 4 : 1
  const text = chapterId === "ch01"
    ? "Alice ate cake and drank tea."
    : chapterId === "ch02"
      ? "Alice rested beside the river."
      : "Alice ate the future feast."
  return {
    run_id: `run-${chapterId}`,
    doc_id: "doc",
    chapter_id: chapterId,
    stage_id: "PRE.1",
    method: "epub+rule",
    parents: {},
    chapter_title: `Chapter ${chapterIndex}`,
    paragraph_count: 1,
    char_count: text.length,
    raw_chapter: {
      doc_id: "doc",
      chapter_id: chapterId,
      title: `Chapter ${chapterIndex}`,
      text,
      paragraphs: [{ pid, start: 0, end: text.length, text, paragraph_id: `para_${String(pid).padStart(4, "0")}` }],
    },
  }
}

function retrievalIndex(chapterId: string, pid: number): V3RetrievalIndexArtifact {
  const paragraphId = `para_${String(pid).padStart(4, "0")}`
  return {
    run_id: `run-${chapterId}`,
    doc_id: "doc",
    chapter_id: chapterId,
    stage_id: "IDX.1",
    method: "rule",
    parents: {},
    artifact_version: V3_RETRIEVAL_INDEX_VERSION,
    extraction_profile: "v3_retrieval_index",
    source_stage_ids: ["PRE.1", "PRE.2", "EVID.4", "MEM.1", "EVENT.2", "GOAL.1", "CAUS.1", "MEM.2"],
    index_stats: { structured_records: 1, graph_edges: 0, text_documents: 0 },
    structured_records: [{
      record_id: `PARAGRAPH_${paragraphId}`,
      record_type: "paragraph",
      label: `Paragraph P${pid}`,
      source_paragraph_id: paragraphId,
      entity_refs: [],
      evidence_refs: [],
      progress_start: pid,
      progress_end: pid,
    }],
    graph_edges: [],
    text_documents: [],
  }
}

function memoryContract(chapterId: string): V3MemoryContractArtifact {
  return {
    run_id: `run-${chapterId}`,
    doc_id: "doc",
    chapter_id: chapterId,
    stage_id: "MEM.0",
    method: "rule",
    parents: {},
    artifact_version: "v3-memory-contract-0.1",
    extraction_profile: "v3_narrative_memory_contract",
    source_stage_ids: ["EVENT.1", "SCENE.0"],
    contract_stats: {
      events_total: 0,
      scenes_total: 0,
      events_assigned: 0,
      events_unassigned: 0,
      scenes_without_events: 0,
      diagnostics_total: 0,
      support_axis_refs: 0,
      drop_axis_refs: 0,
      missing_occurrence_refs: 0,
    },
    evidence_refs: [],
    events: [],
    scenes: [],
    diagnostics: [],
  }
}

function sceneCards(chapterId: string): V3SceneSituationCardsArtifact {
  return {
    run_id: `run-${chapterId}`,
    doc_id: "doc",
    chapter_id: chapterId,
    stage_id: "MEM.1",
    method: "rule",
    parents: {},
    artifact_version: "v3-scene-situation-cards-0.1",
    extraction_profile: "v3_scene_situation_cards",
    source_stage_ids: ["MEM.0"],
    card_stats: { input_scenes: 0, input_events: 0, scene_cards: 0, scenes_with_goal_or_tension: 0 },
    scene_cards: [],
  }
}

function eventFrames(chapterId: string): V3EventFramesArtifact {
  return {
    run_id: `run-${chapterId}`,
    doc_id: "doc",
    chapter_id: chapterId,
    stage_id: "EVENT.2",
    method: "rule",
    parents: {},
    artifact_version: "v3-event-argument-frames-0.1",
    extraction_profile: "v3_event_argument_frames",
    source_stage_ids: ["MEM.0", "MEM.1"],
    frame_stats: { input_events: 0, event_frames: 0, frames_with_trigger: 0, arguments_total: 0 },
    event_frames: [],
  }
}

function identityArtifact(chapterId: string, stageId: StageId): PipelineArtifact {
  return {
    run_id: `run-${chapterId}`,
    doc_id: "doc",
    chapter_id: chapterId,
    stage_id: stageId,
    method: "rule",
    parents: {},
  } as unknown as PipelineArtifact
}

function buildFixture(): Fixture {
  const chapters = [chapterRef("ch01", 1), chapterRef("ch02", 2), chapterRef("ch03", 3)]
  const manifest = buildV3BookQACorpusManifest({ docId: "doc", chapters })
  const artifacts = new Map<string, PipelineArtifact>()
  const vectors = new Map<string, V3SemanticVectorPayload>()

  for (const chapter of chapters) {
    const pre1 = preparedChapter(chapter.chapter_id, chapter.chapter_index)
    const idx1 = retrievalIndex(chapter.chapter_id, pre1.raw_chapter.paragraphs[0].pid)
    const documents = hydrateV3RetrievalDocuments({ retrievalIndex: idx1, preparedChapter: pre1 })
    const payload = createV3SemanticVectorPayload({
      model: "test/embed",
      documents,
      embeddings: [chapter.chapter_id === "ch02" ? [0, 1] : [1, 0]],
    })
    const storagePath = `vectors/${chapter.chapter_id}.json.gz`
    const idx2: V3SemanticIndexArtifact = {
      run_id: `run-${chapter.chapter_id}`,
      doc_id: "doc",
      chapter_id: chapter.chapter_id,
      stage_id: "IDX.2",
      method: "embedding",
      parents: {},
      artifact_version: V3_SEMANTIC_INDEX_VERSION,
      extraction_profile: "v3_semantic_vector_index",
      source_stage_ids: ["IDX.1", "PRE.1"],
      embedding_provider: "openrouter",
      embedding_model: "test/embed",
      source_text_fingerprint: fingerprintRetrievalDocuments(documents),
      vector_stats: { vectors: documents.length, dimensions: 2, prompt_tokens: 1 },
      vector_blob: {
        bucket: "bucket",
        storage_path: storagePath,
        gs_uri: `gs://bucket/${storagePath}`,
        file_name: `${chapter.chapter_id}.json.gz`,
        content_type: "application/gzip",
        size_bytes: 10,
        content_hash: "a".repeat(64),
      },
    }

    const byStage: Record<V3BookQAPinnedStageId, PipelineArtifact> = {
      "PRE.1": pre1,
      "PRE.2": identityArtifact(chapter.chapter_id, "PRE.2"),
      "EVID.3": identityArtifact(chapter.chapter_id, "EVID.3"),
      "EVID.4": identityArtifact(chapter.chapter_id, "EVID.4"),
      "MEM.0": memoryContract(chapter.chapter_id),
      "MEM.1": sceneCards(chapter.chapter_id),
      "EVENT.2": eventFrames(chapter.chapter_id),
      "IDX.1": idx1,
      "IDX.2": idx2,
    }
    for (const stageId of REQUIRED_STAGES) {
      artifacts.set(artifactId(chapter.chapter_id, stageId), byStage[stageId])
    }
    vectors.set(storagePath, payload)
  }

  return { manifest, artifacts, vectors }
}

function fakeService(fixture = buildFixture()): {
  service: V3BookQARetrievalService
  artifactLoads: Array<{ chapterId: string; artifactId: string; stageKey: string; source: string }>
  embeddingCalls: Array<{ texts: string[]; options: { model?: string; dimensions?: number } }>
  dependencies: V3BookQARetrievalServiceDependencies
} {
  const artifactLoads: Array<{ chapterId: string; artifactId: string; stageKey: string; source: string }> = []
  const embeddingCalls: Array<{ texts: string[]; options: { model?: string; dimensions?: number } }> = []
  const dependencies: V3BookQARetrievalServiceDependencies = {
    async loadCorpus() {
      return { manifest: structuredClone(fixture.manifest), groups: [] }
    },
    async loadStageResultByArtifactId(_docId, chapterId, loadedArtifactId, expectedStageKey, options) {
      artifactLoads.push({ chapterId, artifactId: loadedArtifactId, stageKey: expectedStageKey, source: options.source })
      return structuredClone(fixture.artifacts.get(loadedArtifactId) ?? null)
    },
    async downloadVectors({ storagePath }) {
      const payload = fixture.vectors.get(storagePath)
      if (!payload) throw new V3SemanticVectorIntegrityError(`missing vector ${storagePath}`)
      return structuredClone(payload)
    },
    async embedTexts(texts, options) {
      embeddingCalls.push({ texts: [...texts], options: { ...(options ?? {}) } })
      return {
        model: options?.model ?? "",
        dimensions: options?.dimensions ?? 0,
        embeddings: [[1, 0]],
        promptTokens: 1,
      }
    },
  }
  return { service: new V3BookQARetrievalService(dependencies), artifactLoads, embeddingCalls, dependencies }
}

function request() {
  return {
    docId: "doc",
    qaCorpusId: buildFixture().manifest.qa_corpus_id,
    question: "What did Alice eat earlier?",
    readerPosition: { chapter_id: "ch02", pid: 4 },
  }
}

function isRequestError(
  error: unknown,
  status: number,
  diagnosticCode?: string,
): error is V3BookQARequestError {
  return error instanceof V3BookQARequestError
    && error.status === status
    && error.statusCode === status
    && (!diagnosticCode || error.diagnostics.some((diagnostic) => diagnostic.code === diagnosticCode))
}

test("unknown BOOK.1 corpus returns a typed 404 without loading artifacts", async () => {
  const fixture = buildFixture()
  const fake = fakeService(fixture)
  fake.dependencies.loadCorpus = async () => null
  const service = new V3BookQARetrievalService(fake.dependencies)

  await assert.rejects(service.retrieve(request()), (error) => isRequestError(error, 404, "corpus_not_found"))
  assert.equal(fake.artifactLoads.length, 0)
  assert.equal(fake.embeddingCalls.length, 0)
})

test("corpus doc, ID, fingerprint, and derived ID inconsistencies fail with 409", async () => {
  const mutations: Array<(manifest: V3BookQACorpusManifest) => void> = [
    (manifest) => { manifest.doc_id = "other-doc" },
    (manifest) => { manifest.qa_corpus_id = "BOOK1_other" },
    (manifest) => { manifest.fingerprint = "0".repeat(64) },
    (manifest) => { manifest.qa_corpus_id = `BOOK1_${manifest.fingerprint.slice(1, 33)}` },
  ]

  for (const mutate of mutations) {
    const fixture = buildFixture()
    mutate(fixture.manifest)
    const fake = fakeService(fixture)
    await assert.rejects(
      fake.service.retrieve(request()),
      (error) => isRequestError(error, 409, "corpus_integrity_mismatch"),
    )
    assert.equal(fake.artifactLoads.length, 0)
  }
})

test("readable manifest readiness and missing pinned refs fail deterministically before artifact loads", async () => {
  const readinessFixture = buildFixture()
  readinessFixture.manifest.readiness = [{
    chapter_id: "ch01",
    run_id: "run-ch01",
    stage_id: "IDX.2",
    code: "optional_stage_missing",
    message: "IDX.2 was not ready when BOOK.1 was built.",
  }]
  const readinessFake = fakeService(readinessFixture)
  await assert.rejects(
    readinessFake.service.retrieve(request()),
    (error) => isRequestError(error, 409, "optional_stage_missing"),
  )
  assert.equal(readinessFake.artifactLoads.length, 0)

  const missingRefFixture = buildFixture()
  delete missingRefFixture.manifest.chapters[0].artifact_ids["PRE.2"]
  missingRefFixture.manifest = buildV3BookQACorpusManifest({
    docId: missingRefFixture.manifest.doc_id,
    chapters: missingRefFixture.manifest.chapters,
  })
  const missingRefFake = fakeService(missingRefFixture)
  await assert.rejects(
    missingRefFake.service.retrieve({
      ...request(),
      qaCorpusId: missingRefFixture.manifest.qa_corpus_id,
    }),
    (error) => isRequestError(error, 409, "missing_pinned_ref"),
  )
  assert.equal(missingRefFake.artifactLoads.length, 0)
})

test("missing and identity-corrupt pinned artifacts fail with chapter/stage diagnostics", async () => {
  const missingFixture = buildFixture()
  missingFixture.artifacts.delete(artifactId("ch01", "PRE.2"))
  const missingFake = fakeService(missingFixture)
  await assert.rejects(
    missingFake.service.retrieve(request()),
    (error) => isRequestError(error, 409, "artifact_missing")
      && error.diagnostics.some((item) => item.chapter_id === "ch01" && item.stage_id === "PRE.2"),
  )

  const corruptFixture = buildFixture()
  const corrupt = structuredClone(corruptFixture.artifacts.get(artifactId("ch01", "MEM.0"))!)
  corrupt.run_id = "wrong-run"
  corruptFixture.artifacts.set(artifactId("ch01", "MEM.0"), corrupt)
  const corruptFake = fakeService(corruptFixture)
  await assert.rejects(
    corruptFake.service.retrieve(request()),
    (error) => isRequestError(error, 409, "artifact_identity_mismatch")
      && error.diagnostics.some((item) => item.chapter_id === "ch01" && item.stage_id === "MEM.0"),
  )

  const contentIdFixture = buildFixture()
  const contentId = artifactId("ch01", "PRE.2")
  const contentIdMismatch = structuredClone(contentIdFixture.artifacts.get(contentId)!)
  contentIdMismatch.artifact_id = "different-content-addressed-id"
  contentIdFixture.artifacts.set(contentId, contentIdMismatch)
  const contentIdFake = fakeService(contentIdFixture)
  await assert.rejects(
    contentIdFake.service.retrieve(request()),
    (error) => isRequestError(error, 409, "artifact_identity_mismatch")
      && error.diagnostics.some((item) => item.chapter_id === "ch01" && item.stage_id === "PRE.2"),
  )
})

test("paragraph-less and legacy IDX.1 artifacts are rejected", async () => {
  for (const mutate of [
    (index: V3RetrievalIndexArtifact) => { index.structured_records = [] },
    (index: V3RetrievalIndexArtifact) => {
      index.artifact_version = V3_RETRIEVAL_INDEX_LEGACY_VERSION
      index.source_stage_ids = ["MEM.1", "EVENT.2", "GOAL.1", "CAUS.1", "MEM.2"]
    },
  ]) {
    const fixture = buildFixture()
    const id = artifactId("ch01", "IDX.1")
    const index = structuredClone(fixture.artifacts.get(id)!) as V3RetrievalIndexArtifact
    mutate(index)
    fixture.artifacts.set(id, index)
    const fake = fakeService(fixture)
    await assert.rejects(fake.service.retrieve(request()), (error) => isRequestError(error, 409, "idx1_not_book_ready"))
    assert.equal(fake.embeddingCalls.length, 0)
  }
})

test("missing, stale, legacy, and corrupt IDX.2 data fail before query embedding", async () => {
  const cases: Array<(fixture: Fixture, fake: ReturnType<typeof fakeService>) => void> = [
    (fixture) => { fixture.artifacts.delete(artifactId("ch01", "IDX.2")) },
    (fixture) => {
      const id = artifactId("ch01", "IDX.2")
      const index = structuredClone(fixture.artifacts.get(id)!) as V3SemanticIndexArtifact
      index.source_text_fingerprint = "stale"
      fixture.artifacts.set(id, index)
    },
    (fixture) => {
      const id = artifactId("ch01", "IDX.2")
      const index = structuredClone(fixture.artifacts.get(id)!) as V3SemanticIndexArtifact
      index.artifact_version = V3_SEMANTIC_INDEX_LEGACY_VERSION
      index.source_stage_ids = ["IDX.1"]
      fixture.artifacts.set(id, index)
    },
    (fixture) => {
      const payload = fixture.vectors.get("vectors/ch01.json.gz")!
      payload.artifact_version = V3_SEMANTIC_VECTOR_LEGACY_VERSION
    },
    (fixture) => {
      const payload = fixture.vectors.get("vectors/ch01.json.gz")!
      payload.vectors[0].embedding = [1]
    },
    (fixture) => {
      const payload = fixture.vectors.get("vectors/ch01.json.gz")!
      payload.vectors[0].embedding = [Number.NaN, 0]
    },
    (_fixture, fake) => {
      fake.dependencies.downloadVectors = async () => {
        throw new V3SemanticVectorIntegrityError("hash mismatch")
      }
    },
  ]

  for (const arrange of cases) {
    const fixture = buildFixture()
    const fake = fakeService(fixture)
    arrange(fixture, fake)
    const service = new V3BookQARetrievalService(fake.dependencies)
    await assert.rejects(service.retrieve(request()), (error) =>
      isRequestError(error, 409)
      && error.diagnostics.some((item) => item.chapter_id === "ch01" && item.stage_id === "IDX.2"))
    assert.equal(fake.embeddingCalls.length, 0)
  }
})

test("mixed embedding models and dimensions are rejected before embedding", async () => {
  for (const field of ["model", "dimensions"] as const) {
    const fixture = buildFixture()
    const id = artifactId("ch02", "IDX.2")
    const index = structuredClone(fixture.artifacts.get(id)!) as V3SemanticIndexArtifact
    const payload = fixture.vectors.get("vectors/ch02.json.gz")!
    if (field === "model") {
      index.embedding_model = "other/embed"
      payload.model = "other/embed"
    } else {
      index.vector_stats.dimensions = 3
      payload.dimensions = 3
      payload.vectors[0].embedding = [0, 1, 0]
    }
    fixture.artifacts.set(id, index)
    const fake = fakeService(fixture)
    await assert.rejects(
      fake.service.retrieve(request()),
      (error) => isRequestError(error, 409, field === "model" ? "mixed_embedding_models" : "mixed_embedding_dimensions"),
    )
    assert.equal(fake.embeddingCalls.length, 0)
  }
})

test("future chapters are never loaded and one shared query embedding drives namespaced food retrieval", async () => {
  const fixture = buildFixture()
  const fake = fakeService(fixture)
  const result = await fake.service.retrieve(request())

  assert.equal(fake.embeddingCalls.length, 1)
  assert.deepEqual(fake.embeddingCalls[0], {
    texts: ["What did Alice eat earlier?"],
    options: { model: "test/embed", dimensions: 2 },
  })
  assert.equal(fake.artifactLoads.some((load) => load.chapterId === "ch03"), false)
  assert.equal(fake.artifactLoads.length, REQUIRED_STAGES.length * 2)
  assert.ok(fake.artifactLoads.every((load) => load.source === "v3"))
  assert.equal(result.hits[0]?.record_id, "ch01:PARAGRAPH_para_0007")
  assert.equal(result.hits[0]?.text, "Paragraph P7 Alice ate cake and drank tea.")
  assert.equal(result.hits.some((hit) => hit.chapter_id === "ch03"), false)
  assert.equal(result.retrieval_mode, "hybrid")
})

test("operational vector download failures propagate unchanged", async () => {
  const fixture = buildFixture()
  const fake = fakeService(fixture)
  const operationalError = new Error("storage credentials unavailable")
  fake.dependencies.downloadVectors = async () => { throw operationalError }
  const service = new V3BookQARetrievalService(fake.dependencies)

  await assert.rejects(service.retrieve(request()), (error) => error === operationalError)
  assert.equal(fake.embeddingCalls.length, 0)
})

test("invalid query embedding responses fail closed with 409", async () => {
  const fixture = buildFixture()
  const fake = fakeService(fixture)
  fake.dependencies.embedTexts = async () => ({
    model: "test/embed",
    dimensions: 2,
    embeddings: [[1]],
    promptTokens: 1,
  })
  const service = new V3BookQARetrievalService(fake.dependencies)

  await assert.rejects(service.retrieve(request()), (error) => isRequestError(error, 409, "invalid_query_embedding"))
})
