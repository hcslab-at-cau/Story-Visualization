"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import PreStageViews from "@/components/v3/PreStageViews"
import V3ReadingQAView from "@/components/v3/V3ReadingQAView"
import V3TimelineGraphView from "@/components/v3/V3TimelineGraphView"
import {
  chooseExistingRunId,
  chooseVisiblePreStage,
  type PreStageId,
} from "@/components/v3/pre-workbench-state"
import type { V3WorkbenchView } from "@/components/v3/v3-navigation"
import { DEFAULT_STAGE_MODELS } from "@/config/pipeline-models"
import {
  isV3EvidencePassId,
  V3_EVIDENCE_PASSES,
  type V3EvidenceArtifact,
  type V3EvidencePassId,
} from "@/lib/pipeline/v3-evidence-types"
import {
  isV3EvidenceClusteringArtifact,
  type V3EvidenceClusteringArtifact,
} from "@/lib/pipeline/v3-evidence-clustering-types"
import {
  isV3EvidenceGateArtifact,
  type V3EvidenceGateArtifact,
} from "@/lib/pipeline/v3-evidence-gate-types"
import type { V3EvidenceRefinementArtifact } from "@/lib/pipeline/v3-evidence-refinement-types"
import type { V3EventGroupingArtifact } from "@/lib/pipeline/v3-event-types"
import type { V3MemoryContractArtifact } from "@/lib/pipeline/v3-memory-contract-types"
import type { V3EventFramesArtifact, V3SceneSituationCardsArtifact } from "@/lib/pipeline/v3-memory-frames-types"
import type {
  V3CausalEdgesArtifact,
  V3GoalGroundingArtifact,
  V3ProgressiveNarrativeMemoryArtifact,
  V3RetrievalIndexArtifact,
} from "@/lib/pipeline/v3-narrative-memory-types"
import type { V3SceneGroupingArtifact } from "@/lib/pipeline/v3-scene-types"
import type {
  V3SemanticIndexArtifact,
  V3SemanticIndexStageId,
} from "@/lib/pipeline/v3-semantic-index-types"
import {
  deleteStageResult,
  listRuns,
  loadRunResults,
  saveRunStageModels,
  stageKey,
  type DataSource,
  type RunMeta,
} from "@/lib/client-data"
import { createTimestampRunId } from "@/lib/run-id"
import type { ContentUnits, PreparedChapter } from "@/types/schema"
import type { V3MentionCandidates } from "@/lib/pipeline/v3-mention-normalization"
import type { ChapterMeta } from "@/types/ui"

interface Props {
  initialDocId: string
  initialChapterId?: string
  initialSeedSource?: DataSource
  initialView?: V3WorkbenchView
}

interface PreResults {
  pre1?: PreparedChapter
  pre2?: ContentUnits
  evid1a?: V3EvidenceArtifact
  evid1b?: V3EvidenceArtifact
  evid1c?: V3EvidenceArtifact
  evid1d?: V3EvidenceArtifact
  evid2?: V3EvidenceRefinementArtifact
  evid3?: V3EvidenceGateArtifact
  evid4?: V3EvidenceClusteringArtifact
  event1?: V3EventGroupingArtifact
  scene0?: V3SceneGroupingArtifact
  mem0?: V3MemoryContractArtifact
  mem1?: V3SceneSituationCardsArtifact
  event2?: V3EventFramesArtifact
  goal1?: V3GoalGroundingArtifact
  caus1?: V3CausalEdgesArtifact
  mem2?: V3ProgressiveNarrativeMemoryArtifact
  idx1?: V3RetrievalIndexArtifact
  idx2?: V3SemanticIndexArtifact
  ent1?: V3MentionCandidates
}

type WorkbenchView = V3WorkbenchView

const PRE_STAGES: Array<{
  id: PreStageId
  title: string
  body: string
}> = [
  {
    id: "PRE.1",
    title: "RawChapter JSON",
    body: "EPUB upload result materialized for this run.",
  },
  {
    id: "PRE.2",
    title: "Narrative paragraphs",
    body: "Paragraphs classified before mention extraction.",
  },
  {
    id: "EVID.1A",
    title: "Entity candidates",
    body: "CAST, PLACE, TIME, and OBJECT mentions for later event construction.",
  },
  {
    id: "EVID.1B",
    title: "Action candidates",
    body: "Action and event-like predicate evidence without fixed subtypes.",
  },
  {
    id: "EVID.1C",
    title: "Goal cues",
    body: "Intent, desire, plan, need, or motivation evidence as candidates.",
  },
  {
    id: "EVID.1D",
    title: "Causal cues",
    body: "Cause, consequence, explanation, enabling, or blocking evidence.",
  },
  {
    id: "EVID.2",
    title: "Candidate refinement",
    body: "Conservatively merge and clean candidates before event grouping.",
  },
  {
    id: "EVID.3",
    title: "Candidate gate",
    body: "Split refined candidates into core, support, and drop before entity clustering.",
  },
  {
    id: "EVID.4",
    title: "Entity clusters",
    body: "Cluster non-dropped CAST, PLACE, TIME, and OBJECT mentions before event grouping.",
  },
  {
    id: "EVENT.1",
    title: "Event candidates",
    body: "Group action-centered evidence into event-sized candidates.",
  },
  {
    id: "SCENE.0",
    title: "Scene candidates",
    body: "Merge neighboring event candidates by time, place, focus, and cast constellation.",
  },
  {
    id: "MEM.0",
    title: "Memory contract",
    body: "Validate event-scene membership and freeze stable refs for later memory and QA stages.",
  },
  {
    id: "MEM.1",
    title: "Scene cards",
    body: "Turn the memory contract into scene situation cards for retrieval context.",
  },
  {
    id: "EVENT.2",
    title: "Event frames",
    body: "Normalize event candidates into conservative predicate-argument frames.",
  },
  {
    id: "GOAL.1",
    title: "Goal grounding",
    body: "Ground goal cues to holders, events, and scenes.",
  },
  {
    id: "CAUS.1",
    title: "Causal edges",
    body: "Create explicit event-event causal edge candidates when cue endpoints resolve.",
  },
  {
    id: "MEM.2",
    title: "Progressive memory",
    body: "Build character, place, object, goal, timeline, and causal memory views.",
  },
  {
    id: "IDX.1",
    title: "Retrieval index",
    body: "Create structured records, graph edges, and text retrieval documents.",
  },
  {
    id: "IDX.2",
    title: "Semantic vector index",
    body: "Embed IDX.1 text documents and store a verified vector bundle for hybrid QA search.",
  },
]

const EVIDENCE_STAGE_IDS = V3_EVIDENCE_PASSES.map((pass) => pass.stageId)

const V3_SOURCE: DataSource = "v3"
const CURRENT_SOURCE: DataSource = "current"

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function normalizePreResults(raw: Record<string, unknown>): PreResults {
  const evid3 = raw[stageKey("EVID.3")]
  const evid4 = raw[stageKey("EVID.4")]

  return {
    pre1: raw[stageKey("PRE.1")] as PreparedChapter | undefined,
    pre2: raw[stageKey("PRE.2")] as ContentUnits | undefined,
    evid1a: raw[stageKey("EVID.1A")] as V3EvidenceArtifact | undefined,
    evid1b: raw[stageKey("EVID.1B")] as V3EvidenceArtifact | undefined,
    evid1c: raw[stageKey("EVID.1C")] as V3EvidenceArtifact | undefined,
    evid1d: raw[stageKey("EVID.1D")] as V3EvidenceArtifact | undefined,
    evid2: raw[stageKey("EVID.2")] as V3EvidenceRefinementArtifact | undefined,
    evid3: isV3EvidenceGateArtifact(evid3) ? evid3 : undefined,
    evid4: isV3EvidenceClusteringArtifact(evid4) ? evid4 : undefined,
    event1: raw[stageKey("EVENT.1")] as V3EventGroupingArtifact | undefined,
    scene0: raw[stageKey("SCENE.0")] as V3SceneGroupingArtifact | undefined,
    mem0: raw[stageKey("MEM.0")] as V3MemoryContractArtifact | undefined,
    mem1: raw[stageKey("MEM.1")] as V3SceneSituationCardsArtifact | undefined,
    event2: raw[stageKey("EVENT.2")] as V3EventFramesArtifact | undefined,
    goal1: raw[stageKey("GOAL.1")] as V3GoalGroundingArtifact | undefined,
    caus1: raw[stageKey("CAUS.1")] as V3CausalEdgesArtifact | undefined,
    mem2: raw[stageKey("MEM.2")] as V3ProgressiveNarrativeMemoryArtifact | undefined,
    idx1: raw[stageKey("IDX.1")] as V3RetrievalIndexArtifact | undefined,
    idx2: raw[stageKey("IDX.2")] as V3SemanticIndexArtifact | undefined,
    ent1: raw[stageKey("ENT.1")] as V3MentionCandidates | undefined,
  }
}

function evidenceResultKey(passId: V3EvidencePassId): keyof Pick<
  PreResults,
  "evid1a" | "evid1b" | "evid1c" | "evid1d"
> {
  if (passId === "EVID.1A") return "evid1a"
  if (passId === "EVID.1B") return "evid1b"
  if (passId === "EVID.1C") return "evid1c"
  return "evid1d"
}

function evidenceArtifactForStage(
  results: PreResults,
  passId: V3EvidencePassId,
): V3EvidenceArtifact | undefined {
  return results[evidenceResultKey(passId)]
}

function clearEvidenceResults(results: PreResults): PreResults {
  return {
    ...results,
    evid1a: undefined,
    evid1b: undefined,
    evid1c: undefined,
    evid1d: undefined,
    evid2: undefined,
    evid3: undefined,
    evid4: undefined,
    event1: undefined,
    scene0: undefined,
    mem0: undefined,
    mem1: undefined,
    event2: undefined,
    goal1: undefined,
    caus1: undefined,
    mem2: undefined,
    idx1: undefined,
    idx2: undefined,
  }
}

function hasAnyEvidenceResult(results: PreResults): boolean {
  return EVIDENCE_STAGE_IDS.some((passId) => Boolean(evidenceArtifactForStage(results, passId)))
}

function hasAllEvidenceResults(results: PreResults): boolean {
  return EVIDENCE_STAGE_IDS.every((passId) => Boolean(evidenceArtifactForStage(results, passId)))
}

function isV3EvidenceRefinementStage(stageId: PreStageId): stageId is "EVID.2" {
  return stageId === "EVID.2"
}

function isV3EvidenceGateStage(stageId: PreStageId): stageId is "EVID.3" {
  return stageId === "EVID.3"
}

function isV3EvidenceClusteringStage(stageId: PreStageId): stageId is "EVID.4" {
  return stageId === "EVID.4"
}

function isV3EventGroupingStage(stageId: PreStageId): stageId is "EVENT.1" {
  return stageId === "EVENT.1"
}

function isV3SceneGroupingStage(stageId: PreStageId): stageId is "SCENE.0" {
  return stageId === "SCENE.0"
}

function isV3MemoryContractStage(stageId: PreStageId): stageId is "MEM.0" {
  return stageId === "MEM.0"
}

function isV3SceneSituationStage(stageId: PreStageId): stageId is "MEM.1" {
  return stageId === "MEM.1"
}

function isV3EventFrameStage(stageId: PreStageId): stageId is "EVENT.2" {
  return stageId === "EVENT.2"
}

function isV3GoalGroundingStage(stageId: PreStageId): stageId is "GOAL.1" {
  return stageId === "GOAL.1"
}

function isV3CausalEdgesStage(stageId: PreStageId): stageId is "CAUS.1" {
  return stageId === "CAUS.1"
}

function isV3ProgressiveMemoryStage(stageId: PreStageId): stageId is "MEM.2" {
  return stageId === "MEM.2"
}

function isV3RetrievalIndexStage(stageId: PreStageId): stageId is "IDX.1" {
  return stageId === "IDX.1"
}

function isV3SemanticIndexStage(stageId: PreStageId): stageId is V3SemanticIndexStageId {
  return stageId === "IDX.2"
}

const V3_RETRIEVAL_INDEX_PREREQUISITES = [
  { stageId: "PRE.1", resultKey: "pre1" },
  { stageId: "PRE.2", resultKey: "pre2" },
  { stageId: "EVID.4", resultKey: "evid4" },
  { stageId: "MEM.2", resultKey: "mem2" },
] as const

function formatStageList(stageIds: readonly string[]): string {
  if (stageIds.length === 1) return stageIds[0]!
  if (stageIds.length === 2) return `${stageIds[0]} and ${stageIds[1]}`
  return `${stageIds.slice(0, -1).join(", ")}, and ${stageIds.at(-1)}`
}

function getV3RetrievalIndexBlockReason(results: PreResults): string | null {
  const missingStages = V3_RETRIEVAL_INDEX_PREREQUISITES
    .filter(({ resultKey }) => !results[resultKey])
    .map(({ stageId }) => stageId)

  return missingStages.length > 0
    ? `Run ${formatStageList(missingStages)} before IDX.1.`
    : null
}

function formatChapterLabel(chapter: ChapterMeta, index: number): string {
  return `${index + 1}. ${chapter.title}`
}

function appendSource(url: string, source: DataSource): string {
  return `${url}${url.includes("?") ? "&" : "?"}source=${encodeURIComponent(source)}`
}

async function loadDocumentChapters(docId: string, source: DataSource): Promise<ChapterMeta[]> {
  const res = await fetch(appendSource(`/api/chapters?docId=${encodeURIComponent(docId)}`, source))
  const data = (await res.json()) as { chapters?: ChapterMeta[]; error?: string }
  if (!res.ok) throw new Error(data.error ?? "Failed to load chapters.")
  return data.chapters ?? []
}

function getStageMeta(stageId: PreStageId): { id: PreStageId; title: string; body: string } {
  return PRE_STAGES.find((stage) => stage.id === stageId) ?? {
    id: stageId,
    title: "Legacy mentions",
    body: "V2-style mention candidates kept available for older runs.",
  }
}

async function runPreStage<T>(
  stageId: PreStageId,
  body: {
    docId: string
    chapterId: string
    runId: string
    model?: string
    source: DataSource
    seedSource: DataSource
  },
): Promise<T> {
  const apiPath = stageId === "PRE.1"
    ? "pre1"
    : stageId === "PRE.2"
      ? "pre2"
      : isV3EvidenceRefinementStage(stageId)
        ? "v3-evidence-refine"
      : isV3EvidenceGateStage(stageId)
        ? "v3-evidence-gate"
      : isV3EvidenceClusteringStage(stageId)
        ? "v3-evidence-cluster"
      : isV3EventGroupingStage(stageId)
        ? "v3-events"
      : isV3SceneGroupingStage(stageId)
        ? "v3-scenes"
      : isV3MemoryContractStage(stageId)
        ? "v3-memory-contract"
      : isV3SceneSituationStage(stageId)
        ? "v3-scene-cards"
      : isV3EventFrameStage(stageId)
        ? "v3-event-frames"
      : isV3GoalGroundingStage(stageId)
        ? "v3-goals"
      : isV3CausalEdgesStage(stageId)
        ? "v3-causality"
      : isV3ProgressiveMemoryStage(stageId)
        ? "v3-progressive-memory"
      : isV3RetrievalIndexStage(stageId)
        ? "v3-retrieval-index"
      : isV3SemanticIndexStage(stageId)
        ? "v3-semantic-index"
      : isV3EvidencePassId(stageId)
        ? "v3-evidence"
        : "v3-mentions"
  const res = await fetch(`/api/pipeline/${apiPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      docId: body.docId,
      chapterId: body.chapterId,
      runId: body.runId,
      parents: {},
      model: body.model,
      source: body.source,
      seedSource: body.seedSource,
      ...(isV3EvidencePassId(stageId) ? { passId: stageId } : {}),
    }),
  })
  const data = (await res.json()) as T & { error?: string }
  if (!res.ok) throw new Error(data.error ?? `${stageId} failed with HTTP ${res.status}`)
  return data
}

export default function PreMentionWorkbench({
  initialDocId,
  initialChapterId,
  initialSeedSource = CURRENT_SOURCE,
  initialView = "pipeline",
}: Props) {
  const [docId, setDocId] = useState(initialDocId)
  const [chapters, setChapters] = useState<ChapterMeta[]>([])
  const [chapterId, setChapterId] = useState(initialChapterId ?? "")
  const [seedSource, setSeedSource] = useState<DataSource>(initialSeedSource)
  const [runId, setRunId] = useState("")
  const [runs, setRuns] = useState<RunMeta[]>([])
  const [results, setResults] = useState<PreResults>({})
  const [workbenchView, setWorkbenchView] = useState<WorkbenchView>(initialView)
  const [activeStage, setActiveStage] = useState<PreStageId>("PRE.1")
  const [runningStage, setRunningStage] = useState<PreStageId | null>(null)
  const [loadingRuns, setLoadingRuns] = useState(false)
  const [loadingResults, setLoadingResults] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pre2Model, setPre2Model] = useState(DEFAULT_STAGE_MODELS["PRE.2"] ?? "openai/gpt-4o-mini")
  const [evidenceModels, setEvidenceModels] = useState<Record<V3EvidencePassId, string>>({
    "EVID.1A": DEFAULT_STAGE_MODELS["EVID.1A"] ?? "google/gemini-3.5-flash",
    "EVID.1B": DEFAULT_STAGE_MODELS["EVID.1B"] ?? "google/gemini-3.5-flash",
    "EVID.1C": DEFAULT_STAGE_MODELS["EVID.1C"] ?? "google/gemini-3.5-flash",
    "EVID.1D": DEFAULT_STAGE_MODELS["EVID.1D"] ?? "google/gemini-3.5-flash",
  })
  const [evid2Model, setEvid2Model] = useState(DEFAULT_STAGE_MODELS["EVID.2"] ?? "google/gemini-3.5-flash")
  const [evid3Model, setEvid3Model] = useState(DEFAULT_STAGE_MODELS["EVID.3"] ?? "google/gemini-3.5-flash")
  const [event1Model, setEvent1Model] = useState(DEFAULT_STAGE_MODELS["EVENT.1"] ?? "google/gemini-3.5-flash")
  const [scene0Model, setScene0Model] = useState(DEFAULT_STAGE_MODELS["SCENE.0"] ?? "google/gemini-3.5-flash")
  const [ent1Model, setEnt1Model] = useState(DEFAULT_STAGE_MODELS["ENT.1"] ?? "google/gemini-3.5-flash")
  const refreshResultsRequestRef = useRef(0)

  useEffect(() => {
    setRunId((current) => current || createTimestampRunId())
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadInitialDocument() {
      setDocId(initialDocId)
      setSeedSource(initialSeedSource)
      setRunId(createTimestampRunId())
      setRuns([])
      setResults({})
      setActiveStage("PRE.1")
      setWorkbenchView(initialView)
      setError(null)

      try {
        const nextChapters = await loadDocumentChapters(initialDocId, initialSeedSource)
        if (cancelled) return

        setChapters(nextChapters)
        const requestedChapter = initialChapterId
          ? nextChapters.find((chapter) => chapter.chapterId === initialChapterId)
          : undefined
        setChapterId(requestedChapter?.chapterId ?? nextChapters[0]?.chapterId ?? "")
      } catch (loadError) {
        if (!cancelled) setError(getErrorMessage(loadError))
      }
    }

    void loadInitialDocument()
    return () => {
      cancelled = true
    }
  }, [initialChapterId, initialDocId, initialSeedSource, initialView])

  const selectedChapterIndex = chapters.findIndex((chapter) => chapter.chapterId === chapterId)
  const selectedChapter = selectedChapterIndex >= 0 ? chapters[selectedChapterIndex] : undefined
  const runExists = runs.some((run) => run.runId === runId)

  const refreshResults = useCallback(async () => {
    const requestId = refreshResultsRequestRef.current + 1
    refreshResultsRequestRef.current = requestId

    if (!docId || !chapterId || !runId) {
      setResults({})
      return
    }

    setLoadingResults(true)
    setError(null)
    try {
      const raw = await loadRunResults(docId, chapterId, runId, V3_SOURCE)
      if (refreshResultsRequestRef.current !== requestId) return

      const nextResults = normalizePreResults(raw)
      setResults(nextResults)
      setActiveStage(chooseVisiblePreStage(nextResults))
    } catch (loadError) {
      if (refreshResultsRequestRef.current !== requestId) return
      setError(getErrorMessage(loadError))
    } finally {
      if (refreshResultsRequestRef.current !== requestId) return
      setLoadingResults(false)
    }
  }, [chapterId, docId, runId])

  useEffect(() => {
    void refreshResults()
  }, [refreshResults])

  useEffect(() => {
    let cancelled = false

    async function refreshRuns() {
      if (!docId || !chapterId) {
        setRuns([])
        return
      }

      setLoadingRuns(true)
      try {
        const nextRuns = await listRuns(docId, chapterId, V3_SOURCE)
        if (cancelled) return

        setRuns(nextRuns)
        setRunId((current) => {
          if (current && nextRuns.some((run) => run.runId === current)) return current

          return chooseExistingRunId(nextRuns) || createTimestampRunId(nextRuns.map((run) => run.runId))
        })
      } catch (loadError) {
        if (!cancelled) setError(getErrorMessage(loadError))
      } finally {
        if (!cancelled) setLoadingRuns(false)
      }
    }

    void refreshRuns()
    return () => {
      cancelled = true
    }
  }, [chapterId, docId])

  function handleChapterChange(nextChapterId: string) {
    setChapterId(nextChapterId)
    setRunId(createTimestampRunId([runId]))
    setResults({})
    setActiveStage("PRE.1")
    setWorkbenchView("pipeline")
    setError(null)
  }

  async function refreshRunsAfterStage() {
    if (!docId || !chapterId) return
    const nextRuns = await listRuns(docId, chapterId, V3_SOURCE)
    setRuns(nextRuns)
  }

  async function deleteScene0IfPresent() {
    if (results.scene0) await deleteStageResult(docId, chapterId, runId, "SCENE.0", V3_SOURCE)
  }

  async function deleteIdx1IfPresent() {
    if (results.idx2) await deleteStageResult(docId, chapterId, runId, "IDX.2", V3_SOURCE)
    if (results.idx1) await deleteStageResult(docId, chapterId, runId, "IDX.1", V3_SOURCE)
  }

  async function deleteMem2IfPresent() {
    await deleteIdx1IfPresent()
    if (results.mem2) await deleteStageResult(docId, chapterId, runId, "MEM.2", V3_SOURCE)
  }

  async function deleteCaus1IfPresent() {
    await deleteMem2IfPresent()
    if (results.caus1) await deleteStageResult(docId, chapterId, runId, "CAUS.1", V3_SOURCE)
  }

  async function deleteGoal1IfPresent() {
    await deleteCaus1IfPresent()
    if (results.goal1) await deleteStageResult(docId, chapterId, runId, "GOAL.1", V3_SOURCE)
  }

  async function deleteEvent2IfPresent() {
    await deleteGoal1IfPresent()
    if (results.event2) await deleteStageResult(docId, chapterId, runId, "EVENT.2", V3_SOURCE)
  }

  async function deleteMem1IfPresent() {
    await deleteEvent2IfPresent()
    if (results.mem1) await deleteStageResult(docId, chapterId, runId, "MEM.1", V3_SOURCE)
  }

  async function deleteMem0IfPresent() {
    await deleteMem1IfPresent()
    if (results.mem0) await deleteStageResult(docId, chapterId, runId, "MEM.0", V3_SOURCE)
  }

  async function handleRunStage(stageId: PreStageId) {
    if (!docId || !chapterId || !runId || runningStage) return
    if (stageId === "PRE.2" && !results.pre1) {
      setError("Run PRE.1 before PRE.2.")
      return
    }
    if ((isV3EvidencePassId(stageId) || stageId === "ENT.1") && !results.pre2) {
      setError(`Run PRE.2 before ${stageId}.`)
      return
    }
    if (isV3EvidenceRefinementStage(stageId) && !hasAllEvidenceResults(results)) {
      setError("Run EVID.1A-D before EVID.2.")
      return
    }
    if (isV3EvidenceGateStage(stageId) && !results.evid2) {
      setError("Run EVID.2 before EVID.3.")
      return
    }
    if (isV3EvidenceClusteringStage(stageId) && !results.evid3) {
      setError("Run EVID.3 before EVID.4.")
      return
    }
    if (isV3EventGroupingStage(stageId) && !results.evid4) {
      setError("Run EVID.4 before EVENT.1.")
      return
    }
    if (isV3SceneGroupingStage(stageId) && !results.event1) {
      setError("Run EVENT.1 before SCENE.0.")
      return
    }
    if (isV3MemoryContractStage(stageId) && !results.scene0) {
      setError("Run SCENE.0 before MEM.0.")
      return
    }
    if (isV3SceneSituationStage(stageId) && !results.mem0) {
      setError("Run MEM.0 before MEM.1.")
      return
    }
    if (isV3EventFrameStage(stageId) && !results.mem1) {
      setError("Run MEM.1 before EVENT.2.")
      return
    }
    if (isV3GoalGroundingStage(stageId) && !results.event2) {
      setError("Run EVENT.2 before GOAL.1.")
      return
    }
    if (isV3CausalEdgesStage(stageId) && !results.goal1) {
      setError("Run GOAL.1 before CAUS.1.")
      return
    }
    if (isV3ProgressiveMemoryStage(stageId) && !results.caus1) {
      setError("Run CAUS.1 before MEM.2.")
      return
    }
    if (isV3RetrievalIndexStage(stageId)) {
      const blockReason = getV3RetrievalIndexBlockReason(results)
      if (blockReason) {
        setError(blockReason)
        return
      }
    }
    if (isV3SemanticIndexStage(stageId) && !results.idx1) {
      setError("Run IDX.1 before IDX.2.")
      return
    }

    setRunningStage(stageId)
    setError(null)
    try {
      if (stageId === "PRE.1") {
        await deleteMem0IfPresent()
        await deleteScene0IfPresent()
        if (results.event1) await deleteStageResult(docId, chapterId, runId, "EVENT.1", V3_SOURCE)
        if (results.evid4) await deleteStageResult(docId, chapterId, runId, "EVID.4", V3_SOURCE)
        if (results.evid3) await deleteStageResult(docId, chapterId, runId, "EVID.3", V3_SOURCE)
        if (results.evid2) await deleteStageResult(docId, chapterId, runId, "EVID.2", V3_SOURCE)
        for (const evidenceStageId of EVIDENCE_STAGE_IDS) {
          if (evidenceArtifactForStage(results, evidenceStageId)) {
            await deleteStageResult(docId, chapterId, runId, evidenceStageId, V3_SOURCE)
          }
        }
        if (results.ent1) await deleteStageResult(docId, chapterId, runId, "ENT.1", V3_SOURCE)
        if (results.pre2) await deleteStageResult(docId, chapterId, runId, "PRE.2", V3_SOURCE)
      } else if (stageId === "PRE.2") {
        await saveRunStageModels(docId, chapterId, runId, { "PRE.2": pre2Model }, V3_SOURCE)
        await deleteMem0IfPresent()
        await deleteScene0IfPresent()
        if (results.event1) await deleteStageResult(docId, chapterId, runId, "EVENT.1", V3_SOURCE)
        if (results.evid4) await deleteStageResult(docId, chapterId, runId, "EVID.4", V3_SOURCE)
        if (results.evid3) await deleteStageResult(docId, chapterId, runId, "EVID.3", V3_SOURCE)
        if (results.evid2) await deleteStageResult(docId, chapterId, runId, "EVID.2", V3_SOURCE)
        for (const evidenceStageId of EVIDENCE_STAGE_IDS) {
          if (evidenceArtifactForStage(results, evidenceStageId)) {
            await deleteStageResult(docId, chapterId, runId, evidenceStageId, V3_SOURCE)
          }
        }
        if (results.ent1) await deleteStageResult(docId, chapterId, runId, "ENT.1", V3_SOURCE)
      } else if (isV3EvidencePassId(stageId)) {
        await saveRunStageModels(docId, chapterId, runId, { [stageId]: evidenceModels[stageId] }, V3_SOURCE)
        await deleteMem0IfPresent()
        await deleteScene0IfPresent()
        if (results.event1) await deleteStageResult(docId, chapterId, runId, "EVENT.1", V3_SOURCE)
        if (results.evid4) await deleteStageResult(docId, chapterId, runId, "EVID.4", V3_SOURCE)
        if (results.evid3) await deleteStageResult(docId, chapterId, runId, "EVID.3", V3_SOURCE)
        if (results.evid2) await deleteStageResult(docId, chapterId, runId, "EVID.2", V3_SOURCE)
      } else if (isV3EvidenceRefinementStage(stageId)) {
        await saveRunStageModels(docId, chapterId, runId, { "EVID.2": evid2Model }, V3_SOURCE)
        await deleteMem0IfPresent()
        await deleteScene0IfPresent()
        if (results.event1) await deleteStageResult(docId, chapterId, runId, "EVENT.1", V3_SOURCE)
        if (results.evid4) await deleteStageResult(docId, chapterId, runId, "EVID.4", V3_SOURCE)
        if (results.evid3) await deleteStageResult(docId, chapterId, runId, "EVID.3", V3_SOURCE)
      } else if (isV3EvidenceGateStage(stageId)) {
        await saveRunStageModels(docId, chapterId, runId, { "EVID.3": evid3Model }, V3_SOURCE)
        await deleteMem0IfPresent()
        await deleteScene0IfPresent()
        if (results.event1) await deleteStageResult(docId, chapterId, runId, "EVENT.1", V3_SOURCE)
        if (results.evid4) await deleteStageResult(docId, chapterId, runId, "EVID.4", V3_SOURCE)
      } else if (isV3EvidenceClusteringStage(stageId)) {
        await deleteMem0IfPresent()
        await deleteScene0IfPresent()
        if (results.event1) await deleteStageResult(docId, chapterId, runId, "EVENT.1", V3_SOURCE)
      } else if (isV3EventGroupingStage(stageId)) {
        await saveRunStageModels(docId, chapterId, runId, { "EVENT.1": event1Model }, V3_SOURCE)
        await deleteMem0IfPresent()
        await deleteScene0IfPresent()
      } else if (isV3SceneGroupingStage(stageId)) {
        await saveRunStageModels(docId, chapterId, runId, { "SCENE.0": scene0Model }, V3_SOURCE)
        await deleteMem0IfPresent()
      } else if (isV3MemoryContractStage(stageId)) {
        // rule-only stage
        await deleteMem1IfPresent()
      } else if (isV3SceneSituationStage(stageId)) {
        // rule-only stage
        await deleteEvent2IfPresent()
      } else if (isV3EventFrameStage(stageId)) {
        // rule-only stage
        await deleteGoal1IfPresent()
      } else if (isV3GoalGroundingStage(stageId)) {
        // rule-only stage
        await deleteCaus1IfPresent()
      } else if (isV3CausalEdgesStage(stageId)) {
        // rule-only stage
        await deleteMem2IfPresent()
      } else if (isV3ProgressiveMemoryStage(stageId)) {
        // rule-only stage
        await deleteIdx1IfPresent()
      } else if (isV3RetrievalIndexStage(stageId)) {
        // rule-only stage
        if (results.idx2) await deleteStageResult(docId, chapterId, runId, "IDX.2", V3_SOURCE)
      } else if (isV3SemanticIndexStage(stageId)) {
        // embedding stage
      } else {
        await saveRunStageModels(docId, chapterId, runId, { "ENT.1": ent1Model }, V3_SOURCE)
      }

      const data = stageId === "PRE.1"
        ? await runPreStage<PreparedChapter>(stageId, {
          docId,
          chapterId,
          runId,
          source: V3_SOURCE,
          seedSource,
        })
        : stageId === "PRE.2"
          ? await runPreStage<ContentUnits>(stageId, {
            docId,
            chapterId,
            runId,
            model: pre2Model,
            source: V3_SOURCE,
            seedSource,
          })
          : isV3EvidencePassId(stageId)
            ? await runPreStage<V3EvidenceArtifact>(stageId, {
              docId,
              chapterId,
              runId,
              model: evidenceModels[stageId],
              source: V3_SOURCE,
              seedSource,
            })
            : isV3EvidenceRefinementStage(stageId)
              ? await runPreStage<V3EvidenceRefinementArtifact>(stageId, {
                docId,
                chapterId,
                runId,
                model: evid2Model,
                source: V3_SOURCE,
                seedSource,
              })
            : isV3EvidenceGateStage(stageId)
              ? await runPreStage<V3EvidenceGateArtifact>(stageId, {
                docId,
                chapterId,
                runId,
                model: evid3Model,
                source: V3_SOURCE,
                seedSource,
              })
            : isV3EvidenceClusteringStage(stageId)
              ? await runPreStage<V3EvidenceClusteringArtifact>(stageId, {
                docId,
                chapterId,
                runId,
                source: V3_SOURCE,
                seedSource,
              })
            : isV3EventGroupingStage(stageId)
              ? await runPreStage<V3EventGroupingArtifact>(stageId, {
                docId,
                chapterId,
                runId,
                model: event1Model,
                source: V3_SOURCE,
                seedSource,
              })
            : isV3SceneGroupingStage(stageId)
              ? await runPreStage<V3SceneGroupingArtifact>(stageId, {
                docId,
                chapterId,
                runId,
                model: scene0Model,
                source: V3_SOURCE,
                seedSource,
              })
            : isV3MemoryContractStage(stageId)
              ? await runPreStage<V3MemoryContractArtifact>(stageId, {
                docId,
                chapterId,
                runId,
                source: V3_SOURCE,
                seedSource,
              })
            : isV3SceneSituationStage(stageId)
              ? await runPreStage<V3SceneSituationCardsArtifact>(stageId, {
                docId,
                chapterId,
                runId,
                source: V3_SOURCE,
                seedSource,
              })
            : isV3EventFrameStage(stageId)
              ? await runPreStage<V3EventFramesArtifact>(stageId, {
                docId,
                chapterId,
                runId,
                source: V3_SOURCE,
                seedSource,
              })
            : isV3GoalGroundingStage(stageId)
              ? await runPreStage<V3GoalGroundingArtifact>(stageId, {
                docId,
                chapterId,
                runId,
                source: V3_SOURCE,
                seedSource,
              })
            : isV3CausalEdgesStage(stageId)
              ? await runPreStage<V3CausalEdgesArtifact>(stageId, {
                docId,
                chapterId,
                runId,
                source: V3_SOURCE,
                seedSource,
              })
            : isV3ProgressiveMemoryStage(stageId)
              ? await runPreStage<V3ProgressiveNarrativeMemoryArtifact>(stageId, {
                docId,
                chapterId,
                runId,
                source: V3_SOURCE,
                seedSource,
              })
            : isV3RetrievalIndexStage(stageId)
              ? await runPreStage<V3RetrievalIndexArtifact>(stageId, {
                docId,
                chapterId,
                runId,
                source: V3_SOURCE,
                seedSource,
              })
            : isV3SemanticIndexStage(stageId)
              ? await runPreStage<V3SemanticIndexArtifact>(stageId, {
                docId,
                chapterId,
                runId,
                source: V3_SOURCE,
                seedSource,
              })
            : await runPreStage<V3MentionCandidates>(stageId, {
              docId,
              chapterId,
              runId,
              model: ent1Model,
              source: V3_SOURCE,
              seedSource,
            })

      setResults((current) => {
        if (stageId === "PRE.1") {
          return {
            pre1: data as PreparedChapter,
            pre2: undefined,
            evid1a: undefined,
            evid1b: undefined,
            evid1c: undefined,
            evid1d: undefined,
            evid2: undefined,
            evid3: undefined,
            evid4: undefined,
            event1: undefined,
            scene0: undefined,
            mem0: undefined,
            mem1: undefined,
            event2: undefined,
            goal1: undefined,
            caus1: undefined,
            mem2: undefined,
            idx1: undefined,
            ent1: undefined,
          }
        }
        if (stageId === "PRE.2") {
          return clearEvidenceResults({ ...current, pre2: data as ContentUnits, ent1: undefined })
        }
        if (isV3EvidencePassId(stageId)) {
          return {
            ...current,
            [evidenceResultKey(stageId)]: data as V3EvidenceArtifact,
            evid2: undefined,
            evid3: undefined,
            evid4: undefined,
            event1: undefined,
            scene0: undefined,
            mem0: undefined,
            mem1: undefined,
            event2: undefined,
            goal1: undefined,
            caus1: undefined,
            mem2: undefined,
            idx1: undefined,
          }
        }
        if (isV3EvidenceRefinementStage(stageId)) {
          return {
            ...current,
            evid2: data as V3EvidenceRefinementArtifact,
            evid3: undefined,
            evid4: undefined,
            event1: undefined,
            scene0: undefined,
            mem0: undefined,
            mem1: undefined,
            event2: undefined,
            goal1: undefined,
            caus1: undefined,
            mem2: undefined,
            idx1: undefined,
          }
        }
        if (isV3EvidenceGateStage(stageId)) {
          return {
            ...current,
            evid3: data as V3EvidenceGateArtifact,
            evid4: undefined,
            event1: undefined,
            scene0: undefined,
            mem0: undefined,
            mem1: undefined,
            event2: undefined,
            goal1: undefined,
            caus1: undefined,
            mem2: undefined,
            idx1: undefined,
          }
        }
        if (isV3EvidenceClusteringStage(stageId)) {
          return {
            ...current,
            evid4: data as V3EvidenceClusteringArtifact,
            event1: undefined,
            scene0: undefined,
            mem0: undefined,
            mem1: undefined,
            event2: undefined,
            goal1: undefined,
            caus1: undefined,
            mem2: undefined,
            idx1: undefined,
          }
        }
        if (isV3EventGroupingStage(stageId)) {
          return {
            ...current,
            event1: data as V3EventGroupingArtifact,
            scene0: undefined,
            mem0: undefined,
            mem1: undefined,
            event2: undefined,
            goal1: undefined,
            caus1: undefined,
            mem2: undefined,
            idx1: undefined,
          }
        }
        if (isV3SceneGroupingStage(stageId)) {
          return {
            ...current,
            scene0: data as V3SceneGroupingArtifact,
            mem0: undefined,
            mem1: undefined,
            event2: undefined,
            goal1: undefined,
            caus1: undefined,
            mem2: undefined,
            idx1: undefined,
          }
        }
        if (isV3MemoryContractStage(stageId)) {
          return {
            ...current,
            mem0: data as V3MemoryContractArtifact,
            mem1: undefined,
            event2: undefined,
            goal1: undefined,
            caus1: undefined,
            mem2: undefined,
            idx1: undefined,
          }
        }
        if (isV3SceneSituationStage(stageId)) {
          return {
            ...current,
            mem1: data as V3SceneSituationCardsArtifact,
            event2: undefined,
            goal1: undefined,
            caus1: undefined,
            mem2: undefined,
            idx1: undefined,
          }
        }
        if (isV3EventFrameStage(stageId)) {
          return {
            ...current,
            event2: data as V3EventFramesArtifact,
            goal1: undefined,
            caus1: undefined,
            mem2: undefined,
            idx1: undefined,
          }
        }
        if (isV3GoalGroundingStage(stageId)) {
          return { ...current, goal1: data as V3GoalGroundingArtifact, caus1: undefined, mem2: undefined, idx1: undefined }
        }
        if (isV3CausalEdgesStage(stageId)) {
          return { ...current, caus1: data as V3CausalEdgesArtifact, mem2: undefined, idx1: undefined }
        }
        if (isV3ProgressiveMemoryStage(stageId)) {
          return { ...current, mem2: data as V3ProgressiveNarrativeMemoryArtifact, idx1: undefined }
        }
        if (isV3RetrievalIndexStage(stageId)) {
          return { ...current, idx1: data as V3RetrievalIndexArtifact, idx2: undefined }
        }
        if (isV3SemanticIndexStage(stageId)) {
          return { ...current, idx2: data as V3SemanticIndexArtifact }
        }
        return { ...current, ent1: data as V3MentionCandidates }
      })
      if (!isV3SemanticIndexStage(stageId) && stageId !== "ENT.1") {
        setResults((current) => ({ ...current, idx2: undefined }))
      }
      setActiveStage(stageId)
      setWorkbenchView("pipeline")
      await refreshRunsAfterStage()
    } catch (runError) {
      setError(getErrorMessage(runError))
    } finally {
      setRunningStage(null)
    }
  }

  const progressLabel = useMemo(() => {
    if (!docId) return "No document selected"
    if (!chapterId) return "No chapter selected"
    if (runningStage) return `${runningStage} running`
    if (results.idx2) return "Semantic vector index ready"
    if (results.idx1) return "Retrieval index ready"
    if (results.mem2) return "Progressive memory ready"
    if (results.caus1) return "Causal edges ready"
    if (results.goal1) return "Goals grounded"
    if (results.event2) return "Event frames ready"
    if (results.mem1) return "Scene situation cards ready"
    if (results.mem0) return "Narrative contract ready"
    if (results.scene0) return "Scene candidates ready"
    if (results.event1) return "Event candidates ready"
    if (results.evid4) return "Entity clusters ready"
    if (results.evid3) return "Candidate gate ready"
    if (results.evid2) return "Refined evidence ready"
    if (hasAllEvidenceResults(results)) return "Evidence candidates ready"
    if (hasAnyEvidenceResult(results)) return "Evidence candidates partially ready"
    if (results.ent1) return "Scene mentions ready"
    if (results.pre2) return "Ready for evidence extraction"
    if (results.pre1) return "PRE.1 complete"
    return "Ready to run PRE.1"
  }, [chapterId, docId, results, runningStage])

  function isStageDone(stageId: PreStageId): boolean {
    if (stageId === "PRE.1") return Boolean(results.pre1)
    if (stageId === "PRE.2") return Boolean(results.pre2)
    if (isV3SemanticIndexStage(stageId)) return Boolean(results.idx2)
    if (isV3RetrievalIndexStage(stageId)) return Boolean(results.idx1)
    if (isV3ProgressiveMemoryStage(stageId)) return Boolean(results.mem2)
    if (isV3CausalEdgesStage(stageId)) return Boolean(results.caus1)
    if (isV3GoalGroundingStage(stageId)) return Boolean(results.goal1)
    if (isV3EventFrameStage(stageId)) return Boolean(results.event2)
    if (isV3SceneSituationStage(stageId)) return Boolean(results.mem1)
    if (isV3MemoryContractStage(stageId)) return Boolean(results.mem0)
    if (isV3SceneGroupingStage(stageId)) return Boolean(results.scene0)
    if (isV3EventGroupingStage(stageId)) return Boolean(results.event1)
    if (isV3EvidenceClusteringStage(stageId)) return Boolean(results.evid4)
    if (isV3EvidenceGateStage(stageId)) return Boolean(results.evid3)
    if (isV3EvidenceRefinementStage(stageId)) return Boolean(results.evid2)
    if (isV3EvidencePassId(stageId)) return Boolean(evidenceArtifactForStage(results, stageId))
    return Boolean(results.ent1)
  }

  function getStageBlockReason(stageId: PreStageId): string | null {
    if (!docId) return "Select or upload a document first."
    if (!chapterId) return "Select a chapter first."
    if (!runId) return "Create or select a run first."
    if (runningStage) return `${runningStage} is running.`
    if (stageId === "PRE.2" && !results.pre1) return "Run PRE.1 first."
    if ((isV3EvidencePassId(stageId) || stageId === "ENT.1") && !results.pre2) return "Run PRE.2 first."
    if (isV3EvidenceRefinementStage(stageId) && !hasAllEvidenceResults(results)) return "Run EVID.1A-D first."
    if (isV3EvidenceGateStage(stageId) && !results.evid2) return "Run EVID.2 first."
    if (isV3EvidenceClusteringStage(stageId) && !results.evid3) return "Run EVID.3 first."
    if (isV3EventGroupingStage(stageId) && !results.evid4) return "Run EVID.4 first."
    if (isV3SceneGroupingStage(stageId) && !results.event1) return "Run EVENT.1 first."
    if (isV3MemoryContractStage(stageId) && !results.scene0) return "Run SCENE.0 first."
    if (isV3SceneSituationStage(stageId) && !results.mem0) return "Run MEM.0 first."
    if (isV3EventFrameStage(stageId) && !results.mem1) return "Run MEM.1 first."
    if (isV3GoalGroundingStage(stageId) && !results.event2) return "Run EVENT.2 first."
    if (isV3CausalEdgesStage(stageId) && !results.goal1) return "Run GOAL.1 first."
    if (isV3ProgressiveMemoryStage(stageId) && !results.caus1) return "Run CAUS.1 first."
    if (isV3RetrievalIndexStage(stageId)) return getV3RetrievalIndexBlockReason(results)
    if (isV3SemanticIndexStage(stageId) && !results.idx1) return "Run IDX.1 first."
    return null
  }

  function getStageStateLabel(stageId: PreStageId): string {
    if (runningStage === stageId) return "Running"
    if (isStageDone(stageId)) return "Done"
    if (getStageBlockReason(stageId)) return "Locked"
    return "Ready"
  }

  function getStageStateClass(stageId: PreStageId): string {
    if (runningStage === stageId) return "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
    if (isStageDone(stageId)) return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
    if (getStageBlockReason(stageId)) return "bg-zinc-100 text-zinc-500"
    return "bg-blue-50 text-blue-700 ring-1 ring-blue-200"
  }

  function stageUsesModel(stageId: PreStageId): boolean {
    return stageId !== "PRE.1"
      && !isV3EvidenceClusteringStage(stageId)
      && !isV3MemoryContractStage(stageId)
      && !isV3SceneSituationStage(stageId)
      && !isV3EventFrameStage(stageId)
      && !isV3GoalGroundingStage(stageId)
      && !isV3CausalEdgesStage(stageId)
      && !isV3ProgressiveMemoryStage(stageId)
      && !isV3RetrievalIndexStage(stageId)
      && !isV3SemanticIndexStage(stageId)
  }

  function getStageModel(stageId: PreStageId): string {
    if (stageId === "PRE.2") return pre2Model
    if (isV3EvidenceRefinementStage(stageId)) return evid2Model
    if (isV3EvidenceGateStage(stageId)) return evid3Model
    if (isV3EventGroupingStage(stageId)) return event1Model
    if (isV3SceneGroupingStage(stageId)) return scene0Model
    if (isV3EvidencePassId(stageId)) return evidenceModels[stageId]
    return ent1Model
  }

  function setStageModel(stageId: PreStageId, value: string) {
    if (stageId === "PRE.2") setPre2Model(value)
    else if (isV3EvidenceRefinementStage(stageId)) setEvid2Model(value)
    else if (isV3EvidenceGateStage(stageId)) setEvid3Model(value)
    else if (isV3EventGroupingStage(stageId)) setEvent1Model(value)
    else if (isV3SceneGroupingStage(stageId)) setScene0Model(value)
    else if (isV3EvidencePassId(stageId)) {
      setEvidenceModels((current) => ({
        ...current,
        [stageId]: value,
      }))
    } else setEnt1Model(value)
  }

  const activeStageMeta = getStageMeta(activeStage)
  const activeStageBlockReason = getStageBlockReason(activeStage)
  const completedStageCount = PRE_STAGES.filter((stage) => isStageDone(stage.id)).length
  const showWorkspaceSidebar = workbenchView === "pipeline"

  return (
    <div className="mx-auto flex w-full max-w-[2200px] flex-1 flex-col gap-5 p-4 sm:p-6">
      <section className="rounded-xl border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">V3 PRE workspace</p>
            <h1 className="mt-1 text-xl font-semibold text-zinc-950">EPUB to event evidence candidates</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500">
              Keeps v2 reachable while v3 stores its own run artifacts and prepares seven evidence candidate types.
            </p>
          </div>
          <div className="rounded-lg bg-zinc-50 px-4 py-3 text-sm">
            <p className="font-medium text-zinc-800">{progressLabel}</p>
            <p className="mt-1 font-mono text-xs text-zinc-500">{runId || "run pending"}</p>
            <Link
              href="/v3/library"
              className="mt-3 inline-flex rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50"
            >
              Change document
            </Link>
          </div>
        </div>
      </section>

      <div
        className={`grid min-h-0 flex-1 gap-5 ${
          showWorkspaceSidebar
            ? "xl:grid-cols-[300px_minmax(0,1fr)] 2xl:grid-cols-[320px_minmax(0,1fr)]"
            : "xl:grid-cols-1"
        }`}
      >
        {showWorkspaceSidebar && (
        <aside className="order-2 min-h-0 space-y-4 xl:sticky xl:top-24 xl:order-1 xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto xl:pr-1">
          <section className="rounded-xl border border-zinc-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Chapter</p>
                <h2 className="mt-1 text-sm font-semibold text-zinc-900">
                  {selectedChapter ? formatChapterLabel(selectedChapter, selectedChapterIndex) : "Select a document"}
                </h2>
              </div>
              {chapters.length > 0 && (
                <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-500">
                  {chapters.length}
                </span>
              )}
            </div>

            {chapters.length > 0 && (
              <div className="mt-4 space-y-3">
                <select
                  value={chapterId}
                  onChange={(event) => handleChapterChange(event.target.value)}
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm"
                >
                  {chapters.map((chapter, index) => (
                    <option key={chapter.chapterId} value={chapter.chapterId}>
                      {formatChapterLabel(chapter, index)}
                    </option>
                  ))}
                </select>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const prev = chapters[selectedChapterIndex - 1]
                      if (prev) handleChapterChange(prev.chapterId)
                    }}
                    disabled={selectedChapterIndex <= 0}
                    className="rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const next = chapters[selectedChapterIndex + 1]
                      if (next) handleChapterChange(next.chapterId)
                    }}
                    disabled={selectedChapterIndex < 0 || selectedChapterIndex >= chapters.length - 1}
                    className="rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-zinc-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Run</p>
                <h2 className="mt-1 text-sm font-semibold text-zinc-900">Current artifact set</h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setRunId(createTimestampRunId(runs.map((run) => run.runId)))
                  setResults({})
                  setActiveStage("PRE.1")
                  setWorkbenchView("pipeline")
                }}
                disabled={!docId || !chapterId || runningStage !== null}
                className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 disabled:opacity-40"
              >
                New
              </button>
            </div>
            <select
              value={runExists ? runId : ""}
              onChange={(event) => {
                if (event.target.value) {
                  setRunId(event.target.value)
                  setResults({})
                  setActiveStage("PRE.1")
                  setWorkbenchView("pipeline")
                }
              }}
              disabled={!docId || !chapterId || loadingRuns || runs.length === 0}
              className="mt-4 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-xs disabled:opacity-50"
            >
              <option value="">{loadingRuns ? "Loading runs" : "Unsaved new run"}</option>
              {runs.map((run) => (
                <option key={run.runId} value={run.runId}>
                  {`${run.favorite ? "* " : ""}${run.runId}`}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void refreshResults()}
              disabled={!docId || !chapterId || !runId || loadingResults || runningStage !== null}
              className="mt-3 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
            >
              {loadingResults ? "Refreshing" : "Refresh results"}
            </button>
          </section>
        </aside>
        )}

        <main className="order-1 min-h-0 min-w-0 space-y-4 xl:order-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex rounded-lg border border-zinc-200 bg-white p-1 shadow-sm">
              {([
                { key: "pipeline", label: "Pipeline" },
                { key: "timeline", label: "Timeline graph" },
                { key: "qa", label: "Reading QA" },
              ] as const).map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setWorkbenchView(item.key)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                    workbenchView === item.key
                      ? "bg-zinc-900 text-white"
                      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {workbenchView === "timeline" && (
              <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600">
                {(results.scene0?.scene_candidates.length ?? 0).toLocaleString()} scenes /{" "}
                {(results.event1?.event_candidates.length ?? 0).toLocaleString()} events
              </span>
            )}
            {workbenchView === "qa" && (
              <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600">
                {results.idx1
                  ? `${results.idx1.index_stats.text_documents.toLocaleString()} retrieval docs`
                  : "Run IDX.1 first"}
              </span>
            )}
          </div>

          {workbenchView === "pipeline" ? (
            <>
              <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Pipeline</p>
                    <h2 className="mt-1 text-sm font-semibold text-zinc-950">Stage rail</h2>
                  </div>
                  <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600">
                    {completedStageCount}/{PRE_STAGES.length}
                  </span>
                </div>

                <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                  {PRE_STAGES.map((stage, index) => {
                    const active = activeStage === stage.id

                    return (
                      <button
                        key={stage.id}
                        type="button"
                        onClick={() => {
                          setActiveStage(stage.id)
                          setWorkbenchView("pipeline")
                        }}
                        className={`flex min-w-[132px] items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
                          active
                            ? "border-zinc-900 bg-zinc-50 shadow-sm"
                            : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50"
                        }`}
                      >
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold ${
                            active ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600"
                          }`}
                        >
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-mono text-[11px] font-semibold text-zinc-500">{stage.id}</span>
                          <span className="block truncate text-xs font-semibold text-zinc-900">{stage.title}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-zinc-100 pt-3">
                  <div className="min-w-[240px] flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-mono text-xs font-semibold text-zinc-500">{activeStageMeta.id}</p>
                      <h2 className="text-base font-semibold text-zinc-950">{activeStageMeta.title}</h2>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${getStageStateClass(activeStage)}`}>
                        {getStageStateLabel(activeStage)}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-zinc-600">{activeStageMeta.body}</p>
                    {activeStageBlockReason && (
                      <p className="mt-1 text-xs leading-5 text-zinc-500">{activeStageBlockReason}</p>
                    )}
                  </div>

                  {stageUsesModel(activeStage) && (
                    <label className="flex min-w-[260px] flex-1 items-center gap-2 sm:max-w-[380px]">
                      <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-zinc-500">Model</span>
                      <input
                        value={getStageModel(activeStage)}
                        onChange={(event) => setStageModel(activeStage, event.target.value)}
                        disabled={runningStage !== null}
                        className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700 disabled:opacity-60"
                        aria-label={`${activeStage} model`}
                      />
                    </label>
                  )}

                  <button
                    type="button"
                    onClick={() => void handleRunStage(activeStage)}
                    disabled={activeStageBlockReason !== null}
                    className="h-9 shrink-0 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {runningStage === activeStage ? "Running" : `Run ${activeStage}`}
                  </button>
                </div>
              </section>

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <PreStageViews
                preparedChapter={results.pre1}
                contentUnits={results.pre2}
                evidenceArtifacts={{
                  evid1a: results.evid1a,
                  evid1b: results.evid1b,
                  evid1c: results.evid1c,
                  evid1d: results.evid1d,
                }}
                evidenceRefinement={results.evid2}
                evidenceGate={results.evid3}
                evidenceClustering={results.evid4}
                eventGrouping={results.event1}
                sceneGrouping={results.scene0}
                memoryContract={results.mem0}
                sceneCards={results.mem1}
                eventFrames={results.event2}
                groundedGoals={results.goal1}
                causalEdges={results.caus1}
                progressiveMemory={results.mem2}
                retrievalIndex={results.idx1}
                semanticIndex={results.idx2}
                mentionCandidates={results.ent1}
                activeStage={activeStage}
                runningStage={runningStage}
              />
            </>
          ) : workbenchView === "timeline" ? (
            <>
              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <section className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Organized view</p>
                    <h2 className="mt-1 text-lg font-semibold text-zinc-950">Event-scene timeline graph</h2>
                  </div>
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-zinc-600">
                    EVENT.1 + SCENE.0
                  </span>
                </div>
                <div className="mt-4">
                  <V3TimelineGraphView
                    eventGrouping={results.event1}
                    scenes={results.scene0?.scene_candidates ?? []}
                  />
                </div>
              </section>
            </>
          ) : (
            <>
              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}
              <V3ReadingQAView
                key={`${docId}:${chapterId}:${runId}`}
                docId={docId}
                chapterId={chapterId}
                chapterTitle={selectedChapter?.title}
                runId={runId}
                source={V3_SOURCE}
                preparedChapter={results.pre1}
                contentUnits={results.pre2}
                retrievalIndex={results.idx1}
                semanticIndex={results.idx2}
              />
            </>
          )}
        </main>
      </div>
    </div>
  )
}
