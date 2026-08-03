import test from "node:test"
import assert from "node:assert/strict"
import {
  V3BookQACorpusRequestError,
  V3BookQACorpusService,
  type V3BookQACorpusServiceDependencies,
} from "../src/lib/server/v3-book-qa-corpus-service.ts"
import { V3_EVIDENCE_GATE_VERSION } from "../src/lib/pipeline/v3-evidence-gate-types.ts"
import { V3_RETRIEVAL_INDEX_VERSION } from "../src/lib/pipeline/v3-narrative-memory-types.ts"
import { V3_BOOK_QA_PINNED_STAGE_IDS } from "../src/lib/pipeline/v3-book-qa-types.ts"
import type { PipelineArtifact } from "../src/types/schema.ts"

type Chapter = Awaited<ReturnType<V3BookQACorpusServiceDependencies["listOrderedChapters"]>>[number]
type Run = Awaited<ReturnType<V3BookQACorpusServiceDependencies["listRuns"]>>[number]

const REQUIRED_STAGE_IDS = V3_BOOK_QA_PINNED_STAGE_IDS.filter((stageId) => stageId !== "IDX.2")

function stageKey(stageId: string): string {
  return stageId.replace(".", "").toLowerCase()
}

function chapters(...ids: string[]): Chapter[] {
  return ids.map((chapterId, index) => ({
    chapterId,
    title: `Title ${chapterId}`,
    index,
  }))
}

function runs(...values: Array<[string, number, boolean?]>): Run[] {
  return values.map(([runId, updatedAt, favorite]) => ({ runId, updatedAt, favorite }))
}

function refs(prefix: string, omit: string[] = []): Record<string, string> {
  return Object.fromEntries(
    V3_BOOK_QA_PINNED_STAGE_IDS
      .filter((stageId) => !omit.includes(stageId))
      .map((stageId) => [stageKey(stageId), `${prefix}-${stageKey(stageId)}-content-addressed`]),
  )
}

function artifact(stageId: string, chapterId: string, runId: string): PipelineArtifact {
  const base = {
    stage_id: stageId,
    doc_id: "doc-one",
    chapter_id: chapterId,
    run_id: runId,
    parents: {},
    method: "rule",
  }
  if (stageId === "PRE.1") {
    return {
      ...base,
      stage_id: "PRE.1",
      method: "epub+rule",
      chapter_title: `Title ${chapterId}`,
      paragraph_count: 2,
      char_count: 12,
      raw_chapter: {
        doc_id: "doc-one",
        chapter_id: chapterId,
        title: `Title ${chapterId}`,
        text: "Alice appears.",
        paragraphs: [
          { pid: 0, start: 0, end: 5, text: "Alice" },
          { pid: 7, start: 6, end: 12, text: "appears" },
        ],
      },
    } as PipelineArtifact
  }
  if (stageId === "EVID.3") {
    return {
      ...base,
      stage_id: "EVID.3",
      method: "llm+rule",
      artifact_version: V3_EVIDENCE_GATE_VERSION,
      extraction_profile: "v3_evidence_candidate_gate",
      source_stage_ids: ["EVID.2"],
      prompt_template: "v3_evid3_candidate_gate",
      gate_stats: {
        input_refined_candidates: 1,
        core_candidates: 1,
        support_candidates: 0,
        dropped_candidates: 0,
        by_gate: { core: 1, support: 0, drop: 0 },
        by_type: { cast: 1 },
      },
      gated_candidates: [{
        refined_candidate_id: `alice-${chapterId}`,
        source_candidate_ids: [`source-${chapterId}`],
        candidate_type: "cast",
        gate: "core",
        basis: "event_participant",
        pid: 0,
        span: "Alice",
        normalized: "Alice",
      }],
      gate_map: { [`alice-${chapterId}`]: "core" },
    } as PipelineArtifact
  }
  if (stageId === "EVID.4") {
    return {
      ...base,
      stage_id: "EVID.4",
      extraction_profile: "v3_evidence_entity_clustering",
      source_stage_ids: ["EVID.3"],
      cluster_stats: {
        input_refined_candidates: 1,
        entity_like_candidates: 1,
        entity_clusters: 1,
        singleton_clusters: 1,
        unclustered_candidates: 0,
        by_type: { cast: 1 },
      },
      entity_clusters: [{
        cluster_id: `cluster-${chapterId}`,
        entity_type: "cast",
        canonical_label: "Alice",
        aliases: ["Alice"],
        refined_candidate_ids: [`alice-${chapterId}`],
        source_candidate_ids: [`source-${chapterId}`],
        evidence_pids: [0],
        mention_count: 1,
      }],
      candidate_cluster_map: { [`alice-${chapterId}`]: `cluster-${chapterId}` },
    } as PipelineArtifact
  }
  if (stageId === "IDX.1") {
    return {
      ...base,
      stage_id: "IDX.1",
      artifact_version: V3_RETRIEVAL_INDEX_VERSION,
      extraction_profile: "v3_retrieval_index",
      source_stage_ids: ["PRE.1", "PRE.2", "EVID.4", "MEM.1", "EVENT.2", "GOAL.1", "CAUS.1", "MEM.2"],
      index_stats: { structured_records: 1, graph_edges: 0, text_documents: 0 },
      structured_records: [{
        record_id: `PARAGRAPH_${chapterId}_0`,
        record_type: "paragraph",
        label: "P0",
        source_paragraph_id: `paragraph-${chapterId}-0`,
        evidence_refs: [],
        progress_start: 0,
        progress_end: 0,
      }],
      graph_edges: [],
      text_documents: [],
    } as PipelineArtifact
  }
  return base as PipelineArtifact
}

function createHarness(params: {
  orderedChapters?: Chapter[]
  runsByChapter?: Record<string, Run[]>
  refsBySelection?: Record<string, Record<string, string>>
  mutateArtifact?: (value: PipelineArtifact, stageId: string, chapterId: string) => PipelineArtifact | null
} = {}) {
  const orderedChapters = params.orderedChapters ?? chapters("chapter-1", "chapter-2")
  const runsByChapter = params.runsByChapter ?? Object.fromEntries(
    orderedChapters.map((chapter) => [chapter.chapterId, runs([`run-${chapter.chapterId}`, 1])]),
  )
  const refsBySelection = params.refsBySelection ?? Object.fromEntries(
    orderedChapters.map((chapter) => [
      `${chapter.chapterId}:run-${chapter.chapterId}`,
      refs(chapter.chapterId),
    ]),
  )
  const exactLoads: Array<{ chapterId: string; artifactId: string; expectedStageKey: string }> = []
  const saves: Array<{ manifest: unknown; groups: unknown[] }> = []
  const stored = new Map<string, unknown>()

  const dependencies: V3BookQACorpusServiceDependencies = {
    async listOrderedChapters() {
      return structuredClone(orderedChapters)
    },
    async listRuns(_docId, chapterId) {
      return structuredClone(runsByChapter[chapterId] ?? [])
    },
    async resolveRunStageArtifactRefs(_docId, chapterId, runId) {
      return structuredClone(refsBySelection[`${chapterId}:${runId}`] ?? {})
    },
    async loadStageResultByArtifactId(_docId, chapterId, artifactId, expectedStageKey) {
      exactLoads.push({ chapterId, artifactId, expectedStageKey })
      const stageId = V3_BOOK_QA_PINNED_STAGE_IDS.find((candidate) => stageKey(candidate) === expectedStageKey)
      if (!stageId) return null
      const selectedRun = Object.keys(refsBySelection).find((key) =>
        key.startsWith(`${chapterId}:`) && refsBySelection[key][expectedStageKey] === artifactId)
      const runId = selectedRun?.slice(chapterId.length + 1) ?? "missing"
      const value = artifact(stageId, chapterId, runId)
      return params.mutateArtifact
        ? params.mutateArtifact(value, stageId, chapterId)
        : value
    },
    store: {
      async save(manifest, groups) {
        saves.push({ manifest: structuredClone(manifest), groups: structuredClone(groups) })
        stored.set(`${manifest.doc_id}:${manifest.qa_corpus_id}`, {
          manifest: structuredClone(manifest),
          groups: structuredClone(groups),
        })
      },
      async load(docId, qaCorpusId) {
        return structuredClone(stored.get(`${docId}:${qaCorpusId}`) ?? null) as never
      },
    },
  }
  return { service: new V3BookQACorpusService(dependencies), exactLoads, saves }
}

test("preserves authoritative canonical non-numeric chapter order and pins exact resolved artifact IDs", async () => {
  const orderedChapters = chapters("z-last-looking", "a-first-looking")
  const selectedRefs = {
    "z-last-looking:run-z": refs("z"),
    "a-first-looking:run-a": refs("a"),
  }
  const { service, exactLoads, saves } = createHarness({
    orderedChapters,
    runsByChapter: {
      "z-last-looking": runs(["run-z", 1]),
      "a-first-looking": runs(["run-a", 1]),
    },
    refsBySelection: selectedRefs,
  })

  const corpus = await service.build({ source: "v3", docId: "doc-one" })

  assert.deepEqual(corpus.manifest.ordered_chapter_ids, ["z-last-looking", "a-first-looking"])
  assert.deepEqual(corpus.manifest.chapters[0].artifact_ids, Object.fromEntries(
    V3_BOOK_QA_PINNED_STAGE_IDS.map((stageId) => [stageId, selectedRefs["z-last-looking:run-z"][stageKey(stageId)]]),
  ))
  assert.equal(exactLoads.every((load) => load.artifactId.includes("content-addressed")), true)
  assert.equal(exactLoads.some((load) => load.expectedStageKey === "evid3"), true)
  assert.equal(exactLoads.some((load) => load.expectedStageKey === "evid4"), true)
  assert.equal(corpus.groups.length, 1)
  assert.equal(saves.length, 1)
  assert.deepEqual(saves[0].groups, corpus.groups)
})

test("keeps the server-provided legacy numeric fallback order", async () => {
  const { service } = createHarness({
    orderedChapters: [
      { chapterId: "chapter-2", title: "Two", index: 2 },
      { chapterId: "chapter-10", title: "Ten", index: 10 },
    ],
    runsByChapter: {
      "chapter-2": runs(["run-chapter-2", 1]),
      "chapter-10": runs(["run-chapter-10", 1]),
    },
  })

  const corpus = await service.build({ source: "v3", docId: "doc-one" })
  assert.deepEqual(corpus.manifest.ordered_chapter_ids, ["chapter-2", "chapter-10"])
})

test("validates the exact build request and explicit chapter run map", async (t) => {
  const harness = createHarness()
  const invalidRequests: Array<[string, unknown]> = [
    ["wrong source", { source: "current", docId: "doc-one" }],
    ["missing doc ID", { source: "v3" }],
    ["extra field", { source: "v3", docId: "doc-one", runId: "extra" }],
    ["non-object run map", { source: "v3", docId: "doc-one", chapterRunIds: [] }],
    ["missing chapter mapping", {
      source: "v3",
      docId: "doc-one",
      chapterRunIds: { "chapter-1": "run-chapter-1" },
    }],
    ["extra chapter mapping", {
      source: "v3",
      docId: "doc-one",
      chapterRunIds: {
        "chapter-1": "run-chapter-1",
        "chapter-2": "run-chapter-2",
        "chapter-3": "run-chapter-3",
      },
    }],
    ["unknown selected run", {
      source: "v3",
      docId: "doc-one",
      chapterRunIds: {
        "chapter-1": "unknown",
        "chapter-2": "run-chapter-2",
      },
    }],
  ]

  for (const [name, input] of invalidRequests) {
    await t.test(name, async () => {
      await assert.rejects(
        harness.service.build(input),
        (error: unknown) => error instanceof V3BookQACorpusRequestError && error.status === 400,
      )
    })
  }
})

test("selects favorite, then latest, then stable run ID without trusting backend order", async () => {
  const orderedChapters = chapters("favorite", "latest", "tie")
  const refsBySelection = {
    "favorite:fav-old": refs("favorite"),
    "latest:newer": refs("latest"),
    "tie:a-run": refs("tie"),
  }
  const { service } = createHarness({
    orderedChapters,
    runsByChapter: {
      favorite: runs(["new-nonfavorite", 100], ["fav-old", 1, true]),
      latest: runs(["older", 2], ["newer", 9]),
      tie: runs(["z-run", 5], ["a-run", 5]),
    },
    refsBySelection,
  })

  const corpus = await service.build({ source: "v3", docId: "doc-one" })
  assert.deepEqual(corpus.manifest.chapters.map((chapter) => chapter.run_id), [
    "fav-old",
    "newer",
    "a-run",
  ])
})

test("records deterministic readiness diagnostics for missing and incompatible pinned artifacts", async () => {
  const selectedRefs = refs("chapter", ["MEM.1", "IDX.2"])
  const { service } = createHarness({
    orderedChapters: chapters("chapter"),
    runsByChapter: { chapter: runs(["run-chapter", 1]) },
    refsBySelection: { "chapter:run-chapter": selectedRefs },
    mutateArtifact(value, stageId) {
      if (stageId === "PRE.2") return null
      if (stageId === "EVID.3") {
        return {
          ...value,
          artifact_version: "v3-evidence-candidate-gate-0.1",
        } as unknown as PipelineArtifact
      }
      if (stageId === "IDX.1") {
        return {
          ...value,
          artifact_version: "v3-retrieval-index-0.1",
          structured_records: [],
        } as unknown as PipelineArtifact
      }
      return value
    },
  })

  const corpus = await service.build({ source: "v3", docId: "doc-one" })
  assert.deepEqual(
    corpus.manifest.readiness.map((diagnostic) => [diagnostic.stage_id, diagnostic.code]),
    [
      ["PRE.2", "artifact_missing_or_corrupt"],
      ["EVID.3", "unsupported_artifact_version"],
      ["MEM.1", "missing_artifact_ref"],
      ["IDX.1", "unsupported_artifact_version"],
      ["IDX.2", "optional_semantic_index_missing"],
    ],
  )
  assert.equal(corpus.groups.length, 0)
  assert.deepEqual(Object.keys(corpus.manifest.chapters[0].artifact_ids),
    V3_BOOK_QA_PINNED_STAGE_IDS.filter((stageId) => stageId !== "MEM.1" && stageId !== "IDX.2"))
  assert.deepEqual(REQUIRED_STAGE_IDS, [
    "PRE.1",
    "PRE.2",
    "EVID.3",
    "EVID.4",
    "MEM.0",
    "MEM.1",
    "EVENT.2",
    "IDX.1",
  ])
})
