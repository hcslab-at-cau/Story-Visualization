"use client"

import { useCallback, useEffect, useState } from "react"
import { getDescendantStages } from "@/config/pipeline-graph"
import { forkRunResults, loadRunResults, stageKey } from "@/lib/firestore"
import { createTimestampRunId } from "@/lib/run-id"
import type {
  ContentType,
  ContentUnits,
  PreparedChapter,
  StageId,
} from "@/types/schema"
import { PIPELINE_STAGES, type StageStatus } from "@/types/ui"

interface Props {
  docId: string
  chapterId: string
  runId: string
  onRunIdChange?: (runId: string) => void
}

type StageMap = Record<string, { status: StageStatus; error?: string }>
type StageResultMap = Partial<Record<StageId, unknown>>
type StageModelMap = Partial<Record<StageId, string>>

function createInitialStageMap(): StageMap {
  return Object.fromEntries(
    PIPELINE_STAGES.map((stage) => [stage.id, { status: "idle" }]),
  )
}

function createInitialStageModels(): StageModelMap {
  return Object.fromEntries(
    PIPELINE_STAGES
      .filter((stage) => stage.usesModel)
      .map((stage) => [
        stage.id,
        stage.defaultModel ?? stage.modelPlaceholder ?? "openai/gpt-4o-mini",
      ]),
  ) as StageModelMap
}

function countBy(items: string[]): string {
  const counts = new Map<string, number>()
  for (const item of items) {
    counts.set(item, (counts.get(item) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([label, count]) => `${label} ${count}`)
    .join(", ")
}

function normalizeRunResults(raw: Record<string, unknown>): StageResultMap {
  const next: StageResultMap = {}
  for (const stage of PIPELINE_STAGES) {
    const key = stageKey(stage.id)
    if (raw[key] !== undefined) {
      next[stage.id] = raw[key]
    }
  }
  return next
}

function buildStageMapFromResults(results: StageResultMap): StageMap {
  const map = createInitialStageMap()
  for (const stage of PIPELINE_STAGES) {
    if (results[stage.id] !== undefined) {
      map[stage.id] = { status: "done" }
    }
  }
  return map
}

function groupLabel(group: "pre" | "ent" | "state" | "scene" | "vis" | "sub" | "final"): string {
  switch (group) {
    case "pre":
      return "PRE"
    case "ent":
      return "ENT"
    case "state":
      return "STATE"
    case "scene":
      return "SCENE"
    case "vis":
      return "VIS Branch"
    case "sub":
      return "SUB Branch"
    case "final":
      return "FINAL"
    default:
      return group
  }
}

function summarizeStage(stageId: StageId, artifact: unknown): string[] {
  if (!artifact || typeof artifact !== "object") return []
  const data = artifact as Record<string, unknown>

  switch (stageId) {
    case "PRE.1":
      return [
        `title: ${String(data.chapter_title ?? "-")}`,
        `paragraphs: ${String(data.paragraph_count ?? 0)}`,
        `chars: ${String(data.char_count ?? 0)}`,
        `source: ${String(data.source_type ?? "-")}`,
      ]
    case "PRE.2": {
      const units = Array.isArray(data.units) ? (data.units as Array<Record<string, unknown>>) : []
      const storyText = units.filter((unit) => unit.is_story_text === true).length
      return [
        `units: ${units.length}`,
        `story text: ${storyText}`,
        `non-story: ${Math.max(0, units.length - storyText)}`,
      ]
    }
    case "ENT.1": {
      const mentions = Array.isArray(data.mentions)
        ? (data.mentions as Array<Record<string, unknown>>)
        : []
      const types = mentions
        .map((mention) => String(mention.mention_type ?? "unknown"))
        .filter(Boolean)
      return [
        `mentions: ${mentions.length}`,
        types.length > 0 ? countBy(types) : "types: -",
      ]
    }
    case "ENT.2": {
      const validated = Array.isArray(data.validated)
        ? (data.validated as Array<Record<string, unknown>>)
        : []
      const accepted = validated.filter((item) => item.valid === true).length
      return [
        `validated: ${validated.length}`,
        `accepted: ${accepted}`,
        `rejected: ${Math.max(0, validated.length - accepted)}`,
      ]
    }
    case "ENT.3": {
      const entities = Array.isArray(data.entities) ? data.entities : []
      const unresolved = Array.isArray(data.unresolved_mentions)
        ? data.unresolved_mentions
        : []
      return [
        `entities: ${entities.length}`,
        `unresolved: ${unresolved.length}`,
        `method: ${String(data.method ?? "-")}`,
      ]
    }
    case "STATE.1":
    case "STATE.2": {
      const frames = Array.isArray(data.frames) ? (data.frames as Array<Record<string, unknown>>) : []
      const narrativeFrames = frames.filter((frame) => frame.is_narrative === true).length
      return [
        `frames: ${frames.length}`,
        narrativeFrames > 0
          ? `narrative frames: ${narrativeFrames}`
          : `method: ${String(data.method ?? "-")}`,
      ]
    }
    case "STATE.3": {
      const scenes = Array.isArray(data.scenes) ? data.scenes : []
      const boundaries = Array.isArray(data.boundaries) ? data.boundaries : []
      return [
        `scenes: ${scenes.length}`,
        `boundaries: ${boundaries.length}`,
      ]
    }
    case "SCENE.1": {
      const packets = Array.isArray(data.packets) ? data.packets : []
      return [`packets: ${packets.length}`]
    }
    case "SCENE.2": {
      const indices = Array.isArray(data.indices) ? data.indices : []
      return [`indices: ${indices.length}`]
    }
    case "SCENE.3": {
      const validated = Array.isArray(data.validated) ? data.validated : []
      return [`validated scenes: ${validated.length}`]
    }
    case "VIS.1":
    case "VIS.2": {
      const packets = Array.isArray(data.packets) ? data.packets : []
      return [`packets: ${packets.length}`]
    }
    case "VIS.3": {
      const items = Array.isArray(data.items) ? data.items : []
      return [`render items: ${items.length}`]
    }
    case "VIS.4": {
      const rendered = Array.isArray(data.results) ? data.results : []
      return [`images: ${rendered.length}`]
    }
    case "SUB.1":
    case "SUB.2":
    case "SUB.3":
    case "SUB.4": {
      const packets = Array.isArray(data.packets) ? data.packets : []
      return [`scene packets: ${packets.length}`]
    }
    case "FINAL.1": {
      const packets = Array.isArray(data.packets)
        ? (data.packets as Array<Record<string, unknown>>)
        : []
      return [
        `reader packets: ${packets.length}`,
        packets[0]?.scene_id ? `first scene: ${String(packets[0].scene_id)}` : "first scene: -",
      ]
    }
    case "FINAL.2": {
      const scenes = Array.isArray(data.scenes)
        ? (data.scenes as Array<Record<string, unknown>>)
        : []
      const characters = scenes.reduce((sum, scene) => {
        const items = Array.isArray(scene.characters) ? scene.characters.length : 0
        return sum + items
      }, 0)
      return [
        `scenes: ${scenes.length}`,
        `characters: ${characters}`,
      ]
    }
    default:
      return []
  }
}

function filterResultsByStages(results: StageResultMap, stageIds: StageId[]): StageResultMap {
  const next: StageResultMap = {}
  for (const stageId of stageIds) {
    if (results[stageId] !== undefined) {
      next[stageId] = results[stageId]
    }
  }
  return next
}

const CONTENT_TYPE_META: Record<ContentType, { label: string; accent: string; pill: string }> = {
  front_matter: {
    label: "Front Matter",
    accent: "border-l-violet-600",
    pill: "bg-violet-50 text-violet-700",
  },
  toc: {
    label: "TOC",
    accent: "border-l-orange-500",
    pill: "bg-orange-50 text-orange-700",
  },
  chapter_heading: {
    label: "Chapter Heading",
    accent: "border-l-blue-600",
    pill: "bg-blue-50 text-blue-700",
  },
  section_heading: {
    label: "Section Heading",
    accent: "border-l-sky-500",
    pill: "bg-sky-50 text-sky-700",
  },
  epigraph: {
    label: "Epigraph",
    accent: "border-l-fuchsia-600",
    pill: "bg-fuchsia-50 text-fuchsia-700",
  },
  narrative: {
    label: "Narrative",
    accent: "border-l-emerald-600",
    pill: "bg-emerald-50 text-emerald-700",
  },
  non_narrative_other: {
    label: "Other Non-Story",
    accent: "border-l-zinc-400",
    pill: "bg-zinc-100 text-zinc-700",
  },
}

function normalizePidKey(value: unknown): string {
  const raw = String(value ?? "").trim()
  return raw.replace(/^P/i, "")
}

function ResultMetaCard({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-2 text-sm font-medium text-zinc-900">{value}</p>
    </div>
  )
}

function Pre1StageView({ artifact }: { artifact: PreparedChapter }) {
  const paragraphs = artifact.raw_chapter.paragraphs ?? []

  return (
    <div className="mt-4 grid min-h-0 flex-1 gap-5 overflow-hidden xl:grid-cols-2">
      <section className="flex min-h-0 min-w-0 flex-col rounded-xl border border-zinc-200 bg-zinc-50 p-5">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Body</p>
            <h4 className="mt-1 text-base font-semibold text-zinc-900">{artifact.chapter_title}</h4>
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-xs text-zinc-500">
            {paragraphs.length} paragraphs
          </span>
        </div>

        <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {paragraphs.length > 0 ? (
            paragraphs.map((paragraph) => (
              <article
                key={paragraph.pid}
                className="rounded-xl border border-zinc-200 bg-white px-4 py-3"
              >
                <p className="font-mono text-[11px] text-zinc-400">P{paragraph.pid}</p>
                <p className="mt-2 text-sm leading-7 text-zinc-700">{paragraph.text}</p>
              </article>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-4 py-6 text-sm text-zinc-500">
              No paragraphs found in this chapter.
            </div>
          )}
        </div>
      </section>

      <aside className="min-h-0 space-y-3 overflow-y-auto pr-1">
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Result</p>
          <h4 className="mt-1 text-base font-semibold text-zinc-900">PRE.1 Metadata</h4>
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            Raw chapter materialization result. This stage exposes chapter-level text and basic
            counts only.
          </p>
        </div>

        <ResultMetaCard label="Source" value={artifact.source_type ?? "-"} />
        <ResultMetaCard label="Paragraph Count" value={String(artifact.paragraph_count)} />
        <ResultMetaCard label="Character Count" value={artifact.char_count.toLocaleString()} />
      </aside>
    </div>
  )
}

function Pre2StageView({
  artifact,
  preparedChapter,
}: {
  artifact: ContentUnits
  preparedChapter?: PreparedChapter
}) {
  const paragraphs = preparedChapter?.raw_chapter.paragraphs ?? []
  const unitMap = new Map(artifact.units.map((unit) => [normalizePidKey(unit.pid), unit]))
  const storyTextCount = artifact.units.filter((unit) => unit.is_story_text).length
  const nonStoryCount = Math.max(0, artifact.units.length - storyTextCount)
  const counts = new Map<ContentType, number>()

  for (const unit of artifact.units) {
    counts.set(unit.content_type, (counts.get(unit.content_type) ?? 0) + 1)
  }

  const orderedTypes = Object.keys(CONTENT_TYPE_META) as ContentType[]

  return (
    <div className="mt-4 grid min-h-0 flex-1 gap-5 overflow-hidden xl:grid-cols-2">
      <section className="flex min-h-0 min-w-0 flex-col rounded-xl border border-zinc-200 bg-zinc-50 p-5">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Body</p>
            <h4 className="mt-1 text-base font-semibold text-zinc-900">
              {preparedChapter?.chapter_title ?? "Chapter Text"}
            </h4>
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-xs text-zinc-500">
            {artifact.units.length} classified units
          </span>
        </div>

        <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {paragraphs.length > 0 ? (
            paragraphs.map((paragraph, index) => {
              const unit =
                unitMap.get(normalizePidKey(paragraph.pid)) ??
                (artifact.units.length === paragraphs.length ? artifact.units[index] : undefined)
              const contentType = unit?.content_type ?? "non_narrative_other"
              const meta = CONTENT_TYPE_META[contentType]

              return (
                <article
                  key={paragraph.pid}
                  className={`rounded-xl border border-zinc-200 border-l-4 bg-white px-4 py-3 ${meta.accent}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-[11px] text-zinc-400">P{paragraph.pid}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.pill}`}>
                      {meta.label}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] ${
                        unit?.is_story_text
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-zinc-100 text-zinc-600"
                      }`}
                    >
                      {unit?.is_story_text ? "Story Text" : "Non-Story"}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-7 text-zinc-700">{paragraph.text}</p>
                </article>
              )
            })
          ) : (
            <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-4 py-6 text-sm text-zinc-500">
              PRE.1 result is required to align classified units with chapter paragraphs.
            </div>
          )}
        </div>
      </section>

      <aside className="min-h-0 space-y-4 overflow-y-auto pr-1">
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Result</p>
          <h4 className="mt-1 text-base font-semibold text-zinc-900">PRE.2 Classification</h4>
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            Paragraph-level content type detection for the selected chapter.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
          <ResultMetaCard label="Total Units" value={String(artifact.units.length)} />
          <ResultMetaCard label="Story Text" value={String(storyTextCount)} />
          <ResultMetaCard label="Non-Story" value={String(nonStoryCount)} />
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Legend</p>
            <span className="text-xs text-zinc-400">{artifact.model ?? "model unknown"}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {orderedTypes
              .filter((type) => (counts.get(type) ?? 0) > 0)
              .map((type) => {
                const meta = CONTENT_TYPE_META[type]
                return (
                  <span
                    key={type}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${meta.pill}`}
                  >
                    {meta.label} {counts.get(type)}
                  </span>
                )
              })}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Unit List</p>
          <div className="mt-3 max-h-[32vh] space-y-2 overflow-y-auto pr-1">
            {artifact.units.map((unit) => {
              const meta = CONTENT_TYPE_META[unit.content_type]
              return (
                <div
                  key={unit.pid}
                  className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="font-mono text-xs text-zinc-500">P{unit.pid}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.pill}`}>
                      {meta.label}
                    </span>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
                      unit.is_story_text
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-zinc-200 text-zinc-600"
                    }`}
                  >
                    {unit.is_story_text ? "story" : "non-story"}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </aside>
    </div>
  )
}

export default function PipelineRunner({ docId, chapterId, runId, onRunIdChange }: Props) {
  const [stages, setStages] = useState<StageMap>(() => createInitialStageMap())
  const [results, setResults] = useState<StageResultMap>({})
  const [running, setRunning] = useState(false)
  const [loadingResults, setLoadingResults] = useState(false)
  const [selectedStageId, setSelectedStageId] = useState<StageId>("PRE.1")
  const [stageModels, setStageModels] = useState<StageModelMap>(() => createInitialStageModels())

  function setStage(id: string, status: StageStatus, error?: string) {
    setStages((prev) => ({ ...prev, [id]: { status, error } }))
  }

  const refreshResults = useCallback(async () => {
    setLoadingResults(true)
    try {
      const raw = await loadRunResults(docId, chapterId, runId)
      const nextResults = normalizeRunResults(raw)
      setResults(nextResults)
      setStages((prev) => {
        const nextStages = buildStageMapFromResults(nextResults)
        for (const stage of PIPELINE_STAGES) {
          if (prev[stage.id]?.status === "running" || prev[stage.id]?.status === "error") {
            nextStages[stage.id] = prev[stage.id]
          }
        }
        return nextStages
      })

      const firstWithResult = PIPELINE_STAGES.find((stage) => nextResults[stage.id] !== undefined)
      setSelectedStageId((prev) =>
        nextResults[prev] !== undefined ? prev : (firstWithResult?.id ?? "PRE.1"),
      )
    } finally {
      setLoadingResults(false)
    }
  }, [chapterId, docId, runId])

  useEffect(() => {
    setStages(createInitialStageMap())
    setResults({})
    setSelectedStageId("PRE.1")
    setStageModels((prev) => ({ ...createInitialStageModels(), ...prev }))
    void refreshResults()
  }, [refreshResults])

  async function prepareRunForStage(
    stageId: StageId,
    currentRunId: string,
    currentResults: StageResultMap,
  ): Promise<{ targetRunId: string; nextResults: StageResultMap }> {
    if (currentResults[stageId] === undefined) {
      return { targetRunId: currentRunId, nextResults: currentResults }
    }

    const invalidated = getDescendantStages(stageId)
    invalidated.add(stageId)

    const preservedStages = PIPELINE_STAGES
      .map((stage) => stage.id)
      .filter((id) => currentResults[id] !== undefined && !invalidated.has(id))

    const nextRunId = createTimestampRunId([
      currentRunId,
      ...PIPELINE_STAGES.map((stage) => {
        const artifact = currentResults[stage.id] as { run_id?: string } | undefined
        return artifact?.run_id ?? ""
      }),
    ])

    await forkRunResults(docId, chapterId, currentRunId, nextRunId, preservedStages)

    const nextResults = filterResultsByStages(currentResults, preservedStages)
    setResults(nextResults)
    setStages(buildStageMapFromResults(nextResults))
    onRunIdChange?.(nextRunId)

    return { targetRunId: nextRunId, nextResults }
  }

  async function runStage(
    apiPath: string,
    stageId: StageId,
    currentRunId: string,
    currentResults: StageResultMap,
  ): Promise<{ ok: boolean; runId: string; results: StageResultMap }> {
    const stage = PIPELINE_STAGES.find((item) => item.id === stageId)
    if (!stage || stage.implemented === false) {
      setStage(stageId, "idle")
      return { ok: true, runId: currentRunId, results: currentResults }
    }

    const { targetRunId, nextResults } = await prepareRunForStage(stageId, currentRunId, currentResults)

    setStage(stageId, "running")
    try {
      const model = stage.usesModel ? stageModels[stageId]?.trim() : undefined
      const res = await fetch(`/api/pipeline/${apiPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docId,
          chapterId,
          runId: targetRunId,
          parents: {},
          model,
        }),
      })
      const data = (await res.json()) as Record<string, unknown> & { error?: string }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)

      const mergedResults = { ...nextResults, [stageId]: data }
      setResults(mergedResults)
      setStages((prev) => ({
        ...prev,
        [stageId]: { status: "done" },
      }))
      setSelectedStageId(stageId)
      return { ok: true, runId: targetRunId, results: mergedResults }
    } catch (error) {
      setStage(stageId, "error", String(error))
      return { ok: false, runId: targetRunId, results: nextResults }
    }
  }

  async function runAll() {
    setRunning(true)
    let activeRunId = runId
    let activeResults = results

    for (const stage of PIPELINE_STAGES) {
      if (stage.implemented === false) continue
      const outcome = await runStage(stage.apiPath, stage.id, activeRunId, activeResults)
      activeRunId = outcome.runId
      activeResults = outcome.results
      if (!outcome.ok) break
    }

    setRunning(false)
  }

  async function runSingle(apiPath: string, stageId: StageId) {
    setRunning(true)
    await runStage(apiPath, stageId, runId, results)
    setRunning(false)
  }

  const statusIcon: Record<StageStatus, string> = {
    idle: "-",
    running: "*",
    done: "v",
    error: "!",
  }

  const statusColor: Record<StageStatus, string> = {
    idle: "text-zinc-400",
    running: "text-blue-500",
    done: "text-green-600",
    error: "text-red-500",
  }

  const selectedStage = PIPELINE_STAGES.find((stage) => stage.id === selectedStageId)
  const selectedResult = results[selectedStageId]
  const selectedSummary = selectedResult ? summarizeStage(selectedStageId, selectedResult) : []
  const selectedModel = stageModels[selectedStageId] ?? ""
  const preparedChapter =
    results["PRE.1"] && typeof results["PRE.1"] === "object"
      ? (results["PRE.1"] as PreparedChapter)
      : undefined
  const selectedPreparedChapter =
    selectedStageId === "PRE.1" && selectedResult && typeof selectedResult === "object"
      ? (selectedResult as PreparedChapter)
      : undefined
  const selectedContentUnits =
    selectedStageId === "PRE.2" && selectedResult && typeof selectedResult === "object"
      ? (selectedResult as ContentUnits)
      : undefined

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={runAll}
          disabled={running}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
        >
          Run All Stages
        </button>
        <button
          onClick={() => void refreshResults()}
          disabled={running || loadingResults}
          className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50"
        >
          Refresh Results
        </button>
        <span className="text-xs text-zinc-400">run: {runId}</span>
        {loadingResults && <span className="text-xs text-zinc-400">loading saved results...</span>}
      </div>

      <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="min-h-0">
          <div className="h-full space-y-1 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-2">
            <div className="px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Stages</p>
            </div>
            {PIPELINE_STAGES.map((stage, stageIndex) => {
              const stageState = stages[stage.id] ?? { status: "idle" }
              const summary = results[stage.id] ? summarizeStage(stage.id, results[stage.id]) : []
              const selected = selectedStageId === stage.id
              const previousStage = stageIndex > 0 ? PIPELINE_STAGES[stageIndex - 1] : undefined
              const showGroupLabel = !previousStage || previousStage.group !== stage.group

              return (
                <div key={stage.id}>
                  {showGroupLabel && (
                    <div className="px-3 pb-1 pt-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                        {groupLabel(stage.group)}
                      </p>
                    </div>
                  )}

                  <div
                    className={`rounded-lg border px-3 py-2 transition-colors ${
                      selected
                        ? "border-zinc-900 bg-zinc-50"
                        : "border-transparent hover:border-zinc-200 hover:bg-zinc-50"
                    } ${stage.implemented === false ? "opacity-70" : ""}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`w-4 font-mono text-sm ${statusColor[stageState.status]}`}>
                        {statusIcon[stageState.status]}
                      </span>
                      <button
                        type="button"
                        onClick={() => setSelectedStageId(stage.id)}
                        className="flex-1 text-left text-sm text-zinc-700"
                      >
                        {stage.label}
                      </button>
                      {stage.implemented === false && (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                          Pending
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => void runSingle(stage.apiPath, stage.id)}
                        disabled={running || stage.implemented === false}
                        className="rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-500 hover:bg-white hover:text-zinc-700 disabled:opacity-40"
                      >
                        Run
                      </button>
                    </div>

                    {summary.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {summary.slice(0, 3).map((item) => (
                          <span
                            key={item}
                            className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-500"
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    )}

                    {stage.usesModel && (
                      <div className="mt-2">
                        <input
                          value={stageModels[stage.id] ?? ""}
                          onChange={(event) =>
                            setStageModels((prev) => ({ ...prev, [stage.id]: event.target.value }))
                          }
                          onClick={(event) => event.stopPropagation()}
                          placeholder={stage.modelPlaceholder ?? "openai/gpt-4o-mini"}
                          className="w-full rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-700"
                        />
                      </div>
                    )}

                    {stage.implemented === false && (
                      <p className="mt-2 text-xs text-zinc-400">
                        Stage slot is added to the project structure, but implementation is not wired
                        yet.
                      </p>
                    )}

                    {stageState.error && (
                      <p className="mt-2 break-words text-xs text-red-500">{stageState.error}</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900">
                {selectedStage?.label ?? selectedStageId}
              </h3>
              <p className="mt-1 text-xs text-zinc-500">
                {selectedResult
                  ? "Saved result for current run."
                  : "No result for this stage in the current run yet."}
              </p>
            </div>
            <span className={`text-xs font-medium ${statusColor[stages[selectedStageId]?.status ?? "idle"]}`}>
              {stages[selectedStageId]?.status ?? "idle"}
            </span>
          </div>

          {selectedStage?.implemented === false && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              VIS branch stage is registered in the project and model config, but its route and logic
              are not implemented yet.
            </div>
          )}

          {selectedSummary.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {selectedSummary.map((item) => (
                <span
                  key={item}
                  className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600"
                >
                  {item}
                </span>
              ))}
            </div>
          )}

          {selectedStage?.usesModel && (
            <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
              <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Stage Model
              </label>
              <input
                value={selectedModel}
                onChange={(event) =>
                  setStageModels((prev) => ({ ...prev, [selectedStage.id]: event.target.value }))
                }
                placeholder={selectedStage.modelPlaceholder ?? "openai/gpt-4o-mini"}
                className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700"
              />
              <p className="mt-2 text-xs text-zinc-500">
                Enter the exact OpenRouter model id, for example `openai/gpt-4o-mini`.
              </p>
            </div>
          )}

          {selectedPreparedChapter && <Pre1StageView artifact={selectedPreparedChapter} />}

          {selectedContentUnits && (
            <Pre2StageView artifact={selectedContentUnits} preparedChapter={preparedChapter} />
          )}

          {!selectedPreparedChapter && !selectedContentUnits && selectedResult !== undefined && (
            <details className="mt-4 min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border border-zinc-200">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-700">
                Raw JSON
              </summary>
              <pre className="h-full overflow-auto border-t border-zinc-200 bg-zinc-950 p-4 text-xs leading-6 text-zinc-100">
                {JSON.stringify(selectedResult, null, 2)}
              </pre>
            </details>
          )}
        </section>
      </div>
    </div>
  )
}
