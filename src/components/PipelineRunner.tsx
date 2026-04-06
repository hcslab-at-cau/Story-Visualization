"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { getDescendantStages } from "@/config/pipeline-graph"
import {
  deleteStageResult,
  forkRunResults,
  loadRunResults,
  saveRunStageModels,
  stageKey,
} from "@/lib/firestore"
import { createTimestampRunId } from "@/lib/run-id"
import type {
  ConfidenceLevel,
  ContentType,
  ContentUnits,
  EntityGraph,
  FilteredMentions,
  GroundedSceneModel,
  GroundingType,
  LLMTrialDebug,
  MentionCandidates,
  MentionType,
  OverlayRefinementResult,
  PreparedChapter,
  RefinedStateFrames,
  RenderPackage,
  SceneBoundaries,
  SceneReaderPackageLog,
  SceneIndexDraft,
  ScenePackets,
  StageBlueprint,
  StateFrames,
  StageId,
  InterventionPackages,
  SubsceneProposals,
  SubsceneStates,
  ValidatedSubscenes,
  ValidationActionType,
  VisualGrounding,
  RenderedImages,
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

function parsePidMarkedText(text: string): Array<{
  pid: number | null
  pidLabel: string | null
  body: string
}> {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^\[(P\d+)\]\s*(.*)$/)
      if (!match) {
        return {
          pid: null,
          pidLabel: null,
          body: line,
        }
      }

      const pidLabel = match[1]
      const pid = Number(pidLabel.slice(1))
      return {
        pid: Number.isFinite(pid) ? pid : null,
        pidLabel,
        body: match[2] ?? "",
      }
    })
}

function getContainedImageRect(params: {
  naturalWidth: number
  naturalHeight: number
  containerWidth: number
  containerHeight: number
}): { left: number; top: number; width: number; height: number } {
  const { naturalWidth, naturalHeight, containerWidth, containerHeight } = params
  if (
    naturalWidth <= 0 ||
    naturalHeight <= 0 ||
    containerWidth <= 0 ||
    containerHeight <= 0
  ) {
    return {
      left: 0,
      top: 0,
      width: containerWidth,
      height: containerHeight,
    }
  }

  const scale = Math.min(containerWidth / naturalWidth, containerHeight / naturalHeight)
  const width = naturalWidth * scale
  const height = naturalHeight * scale
  return {
    left: (containerWidth - width) / 2,
    top: (containerHeight - height) / 2,
    width,
    height,
  }
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

function extractSavedStageModels(raw: Record<string, unknown>): StageModelMap {
  const data = raw.stageModels
  const map: StageModelMap = {}
  for (const stage of PIPELINE_STAGES) {
    if (!stage.usesModel) continue
    const savedValue =
      data && typeof data === "object"
        ? (data as Record<string, unknown>)[stageKey(stage.id)]
        : undefined
    const artifactValue =
      raw[stageKey(stage.id)] &&
      typeof raw[stageKey(stage.id)] === "object"
        ? (raw[stageKey(stage.id)] as Record<string, unknown>).model
        : undefined
    const value = typeof savedValue === "string" && savedValue.trim()
      ? savedValue
      : artifactValue

    if (typeof value === "string" && value.trim()) {
      map[stage.id] = value
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

const MENTION_TYPE_META: Record<MentionType, { label: string; pill: string; mark: string; rail: string }> = {
  cast: {
    label: "cast",
    pill: "bg-blue-50 text-blue-700",
    mark: "bg-blue-100 text-blue-900",
    rail: "border-l-blue-500",
  },
  place: {
    label: "place",
    pill: "bg-emerald-50 text-emerald-700",
    mark: "bg-emerald-100 text-emerald-900",
    rail: "border-l-emerald-500",
  },
  time: {
    label: "time",
    pill: "bg-fuchsia-50 text-fuchsia-700",
    mark: "bg-fuchsia-100 text-fuchsia-900",
    rail: "border-l-fuchsia-500",
  },
}

const UNKNOWN_MENTION_META = {
  label: "unknown",
  pill: "bg-zinc-100 text-zinc-600",
  mark: "bg-zinc-100 text-zinc-700",
  rail: "border-l-zinc-300",
}
const WORD_CHAR_PATTERN = /[\p{L}\p{N}]/u

function normalizeMentionType(value: unknown): MentionType | null {
  const raw = String(value ?? "").trim().toLowerCase()
  if (raw === "cast" || raw === "place" || raw === "time") {
    return raw
  }
  return null
}

function getMentionMeta(value: unknown) {
  const mentionType = normalizeMentionType(value)
  return mentionType ? MENTION_TYPE_META[mentionType] : UNKNOWN_MENTION_META
}

function isWordChar(char: string): boolean {
  return WORD_CHAR_PATTERN.test(char)
}

function hasStandaloneBoundary(text: string, start: number, spanLength: number): boolean {
  const before = start > 0 ? text[start - 1] : ""
  const afterIndex = start + spanLength
  const after = afterIndex < text.length ? text[afterIndex] : ""
  return !isWordChar(before) && !isWordChar(after)
}

function findSpanStart(
  text: string,
  span: string,
  fromIndex: number,
  isOverlapping: (start: number, end: number) => boolean,
): number {
  let start = text.indexOf(span, fromIndex)

  while (start >= 0) {
    const end = start + span.length
    if (hasStandaloneBoundary(text, start, span.length) && !isOverlapping(start, end)) {
      return start
    }
    start = text.indexOf(span, start + 1)
  }

  start = text.indexOf(span, fromIndex)
  while (start >= 0) {
    const end = start + span.length
    if (!isOverlapping(start, end)) {
      return start
    }
    start = text.indexOf(span, start + 1)
  }

  return -1
}

function resolveStoredMentionRange(
  text: string,
  mention: { span?: unknown; start_char?: unknown; end_char?: unknown },
  isOverlapping: (start: number, end: number) => boolean,
): { start: number; end: number } | null {
  const span = String(mention.span ?? "")
  const start =
    typeof mention.start_char === "number" && Number.isInteger(mention.start_char)
      ? mention.start_char
      : null
  const end =
    typeof mention.end_char === "number" && Number.isInteger(mention.end_char)
      ? mention.end_char
      : null

  if (
    !span ||
    start === null ||
    end === null ||
    start < 0 ||
    end <= start ||
    end > text.length
  ) {
    return null
  }

  if (text.slice(start, end) !== span) return null
  if (!hasStandaloneBoundary(text, start, end - start)) return null
  if (isOverlapping(start, end)) return null

  return { start, end }
}

function normalizePidKey(value: unknown): string {
  const raw = String(value ?? "").trim()
  return raw.replace(/^P/i, "")
}

function getContentUnitPidKey(
  unit: ContentUnits["units"][number] | undefined,
  fallbackParagraphPid?: unknown,
): string {
  return normalizePidKey(unit?.pid ?? fallbackParagraphPid)
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

function extractLLMTrials(artifact: unknown): LLMTrialDebug[] {
  if (!artifact || typeof artifact !== "object") return []
  const llmDebug = (artifact as { llm_debug?: { trials?: unknown } }).llm_debug
  return Array.isArray(llmDebug?.trials) ? (llmDebug.trials as LLMTrialDebug[]) : []
}

function formatLLMDebugText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim()
  }
  if (value === null || value === undefined) {
    return ""
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function extractLLMTrialResponse(trial: LLMTrialDebug): string {
  const record = trial as unknown as Record<string, unknown>
  const responseKeys = [
    "raw_response",
    "response",
    "response_text",
    "output_text",
    "assistant_response",
    "completion",
    "result",
  ]

  for (const key of responseKeys) {
    const response = formatLLMDebugText(record[key])
    if (response) {
      return response
    }
  }

  return ""
}

function LLMPromptPanel({ trials }: { trials: LLMTrialDebug[] }) {
  const [activeTrial, setActiveTrial] = useState<LLMTrialDebug | null>(null)

  return (
    <>
      <details className="mt-4 min-h-0 shrink-0 rounded-xl border border-zinc-200 bg-white">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-zinc-800">
        LLM Prompt / Response ({trials.length} trials)
      </summary>
      <div className="max-h-[70vh] overflow-y-auto border-t border-zinc-200 px-4 py-4">
        <div className="space-y-3">
          {trials.map((trial) => {
            const promptText = formatLLMDebugText(trial.prompt)
            const responseText = extractLLMTrialResponse(trial)

            return (
              <details key={trial.trial_id} className="rounded-lg border border-zinc-200 bg-zinc-50">
              <summary className="cursor-pointer px-3 py-2 text-sm text-zinc-700">
                Trial {trial.trial_id}
                {trial.template_name ? ` · ${trial.template_name}` : ""}
                {` · ${trial.mode}`}
                {trial.has_image ? " · image" : ""}
                {` · ${trial.model}`}
              </summary>
                <div className="border-t border-zinc-200 bg-white px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      Prompt
                    </p>
                    <button
                      type="button"
                      onClick={() => setActiveTrial(trial)}
                      className="rounded-md border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 hover:text-zinc-800"
                    >
                      Open Large
                    </button>
                  </div>
                  <pre className="mt-2 max-h-[42vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-zinc-50 p-3 text-xs leading-6 text-zinc-800">
                    {promptText || "No prompt saved."}
                  </pre>
                  <div className="mt-4 border-t border-zinc-200 pt-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      Response
                    </p>
                  </div>
                  <pre className="mt-2 max-h-[42vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-zinc-50 p-3 text-xs leading-6 text-zinc-800">
                    {responseText || "No response saved."}
                  </pre>
                </div>
              </details>
            )
          })}
        </div>
      </div>
      </details>

      {activeTrial && (
        <>
          <button
            type="button"
            aria-label="Close LLM debug overlay"
            onClick={() => setActiveTrial(null)}
            className="fixed inset-0 z-40 bg-zinc-950/45"
          />
          <div className="fixed inset-4 z-50 flex min-h-0 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-5 py-4">
              <div>
                <h4 className="text-sm font-semibold text-zinc-900">
                  Trial {activeTrial.trial_id}
                  {activeTrial.template_name ? ` 쨌 ${activeTrial.template_name}` : ""}
                </h4>
                <p className="mt-1 text-xs text-zinc-500">
                  {activeTrial.mode} 쨌 {activeTrial.model}
                  {activeTrial.has_image ? " 쨌 image" : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveTrial(null)}
                className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 hover:text-zinc-800"
              >
                Close
              </button>
            </div>

            <div className="grid min-h-0 flex-1 gap-4 overflow-hidden p-5 xl:grid-cols-2">
              <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50">
                <div className="border-b border-zinc-200 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Prompt
                  </p>
                </div>
                <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-4 text-xs leading-6 text-zinc-800">
                  {formatLLMDebugText(activeTrial.prompt) || "No prompt saved."}
                </pre>
              </section>

              <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50">
                <div className="border-b border-zinc-200 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Response
                  </p>
                </div>
                <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-4 text-xs leading-6 text-zinc-800">
                  {extractLLMTrialResponse(activeTrial) || "No response saved."}
                </pre>
              </section>
            </div>
          </div>
        </>
      )}
    </>
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
  const unitMap = new Map(
    artifact.units.map((unit, index) => [
      getContentUnitPidKey(unit, paragraphs[index]?.pid),
      unit,
    ]),
  )
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

type MentionFilter = "all" | MentionType
type MentionValidationFilter = "all" | "accepted" | "rejected"
type StateFrameFilter = "all" | "changed"
type StateValidationFilter = "all" | "adjusted" | "place"

const SCENE_ACCENTS = [
  "border-l-sky-400 bg-sky-50/45",
  "border-l-emerald-400 bg-emerald-50/45",
  "border-l-amber-400 bg-amber-50/45",
  "border-l-fuchsia-400 bg-fuchsia-50/45",
]

const STATE_ACTION_META: Record<
  ValidationActionType,
  { label: string; pill: string; text: string; row: string }
> = {
  accepted: {
    label: "accepted",
    pill: "bg-emerald-50 text-emerald-700",
    text: "text-emerald-700",
    row: "bg-emerald-50/70",
  },
  carry_forward: {
    label: "carry_forward",
    pill: "bg-zinc-100 text-zinc-600",
    text: "text-zinc-600",
    row: "bg-zinc-50",
  },
  corrected: {
    label: "corrected",
    pill: "bg-orange-50 text-orange-700",
    text: "text-orange-700",
    row: "bg-orange-50/70",
  },
  rejected: {
    label: "rejected",
    pill: "bg-rose-50 text-rose-700",
    text: "text-rose-700",
    row: "bg-rose-50/70",
  },
}

const GROUNDING_META: Record<GroundingType, { pill: string }> = {
  explicit: { pill: "bg-emerald-600 text-white" },
  strong_inference: { pill: "bg-orange-500 text-white" },
  weak_inference: { pill: "bg-rose-500 text-white" },
}

const CONFIDENCE_META: Record<ConfidenceLevel, { pill: string }> = {
  high: { pill: "bg-blue-600 text-white" },
  medium: { pill: "bg-violet-600 text-white" },
  low: { pill: "bg-zinc-500 text-white" },
}

interface SceneTextSummary {
  scene_id: string
  title: string
  start_pid?: number
  end_pid?: number
  paragraphs: PreparedChapter["raw_chapter"]["paragraphs"]
  places: string[]
  cast: string[]
  accent: string
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readTextField(record: Record<string, unknown> | null, keys: string[]): string | undefined {
  if (!record) return undefined
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.trim()) {
      return value.trim()
    }
  }
  return undefined
}

function readStringListField(record: Record<string, unknown> | null, keys: string[]): string[] {
  if (!record) return []
  for (const key of keys) {
    const value = record[key]
    if (Array.isArray(value)) {
      return value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    }
  }
  return []
}

function readNumberListField(record: Record<string, unknown> | null, keys: string[]): number[] {
  if (!record) return []
  for (const key of keys) {
    const value = record[key]
    if (Array.isArray(value)) {
      return value.filter((item): item is number => typeof item === "number")
    }
  }
  return []
}

function readObjectListField(record: Record<string, unknown> | null, keys: string[]): Record<string, unknown>[] {
  if (!record) return []
  for (const key of keys) {
    const value = record[key]
    if (Array.isArray(value)) {
      return value
        .map((item) => toRecord(item))
        .filter((item): item is Record<string, unknown> => Boolean(item))
    }
  }
  return []
}

function normalizeGroundingType(value: unknown): GroundingType | null {
  return value === "explicit" || value === "strong_inference" || value === "weak_inference"
    ? value
    : null
}

function normalizeConfidence(value: unknown): ConfidenceLevel | null {
  return value === "high" || value === "medium" || value === "low" ? value : null
}

function formatSceneEvidencePids(record: Record<string, unknown> | null): string | null {
  const pids = readNumberListField(record, ["evidence_pids"])
  return pids.length > 0 ? `[${formatPidSummary(pids)}]` : null
}

function buildSceneTextViewData(
  artifact: SceneBoundaries | undefined,
  preparedChapter?: PreparedChapter,
  classifyLog?: ContentUnits,
  validatedStateLog?: RefinedStateFrames,
): {
  prefaceParagraphs: PreparedChapter["raw_chapter"]["paragraphs"]
  sceneSummaries: SceneTextSummary[]
} {
  const paragraphs = preparedChapter?.raw_chapter.paragraphs ?? []
  if (!artifact || paragraphs.length === 0) {
    return { prefaceParagraphs: [], sceneSummaries: [] }
  }

  const classificationMap = new Map(
    classifyLog?.units.map((unit, index) => [getContentUnitPidKey(unit, paragraphs[index]?.pid), unit]) ?? [],
  )
  const validatedFrameMap = new Map(
    validatedStateLog?.frames.map((frame) => [normalizePidKey(frame.pid), frame]) ?? [],
  )
  const narrativeParagraphs = paragraphs.filter((paragraph) => {
    const frame = validatedFrameMap.get(normalizePidKey(paragraph.pid))
    return frame?.is_narrative ?? false
  })
  const firstSceneStart = artifact.scenes[0]?.start_pid
  const prefaceParagraphs = firstSceneStart === undefined
    ? paragraphs.filter((paragraph) => {
        const unit = classificationMap.get(normalizePidKey(paragraph.pid))
        return !(unit?.is_story_text ?? false)
      })
    : paragraphs.filter((paragraph) => paragraph.pid < firstSceneStart)

  const sceneSummaries = artifact.scenes.map((scene, index) => {
    const sceneParagraphs = narrativeParagraphs.filter(
      (paragraph) => paragraph.pid >= scene.start_pid && paragraph.pid <= scene.end_pid,
    )
    const sceneFrames = sceneParagraphs
      .map((paragraph) => validatedFrameMap.get(normalizePidKey(paragraph.pid)))
      .filter((frame): frame is NonNullable<typeof frame> => Boolean(frame))
    const title = artifact.scene_titles[scene.scene_id] || scene.scene_id.replace("_", " ")
    const placeSet = Array.from(
      new Set(
        sceneFrames
          .map((frame) => frame.validated_state.current_place)
          .filter((value): value is string => Boolean(value)),
      ),
    )
    const castSet = Array.from(
      new Set(sceneFrames.flatMap((frame) => frame.validated_state.active_cast)),
    )

    return {
      ...scene,
      title,
      paragraphs: sceneParagraphs,
      places: placeSet,
      cast: castSet,
      accent: SCENE_ACCENTS[index % SCENE_ACCENTS.length],
    }
  })

  return { prefaceParagraphs, sceneSummaries }
}

function formatPidSummary(pids: number[]): string {
  const unique = Array.from(new Set(pids)).sort((a, b) => a - b)
  if (unique.length === 0) return "-"
  const visible = unique.slice(0, 5).map((pid) => `P${pid}`).join(", ")
  return unique.length > 5 ? `${visible} +${unique.length - 5}` : visible
}

function formatSpanSummary(spans: string[]): string {
  const unique = Array.from(new Set(spans.map((span) => span.trim()).filter(Boolean)))
  if (unique.length === 0) return "-"
  const visible = unique.slice(0, 4).map((span) => `"${span}"`).join(" / ")
  return unique.length > 4 ? `${visible} +${unique.length - 4}` : visible
}

function Ent1StageView({
  artifact,
  preparedChapter,
  classifyLog,
}: {
  artifact: MentionCandidates
  preparedChapter?: PreparedChapter
  classifyLog?: ContentUnits
}) {
  const [filter, setFilter] = useState<MentionFilter>("all")
  const [activeMentionKey, setActiveMentionKey] = useState<string | null>(null)
  const paragraphRefs = useRef(new Map<string, HTMLElement | null>())
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    }
  }, [])

  const paragraphs = preparedChapter?.raw_chapter.paragraphs ?? []
  const classificationMap = new Map(
    classifyLog?.units.map((unit, index) => [getContentUnitPidKey(unit, paragraphs[index]?.pid), unit]) ?? [],
  )
  const mentions = artifact.mentions ?? []
  const filteredMentions = filter === "all"
    ? mentions
    : mentions.filter((mention) => normalizeMentionType(mention.mention_type) === filter)
  const counts = {
    cast: mentions.filter((mention) => normalizeMentionType(mention.mention_type) === "cast").length,
    place: mentions.filter((mention) => normalizeMentionType(mention.mention_type) === "place").length,
    time: mentions.filter((mention) => normalizeMentionType(mention.mention_type) === "time").length,
  }

  function jumpToMention(mention: MentionCandidates["mentions"][number], index: number) {
    const key = `${mention.pid}:${mention.span}:${mention.mention_type}:${index}`
    const ref = paragraphRefs.current.get(normalizePidKey(mention.pid))
    ref?.scrollIntoView({ behavior: "smooth", block: "center" })
    setActiveMentionKey(key)
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    flashTimerRef.current = setTimeout(() => setActiveMentionKey(null), 1600)
  }

  function renderParagraphText(
    text: string,
    paragraphMentions: Array<MentionCandidates["mentions"][number] & { renderKey: string }>,
  ) {
    if (paragraphMentions.length === 0) {
      return <p className="mt-2 text-[15px] leading-7 text-zinc-700">{text}</p>
    }

    const intervals: Array<{
      start: number
      end: number
      mention: MentionCandidates["mentions"][number] & { renderKey: string }
    }> = []
    const nextCursorBySpan = new Map<string, number>()

    const isOverlapping = (start: number, end: number) =>
      intervals.some((interval) => start < interval.end && end > interval.start)

    for (const mention of paragraphMentions) {
      const span = String(mention.span ?? "")
      if (!span) continue

      const storedRange = resolveStoredMentionRange(text, mention, isOverlapping)
      if (storedRange) {
        intervals.push({ start: storedRange.start, end: storedRange.end, mention })
        nextCursorBySpan.set(span, storedRange.end)
        continue
      }

      const cursor = nextCursorBySpan.get(span) ?? 0
      let start = findSpanStart(text, span, cursor, isOverlapping)

      if (start < 0) {
        start = findSpanStart(text, span, 0, isOverlapping)
      }

      if (start < 0) continue

      intervals.push({ start, end: start + span.length, mention })
      nextCursorBySpan.set(span, start + span.length)
    }

    if (intervals.length === 0) {
      return <p className="mt-2 text-[15px] leading-7 text-zinc-700">{text}</p>
    }

    intervals.sort((a, b) => a.start - b.start)

    const nodes: React.ReactNode[] = []
    let cursor = 0

    for (const interval of intervals) {
      if (cursor < interval.start) {
        nodes.push(
          <span key={`text:${cursor}:${interval.start}`}>
            {text.slice(cursor, interval.start)}
          </span>,
        )
      }

      const mentionMeta = getMentionMeta(interval.mention.mention_type)
      const isActive = activeMentionKey === interval.mention.renderKey
      nodes.push(
        <mark
          key={interval.mention.renderKey}
          className={`rounded px-0.5 py-0.5 transition-colors ${mentionMeta.mark} ${
            isActive ? "animate-pulse ring-2 ring-amber-300 ring-offset-1" : ""
          }`}
        >
          {text.slice(interval.start, interval.end)}
        </mark>,
      )
      cursor = interval.end
    }

    if (cursor < text.length) {
      nodes.push(<span key={`text:${cursor}:end`}>{text.slice(cursor)}</span>)
    }

    return <p className="mt-2 text-[15px] leading-7 text-zinc-700">{nodes}</p>
  }

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
            {mentions.length} mentions
          </span>
        </div>

        <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {paragraphs.length > 0 ? (
            paragraphs.map((paragraph) => {
              const pidKey = normalizePidKey(paragraph.pid)
              const unit = classificationMap.get(pidKey)
              const paragraphMentions = mentions
                .map((mention, index) => ({
                  ...mention,
                  renderKey: `${mention.pid}:${mention.span}:${mention.mention_type}:${index}`,
                }))
                .filter((mention) => normalizePidKey(mention.pid) === pidKey)

              return (
                <article
                  key={paragraph.pid}
                  ref={(node) => {
                    paragraphRefs.current.set(pidKey, node)
                  }}
                  className="rounded-xl border border-zinc-200 bg-white px-4 py-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-[11px] text-zinc-400">P{paragraph.pid}</p>
                    {unit && (
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${CONTENT_TYPE_META[unit.content_type].pill}`}>
                        {CONTENT_TYPE_META[unit.content_type].label}
                      </span>
                    )}
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] ${
                        unit?.is_story_text
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-zinc-100 text-zinc-500"
                      }`}
                    >
                      {unit?.is_story_text ? "Story Text" : "Non-Story"}
                    </span>
                    {paragraphMentions.length > 0 && (
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600">
                        mentions {paragraphMentions.length}
                      </span>
                    )}
                  </div>

                  {renderParagraphText(paragraph.text, paragraphMentions)}
                </article>
              )
            })
          ) : (
            <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-4 py-6 text-sm text-zinc-500">
              PRE.1 result is required to render paragraph-level mentions.
            </div>
          )}
        </div>
      </section>

      <aside className="min-h-0 space-y-4 overflow-y-auto pr-1">
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Result</p>
              <h4 className="mt-1 text-base font-semibold text-zinc-900">ENT.1 Mention Extraction</h4>
            </div>
            <span className="text-xs text-zinc-400">{artifact.model ?? artifact.method}</span>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-4 xl:grid-cols-1 2xl:grid-cols-4">
            <ResultMetaCard label="Total" value={String(mentions.length)} />
            <ResultMetaCard label="Cast" value={String(counts.cast)} />
            <ResultMetaCard label="Place" value={String(counts.place)} />
            <ResultMetaCard label="Time" value={String(counts.time)} />
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Filter</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(["all", "cast", "place", "time"] as MentionFilter[]).map((value) => {
              const active = filter === value
              const label = value === "all" ? "All" : MENTION_TYPE_META[value].label
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? "border-zinc-900 bg-zinc-900 text-white"
                      : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Mention List</p>
            <span className="text-xs text-zinc-400">{filteredMentions.length} items</span>
          </div>
          <div className="mt-3 space-y-2 overflow-y-auto pr-1">
            {filteredMentions.map((mention, index) => {
              const meta = getMentionMeta(mention.mention_type)
              const itemKey = `${mention.pid}:${mention.span}:${mention.mention_type}:${index}`
              return (
                <button
                  key={itemKey}
                  type="button"
                  onClick={() => jumpToMention(mention, index)}
                  className={`flex w-full items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-left transition-colors hover:bg-white`}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white text-base text-zinc-500">
                    📍
                  </span>
                  <div className={`min-w-0 flex-1 border-l-2 pl-3 ${meta.rail}`}>
                    <p className="text-sm text-zinc-700">
                      <span className="font-mono text-xs text-zinc-500">P{mention.pid}</span>{" "}
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.pill}`}>
                        {meta.label}
                      </span>{" "}
                      <span className="font-medium text-zinc-900">&quot;{mention.span}&quot;</span>
                    </p>
                    {mention.normalized && (
                      <p className="mt-1 text-xs text-zinc-400">{mention.normalized}</p>
                    )}
                  </div>
                </button>
              )
            })}
            {filteredMentions.length === 0 && (
              <div className="rounded-lg border border-dashed border-zinc-300 px-4 py-6 text-sm text-zinc-500">
                No mentions in the current filter.
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  )
}

function Ent2StageView({
  artifact,
  preparedChapter,
  classifyLog,
}: {
  artifact: FilteredMentions
  preparedChapter?: PreparedChapter
  classifyLog?: ContentUnits
}) {
  const [statusFilter, setStatusFilter] = useState<MentionValidationFilter>("all")
  const [typeFilter, setTypeFilter] = useState<MentionFilter>("all")
  const [activeMentionKey, setActiveMentionKey] = useState<string | null>(null)
  const paragraphRefs = useRef(new Map<string, HTMLElement | null>())
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    }
  }, [])

  const paragraphs = preparedChapter?.raw_chapter.paragraphs ?? []
  const classificationMap = new Map(
    classifyLog?.units.map((unit, index) => [getContentUnitPidKey(unit, paragraphs[index]?.pid), unit]) ?? [],
  )
  const validated = artifact.validated.map((mention, index) => ({
    ...mention,
    renderKey: `${mention.pid}:${mention.span}:${mention.mention_type}:${index}`,
    originalIndex: index,
  }))
  const filteredMentions = validated.filter((mention) => {
    const statusMatch =
      statusFilter === "all" ||
      (statusFilter === "accepted" ? mention.valid : !mention.valid)
    const typeMatch = typeFilter === "all" || normalizeMentionType(mention.mention_type) === typeFilter
    return statusMatch && typeMatch
  })

  function jumpToMention(
    mention: FilteredMentions["validated"][number] & { renderKey: string; originalIndex: number },
  ) {
    const ref = paragraphRefs.current.get(normalizePidKey(mention.pid))
    ref?.scrollIntoView({ behavior: "smooth", block: "center" })
    setActiveMentionKey(mention.renderKey)
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    flashTimerRef.current = setTimeout(() => setActiveMentionKey(null), 1600)
  }

  function renderParagraphText(
    text: string,
    paragraphMentions: Array<
      FilteredMentions["validated"][number] & { renderKey: string; originalIndex: number }
    >,
  ) {
    if (paragraphMentions.length === 0) {
      return <p className="mt-2 text-[15px] leading-7 text-zinc-700">{text}</p>
    }

    const intervals: Array<{
      start: number
      end: number
      mention: FilteredMentions["validated"][number] & { renderKey: string; originalIndex: number }
    }> = []
    const nextCursorBySpan = new Map<string, number>()

    const isOverlapping = (start: number, end: number) =>
      intervals.some((interval) => start < interval.end && end > interval.start)

    for (const mention of paragraphMentions) {
      const span = String(mention.span ?? "")
      if (!span) continue

      const storedRange = resolveStoredMentionRange(text, mention, isOverlapping)
      if (storedRange) {
        intervals.push({ start: storedRange.start, end: storedRange.end, mention })
        nextCursorBySpan.set(span, storedRange.end)
        continue
      }

      const cursor = nextCursorBySpan.get(span) ?? 0
      let start = findSpanStart(text, span, cursor, isOverlapping)

      if (start < 0) {
        start = findSpanStart(text, span, 0, isOverlapping)
      }

      if (start < 0) continue

      intervals.push({ start, end: start + span.length, mention })
      nextCursorBySpan.set(span, start + span.length)
    }

    if (intervals.length === 0) {
      return <p className="mt-2 text-[15px] leading-7 text-zinc-700">{text}</p>
    }

    intervals.sort((a, b) => a.start - b.start)

    const nodes: React.ReactNode[] = []
    let cursor = 0

    for (const interval of intervals) {
      if (cursor < interval.start) {
        nodes.push(
          <span key={`text:${cursor}:${interval.start}`}>
            {text.slice(cursor, interval.start)}
          </span>,
        )
      }

      const mentionMeta = getMentionMeta(interval.mention.mention_type)
      const isActive = activeMentionKey === interval.mention.renderKey
      nodes.push(
        <button
          key={interval.mention.renderKey}
          type="button"
          onClick={() => jumpToMention(interval.mention)}
          className={`inline appearance-none rounded px-0.5 py-0 text-left align-baseline leading-[1.35] transition-colors ${
            interval.mention.valid
              ? mentionMeta.mark
              : "bg-zinc-100 text-zinc-500"
          } ${isActive ? "ring-2 ring-amber-300 ring-offset-1" : ""}`}
        >
          {text.slice(interval.start, interval.end)}
        </button>,
      )
      cursor = interval.end
    }

    if (cursor < text.length) {
      nodes.push(<span key={`text:${cursor}:end`}>{text.slice(cursor)}</span>)
    }

    return <p className="mt-2 text-[15px] leading-7 text-zinc-700">{nodes}</p>
  }

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
            {validated.length} validated mentions
          </span>
        </div>

        <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {paragraphs.length > 0 ? (
            paragraphs.map((paragraph) => {
              const pidKey = normalizePidKey(paragraph.pid)
              const unit = classificationMap.get(pidKey)
              const paragraphMentions = validated.filter((mention) => normalizePidKey(mention.pid) === pidKey)
              const acceptedInParagraph = paragraphMentions.filter((mention) => mention.valid).length
              const rejectedInParagraph = Math.max(0, paragraphMentions.length - acceptedInParagraph)

              return (
                <article
                  key={paragraph.pid}
                  ref={(node) => {
                    paragraphRefs.current.set(pidKey, node)
                  }}
                  className={`rounded-xl border border-zinc-200 bg-white px-4 py-3 ${
                    activeMentionKey &&
                    paragraphMentions.some((mention) => mention.renderKey === activeMentionKey)
                      ? "ring-2 ring-amber-300 ring-offset-1 animate-pulse"
                      : ""
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-[11px] text-zinc-400">P{paragraph.pid}</p>
                    {unit && (
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${CONTENT_TYPE_META[unit.content_type].pill}`}>
                        {CONTENT_TYPE_META[unit.content_type].label}
                      </span>
                    )}
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] ${
                        unit?.is_story_text
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-zinc-100 text-zinc-500"
                      }`}
                    >
                      {unit?.is_story_text ? "Story Text" : "Non-Story"}
                    </span>
                    {paragraphMentions.length > 0 && (
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600">
                        mentions {paragraphMentions.length}
                      </span>
                    )}
                    {acceptedInParagraph > 0 && (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                        ok {acceptedInParagraph}
                      </span>
                    )}
                    {rejectedInParagraph > 0 && (
                      <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] text-rose-700">
                        rejected {rejectedInParagraph}
                      </span>
                    )}
                  </div>

                  {renderParagraphText(paragraph.text, paragraphMentions)}
                </article>
              )
            })
          ) : (
            <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-4 py-6 text-sm text-zinc-500">
              PRE.1 result is required to render paragraph-level mentions.
            </div>
          )}
        </div>
      </section>

      <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white">
        <div className="border-b border-zinc-200 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Filter</p>
          </div>

          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Status</p>
            <div className="mt-3 flex flex-wrap gap-4">
              {([
                ["all", "All"],
                ["accepted", "Accepted"],
                ["rejected", "Rejected"],
              ] as Array<[MentionValidationFilter, string]>).map(([value, label]) => (
                <label key={value} className="inline-flex items-center gap-2 text-sm text-zinc-700">
                  <input
                    type="radio"
                    name="mention-status-filter"
                    value={value}
                    checked={statusFilter === value}
                    onChange={() => setStatusFilter(value)}
                    className="h-4 w-4 accent-rose-500"
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div className="mt-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Type</p>
            <div className="mt-3 flex flex-wrap gap-4">
              {(["all", "cast", "place", "time"] as MentionFilter[]).map((value) => (
                <label key={value} className="inline-flex items-center gap-2 text-sm text-zinc-700">
                  <input
                    type="radio"
                    name="mention-type-filter"
                    value={value}
                    checked={typeFilter === value}
                    onChange={() => setTypeFilter(value)}
                    className="h-4 w-4 accent-rose-500"
                  />
                  {value === "all" ? "All" : value}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <div className="space-y-2">
              {filteredMentions.map((mention) => {
              const meta = getMentionMeta(mention.mention_type)
              const isActive = activeMentionKey === mention.renderKey

              return (
                <button
                  key={mention.renderKey}
                  type="button"
                  onClick={() => jumpToMention(mention)}
                  className={`flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors ${
                    mention.valid
                      ? "border-zinc-200 bg-white hover:bg-zinc-50"
                      : "border-rose-200 bg-rose-50/60 hover:bg-rose-50"
                  } ${isActive ? "ring-2 ring-amber-300" : ""}`}
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white">
                    <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
                  </span>

                  <div className={`min-w-0 flex-1 border-l-2 pl-3 ${
                    mention.valid ? meta.rail : "border-l-rose-500"
                  }`}>
                    <p className="text-sm leading-6 text-zinc-700">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        mention.valid
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-rose-100 text-rose-700"
                      }`}>
                        {mention.valid ? "OK" : "X"}
                      </span>{" "}
                      <span className="font-mono text-xs text-zinc-500">P{mention.pid}</span>{" "}
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.pill}`}>
                        {meta.label}
                      </span>{" "}
                      <span className="font-medium text-zinc-900">&quot;{mention.span}&quot;</span>
                    </p>

                    {mention.reason ? (
                      <p className="mt-1 text-xs leading-5 text-rose-600">{mention.reason}</p>
                    ) : mention.normalized ? (
                      <p className="mt-1 text-xs leading-5 text-zinc-400">{mention.normalized}</p>
                    ) : null}
                  </div>
                </button>
              )
            })}

            {filteredMentions.length === 0 && (
              <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-sm text-zinc-500">
                No mentions match the current filters.
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  )
}

function Ent3StageView({
  artifact,
  preparedChapter,
  classifyLog,
}: {
  artifact: EntityGraph
  preparedChapter?: PreparedChapter
  classifyLog?: ContentUnits
}) {
  const [filter, setFilter] = useState<MentionFilter>("all")
  const [activeEntityIds, setActiveEntityIds] = useState<string[]>([])

  const paragraphs = preparedChapter?.raw_chapter.paragraphs ?? []
  const classificationMap = new Map(
    classifyLog?.units.map((unit, index) => [getContentUnitPidKey(unit, paragraphs[index]?.pid), unit]) ?? [],
  )
  const entities = artifact.entities ?? []
  const activeEntityIdSet = new Set(activeEntityIds)
  const filteredEntities = filter === "all"
    ? entities
    : entities.filter((entity) => normalizeMentionType(entity.mention_type) === filter)
  const counts = {
    cast: entities.filter((entity) => normalizeMentionType(entity.mention_type) === "cast").length,
    place: entities.filter((entity) => normalizeMentionType(entity.mention_type) === "place").length,
    time: entities.filter((entity) => normalizeMentionType(entity.mention_type) === "time").length,
  }
  const highlightedMentions = entities.reduce((sum, entity) => {
    return activeEntityIdSet.has(entity.entity_id) ? sum + entity.mentions.length : sum
  }, 0)

  const highlightMap = new Map<
    string,
    Array<
      EntityGraph["entities"][number]["mentions"][number] & {
        entityId: string
        entityName: string
        mentionType: MentionType
        renderKey: string
      }
    >
  >()

  for (const entity of entities) {
    if (!activeEntityIdSet.has(entity.entity_id)) continue

    entity.mentions.forEach((mention, index) => {
      const pidKey = normalizePidKey(mention.pid)
      const items = highlightMap.get(pidKey) ?? []
      items.push({
        ...mention,
        entityId: entity.entity_id,
        entityName: entity.canonical_name,
        mentionType: entity.mention_type,
        renderKey: `${entity.entity_id}:${mention.mention_id}:${mention.pid}:${index}`,
      })
      highlightMap.set(pidKey, items)
    })
  }

  function toggleEntity(entityId: string) {
    setActiveEntityIds((prev) =>
      prev.includes(entityId)
        ? prev.filter((id) => id !== entityId)
        : [...prev, entityId],
    )
  }

  function renderParagraphText(
    text: string,
    paragraphMentions: Array<
      EntityGraph["entities"][number]["mentions"][number] & {
        entityId: string
        entityName: string
        mentionType: MentionType
        renderKey: string
      }
    >,
  ) {
    if (paragraphMentions.length === 0) {
      return <p className="mt-2 text-[15px] leading-7 text-zinc-700">{text}</p>
    }

    const intervals: Array<{
      start: number
      end: number
      mention: EntityGraph["entities"][number]["mentions"][number] & {
        entityId: string
        entityName: string
        mentionType: MentionType
        renderKey: string
      }
    }> = []
    const nextCursorBySpan = new Map<string, number>()

    const isOverlapping = (start: number, end: number) =>
      intervals.some((interval) => start < interval.end && end > interval.start)

    for (const mention of paragraphMentions) {
      const span = String(mention.span ?? "")
      if (!span) continue

      const storedRange = resolveStoredMentionRange(text, mention, isOverlapping)
      if (storedRange) {
        intervals.push({ start: storedRange.start, end: storedRange.end, mention })
        nextCursorBySpan.set(span, storedRange.end)
        continue
      }

      const cursor = nextCursorBySpan.get(span) ?? 0
      let start = findSpanStart(text, span, cursor, isOverlapping)

      if (start < 0) {
        start = findSpanStart(text, span, 0, isOverlapping)
      }

      if (start < 0) continue

      intervals.push({ start, end: start + span.length, mention })
      nextCursorBySpan.set(span, start + span.length)
    }

    if (intervals.length === 0) {
      return <p className="mt-2 text-[15px] leading-7 text-zinc-700">{text}</p>
    }

    intervals.sort((a, b) => a.start - b.start)

    const nodes: React.ReactNode[] = []
    let cursor = 0

    for (const interval of intervals) {
      if (cursor < interval.start) {
        nodes.push(
          <span key={`text:${cursor}:${interval.start}`}>
            {text.slice(cursor, interval.start)}
          </span>,
        )
      }

      const mentionMeta = getMentionMeta(interval.mention.mentionType)
      nodes.push(
        <mark
          key={interval.mention.renderKey}
          className={`rounded px-0.5 py-0.5 transition-colors ${mentionMeta.mark} ring-1 ring-white/80`}
          title={interval.mention.entityName}
        >
          {text.slice(interval.start, interval.end)}
        </mark>,
      )
      cursor = interval.end
    }

    if (cursor < text.length) {
      nodes.push(<span key={`text:${cursor}:end`}>{text.slice(cursor)}</span>)
    }

    return <p className="mt-2 text-[15px] leading-7 text-zinc-700">{nodes}</p>
  }

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
            active {activeEntityIds.length} / {entities.length}
          </span>
        </div>

        <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {paragraphs.length > 0 ? (
            paragraphs.map((paragraph) => {
              const pidKey = normalizePidKey(paragraph.pid)
              const unit = classificationMap.get(pidKey)
              const paragraphMentions = highlightMap.get(pidKey) ?? []

              return (
                <article
                  key={paragraph.pid}
                  className={`rounded-xl border border-zinc-200 bg-white px-4 py-3 ${
                    paragraphMentions.length > 0 ? "ring-1 ring-amber-200" : ""
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-[11px] text-zinc-400">P{paragraph.pid}</p>
                    {unit && (
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${CONTENT_TYPE_META[unit.content_type].pill}`}>
                        {CONTENT_TYPE_META[unit.content_type].label}
                      </span>
                    )}
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] ${
                        unit?.is_story_text
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-zinc-100 text-zinc-500"
                      }`}
                    >
                      {unit?.is_story_text ? "Story Text" : "Non-Story"}
                    </span>
                    {paragraphMentions.length > 0 && (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                        highlighted {paragraphMentions.length}
                      </span>
                    )}
                  </div>

                  {renderParagraphText(paragraph.text, paragraphMentions)}
                </article>
              )
            })
          ) : (
            <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-4 py-6 text-sm text-zinc-500">
              PRE.1 result is required to render entity-level highlights.
            </div>
          )}
        </div>
      </section>

      <aside className="min-h-0 space-y-4 overflow-y-auto pr-1">
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Result</p>
              <h4 className="mt-1 text-base font-semibold text-zinc-900">ENT.3 Entity Resolution</h4>
            </div>
            <span className="text-xs text-zinc-400">{artifact.model ?? artifact.method}</span>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-5 xl:grid-cols-1 2xl:grid-cols-5">
            <ResultMetaCard label="Total" value={String(entities.length)} />
            <ResultMetaCard label="Cast" value={String(counts.cast)} />
            <ResultMetaCard label="Place" value={String(counts.place)} />
            <ResultMetaCard label="Time" value={String(counts.time)} />
            <ResultMetaCard label="Unresolved" value={String(artifact.unresolved_mentions.length)} />
          </div>
          <p className="mt-3 text-sm leading-6 text-zinc-500">
            Turn entities on to highlight every linked mention in the chapter text.
          </p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Filter</p>
            {activeEntityIds.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveEntityIds([])}
                className="text-xs font-medium text-zinc-500 hover:text-zinc-700"
              >
                Clear Active
              </button>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {(["all", "cast", "place", "time"] as MentionFilter[]).map((value) => {
              const active = filter === value
              const label = value === "all" ? "All" : MENTION_TYPE_META[value].label
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? "border-zinc-900 bg-zinc-900 text-white"
                      : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Entity List</p>
            <span className="text-xs text-zinc-400">
              visible {filteredEntities.length} | highlighted {highlightedMentions}
            </span>
          </div>

          <div className="mt-3 space-y-2 overflow-y-auto pr-1">
            {filteredEntities.map((entity) => {
              const meta = getMentionMeta(entity.mention_type)
              const isActive = activeEntityIdSet.has(entity.entity_id)

              return (
                <div
                  key={entity.entity_id}
                  className={`flex items-start gap-3 rounded-xl border px-3 py-3 transition-colors ${
                    isActive
                      ? "border-zinc-900 bg-zinc-50"
                      : "border-zinc-200 bg-white hover:bg-zinc-50"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleEntity(entity.entity_id)}
                    aria-pressed={isActive}
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border text-xs font-semibold transition-colors ${
                      isActive
                        ? "border-zinc-900 bg-zinc-900 text-white"
                        : "border-zinc-200 bg-white text-zinc-500 hover:text-zinc-700"
                    }`}
                  >
                    {isActive ? "ON" : "OFF"}
                  </button>

                  <div className={`min-w-0 flex-1 border-l-2 pl-3 ${meta.rail}`}>
                    <p className="text-sm leading-6 text-zinc-700">
                      <span className="font-medium text-zinc-900">{entity.canonical_name}</span>{" "}
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.pill}`}>
                        {meta.label}
                      </span>{" "}
                      <span className="text-xs text-zinc-400">
                        {entity.mentions.length} mentions
                      </span>
                    </p>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">
                      {formatPidSummary(entity.mentions.map((mention) => mention.pid))}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-zinc-400">
                      {formatSpanSummary(entity.mentions.map((mention) => mention.span))}
                    </p>
                  </div>
                </div>
              )
            })}

            {filteredEntities.length === 0 && (
              <div className="rounded-lg border border-dashed border-zinc-300 px-4 py-6 text-sm text-zinc-500">
                No entities in the current filter.
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  )
}

function State1StageView({
  artifact,
  preparedChapter,
  classifyLog,
  entityGraph,
}: {
  artifact: StateFrames
  preparedChapter?: PreparedChapter
  classifyLog?: ContentUnits
  entityGraph?: EntityGraph
}) {
  const [filter, setFilter] = useState<StateFrameFilter>("all")
  const [activePid, setActivePid] = useState<number | null>(null)
  const paragraphRefs = useRef(new Map<string, HTMLElement | null>())
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    }
  }, [])

  const paragraphs = preparedChapter?.raw_chapter.paragraphs ?? []
  const classificationMap = new Map(
    classifyLog?.units.map((unit, index) => [getContentUnitPidKey(unit, paragraphs[index]?.pid), unit]) ?? [],
  )
  const frameMap = new Map(artifact.frames.map((frame) => [normalizePidKey(frame.pid), frame]))
  const entityNameMap = new Map(entityGraph?.entities.map((entity) => [entity.entity_id, entity.canonical_name]) ?? [])

  function resolveEntityLabel(value: string | undefined): string {
    if (!value) return "-"
    return entityNameMap.get(value) ?? value
  }

  function resolveEntityLabels(values: string[] | undefined): string[] {
    return (values ?? []).map((value) => resolveEntityLabel(value))
  }

  function frameHasChange(frame: StateFrames["frames"][number]): boolean {
    return (
      frame.transitions.cast_enter.length > 0 ||
      frame.transitions.cast_exit_candidates.length > 0 ||
      Boolean(frame.transitions.place_set) ||
      Boolean(frame.transitions.place_shift) ||
      frame.transitions.time_signals.length > 0
    )
  }

  function frameAccent(frame: StateFrames["frames"][number]): string {
    if (frame.transitions.place_shift) return "border-l-rose-500 bg-rose-50/40"
    if (frame.transitions.place_set) return "border-l-amber-500 bg-amber-50/40"
    if (frame.transitions.cast_enter.length > 0 || frame.transitions.cast_exit_candidates.length > 0) {
      return "border-l-blue-500 bg-blue-50/40"
    }
    if (frame.transitions.time_signals.length > 0) return "border-l-fuchsia-500 bg-fuchsia-50/40"
    return "border-l-zinc-300 bg-white"
  }

  function jumpToPid(pid: number) {
    const pidKey = normalizePidKey(pid)
    const ref = paragraphRefs.current.get(pidKey)
    ref?.scrollIntoView({ behavior: "smooth", block: "center" })
    setActivePid(pid)
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    flashTimerRef.current = setTimeout(() => setActivePid(null), 1600)
  }

  const placeSetCount = artifact.frames.filter((frame) => frame.transitions.place_set).length
  const placeShiftCount = artifact.frames.filter((frame) => frame.transitions.place_shift).length
  const castChangeCount = artifact.frames.filter(
    (frame) => frame.transitions.cast_enter.length > 0 || frame.transitions.cast_exit_candidates.length > 0,
  ).length
  const filteredFrames = filter === "all"
    ? artifact.frames
    : artifact.frames.filter((frame) => frameHasChange(frame))

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
            {artifact.frames.length} frames
          </span>
        </div>

        <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {paragraphs.length > 0 ? (
            paragraphs.map((paragraph) => {
              const pidKey = normalizePidKey(paragraph.pid)
              const frame = frameMap.get(pidKey)
              const unit = classificationMap.get(pidKey)
              const activeCast = resolveEntityLabels(frame?.state.active_cast)
              const currentPlace = resolveEntityLabel(frame?.state.primary_place)
              const placeShiftTo = resolveEntityLabel(frame?.transitions.place_shift?.to)
              const placeSet = resolveEntityLabel(frame?.transitions.place_set)
              const isNarrative = unit?.is_story_text ?? false

              return (
                <article
                  key={paragraph.pid}
                  ref={(node) => {
                    paragraphRefs.current.set(pidKey, node)
                  }}
                  className={`rounded-xl border border-zinc-200 border-l-4 px-4 py-3 transition-colors ${
                    frame ? frameAccent(frame) : "border-l-zinc-300 bg-white"
                  } ${activePid === paragraph.pid ? "ring-2 ring-amber-300 ring-offset-1" : ""}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-[11px] text-zinc-400">P{paragraph.pid}</p>
                    {unit && (
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${CONTENT_TYPE_META[unit.content_type].pill}`}>
                        {CONTENT_TYPE_META[unit.content_type].label}
                      </span>
                    )}
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] ${
                        isNarrative
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-zinc-100 text-zinc-500"
                      }`}
                    >
                      {isNarrative ? "Narrative" : "Non-Story"}
                    </span>
                    {frame?.transitions.place_shift && (
                      <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] text-rose-700">
                        place_shift
                      </span>
                    )}
                    {frame?.transitions.place_set && (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                        place_set
                      </span>
                    )}
                    {(frame?.transitions.cast_enter.length ?? 0) > 0 && (
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">
                        cast_enter
                      </span>
                    )}
                  </div>

                  {frame && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                      <span className="rounded-full bg-white px-2 py-0.5">
                        장소 {currentPlace}
                      </span>
                      {activeCast.length > 0 && (
                        <span className="rounded-full bg-white px-2 py-0.5">
                          인물 {activeCast.join(", ")}
                        </span>
                      )}
                    </div>
                  )}

                  <p className={`mt-2 text-[15px] leading-7 ${isNarrative ? "text-zinc-700" : "italic text-zinc-400"}`}>
                    {paragraph.text}
                  </p>

                  {frame && frameHasChange(frame) && (
                    <div className="mt-3 space-y-1 text-xs leading-5 text-zinc-600">
                      {frame.transitions.place_set && (
                        <p className="text-amber-700">place_set: {placeSet}</p>
                      )}
                      {frame.transitions.place_shift && (
                        <p className="text-rose-700">
                          place_shift: {resolveEntityLabel(frame.transitions.place_shift.from)} -&gt; {placeShiftTo}
                        </p>
                      )}
                      {frame.transitions.cast_enter.length > 0 && (
                        <p className="text-blue-700">
                          cast_enter: {resolveEntityLabels(frame.transitions.cast_enter).join(", ")}
                        </p>
                      )}
                      {frame.transitions.cast_exit_candidates.length > 0 && (
                        <p className="text-sky-700">
                          cast_exit?: {resolveEntityLabels(frame.transitions.cast_exit_candidates).join(", ")}
                        </p>
                      )}
                      {frame.transitions.time_signals.length > 0 && (
                        <p className="text-fuchsia-700">
                          time: {frame.transitions.time_signals.join(", ")}
                        </p>
                      )}
                    </div>
                  )}
                </article>
              )
            })
          ) : (
            <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-4 py-6 text-sm text-zinc-500">
              PRE.1 result is required to render paragraph-level state frames.
            </div>
          )}
        </div>
      </section>

      <aside className="min-h-0 space-y-4 overflow-y-auto pr-1">
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Result</p>
              <h4 className="mt-1 text-base font-semibold text-zinc-900">STATE.1 State Tracking</h4>
            </div>
            <span className="text-xs text-zinc-400">{artifact.method}</span>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-4 xl:grid-cols-1 2xl:grid-cols-4">
            <ResultMetaCard label="Frames" value={String(artifact.frames.length)} />
            <ResultMetaCard label="Place Set" value={String(placeSetCount)} />
            <ResultMetaCard label="Place Shift" value={String(placeShiftCount)} />
            <ResultMetaCard label="Cast Change" value={String(castChangeCount)} />
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Legend</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs text-rose-700">place_shift</span>
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs text-amber-700">place_set</span>
            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs text-blue-700">cast change</span>
            <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600">unchanged</span>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Filter</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {([
              ["all", "All"],
              ["changed", "Changed Only"],
            ] as Array<[StateFrameFilter, string]>).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  filter === value
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Frame List</p>
            <span className="text-xs text-zinc-400">{filteredFrames.length} items</span>
          </div>
          <div className="mt-3 space-y-2 overflow-y-auto pr-1">
            {filteredFrames.map((frame) => {
              const activeCast = resolveEntityLabels(frame.state.active_cast)
              const currentPlace = resolveEntityLabel(frame.state.primary_place)
              const hasChange = frameHasChange(frame)

              return (
                <button
                  key={frame.pid}
                  type="button"
                  onClick={() => jumpToPid(frame.pid)}
                  className={`flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors ${
                    activePid === frame.pid
                      ? "border-zinc-900 bg-zinc-50"
                      : "border-zinc-200 bg-white hover:bg-zinc-50"
                  }`}
                >
                  <div className={`min-w-0 flex-1 border-l-2 pl-3 ${
                    frame.transitions.place_shift
                      ? "border-l-rose-500"
                      : frame.transitions.place_set
                        ? "border-l-amber-500"
                        : frame.transitions.cast_enter.length > 0 || frame.transitions.cast_exit_candidates.length > 0
                          ? "border-l-blue-500"
                          : "border-l-zinc-300"
                  }`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm text-zinc-700">
                        <span className="font-mono text-xs text-zinc-500">P{frame.pid}</span>{" "}
                        <span className="font-medium text-zinc-900">
                          {hasChange ? "changed" : "none"}
                        </span>
                      </p>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] ${
                        frame.transitions.place_shift
                          ? "bg-rose-50 text-rose-700"
                          : frame.transitions.place_set
                            ? "bg-amber-50 text-amber-700"
                            : frame.transitions.cast_enter.length > 0 || frame.transitions.cast_exit_candidates.length > 0
                              ? "bg-blue-50 text-blue-700"
                              : "bg-zinc-100 text-zinc-500"
                      }`}>
                        {frame.transitions.place_shift
                          ? "place_shift"
                          : frame.transitions.place_set
                            ? "place_set"
                            : frame.transitions.cast_enter.length > 0 || frame.transitions.cast_exit_candidates.length > 0
                              ? "cast"
                              : "unchanged"}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {activeCast.slice(0, 3).map((name) => (
                        <span key={`${frame.pid}:${name}`} className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">
                          {name}
                        </span>
                      ))}
                      {frame.state.primary_place && (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                          {currentPlace}
                        </span>
                      )}
                    </div>

                    <p className="mt-2 text-xs leading-5 text-zinc-400">
                      관측 인물 {resolveEntityLabels(frame.observed.cast).join(", ") || "-"} | 장소 {resolveEntityLabels(frame.observed.place).join(", ") || "-"}
                    </p>
                  </div>
                </button>
              )
            })}

            {filteredFrames.length === 0 && (
              <div className="rounded-lg border border-dashed border-zinc-300 px-4 py-6 text-sm text-zinc-500">
                No frames in the current filter.
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  )
}

function State2StageView({
  artifact,
  preparedChapter,
  classifyLog,
  stateLog,
}: {
  artifact: RefinedStateFrames
  preparedChapter?: PreparedChapter
  classifyLog?: ContentUnits
  stateLog?: StateFrames
}) {
  const [filter, setFilter] = useState<StateValidationFilter>("all")
  const [activePid, setActivePid] = useState<number | null>(null)
  const paragraphRefs = useRef(new Map<string, HTMLElement | null>())
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    }
  }, [])

  const paragraphs = preparedChapter?.raw_chapter.paragraphs ?? []
  const classificationMap = new Map(
    classifyLog?.units.map((unit, index) => [getContentUnitPidKey(unit, paragraphs[index]?.pid), unit]) ?? [],
  )
  const frameMap = new Map(artifact.frames.map((frame) => [normalizePidKey(frame.pid), frame]))
  const proposedFrameMap = new Map(stateLog?.frames.map((frame) => [normalizePidKey(frame.pid), frame]) ?? [])

  function frameHasAdjustment(frame: RefinedStateFrames["frames"][number]): boolean {
    return frame.actions.some((action) => action.action === "corrected" || action.action === "rejected")
  }

  function frameHasPlaceAction(frame: RefinedStateFrames["frames"][number]): boolean {
    return frame.actions.some(
      (action) =>
        (action.field === "current_place" || action.field === "mentioned_place") &&
        action.action !== "carry_forward",
    )
  }

  function frameAccent(frame: RefinedStateFrames["frames"][number]): string {
    if (frame.actions.some((action) => action.action === "corrected" || action.action === "rejected")) {
      return "border-l-orange-500 bg-orange-50/35"
    }
    if (frame.actions.some((action) => action.field === "current_place" && action.action === "accepted")) {
      return "border-l-emerald-500 bg-emerald-50/35"
    }
    if (frame.actions.some((action) => action.action === "carry_forward")) {
      return "border-l-zinc-300 bg-zinc-50/70"
    }
    return "border-l-zinc-300 bg-white"
  }

  function jumpToPid(pid: number) {
    const pidKey = normalizePidKey(pid)
    const ref = paragraphRefs.current.get(pidKey)
    ref?.scrollIntoView({ behavior: "smooth", block: "center" })
    setActivePid(pid)
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    flashTimerRef.current = setTimeout(() => setActivePid(null), 1600)
  }

  const correctedOrRejectedCount = artifact.frames.reduce(
    (sum, frame) => sum + frame.actions.filter((action) => action.action === "corrected" || action.action === "rejected").length,
    0,
  )
  const acceptedPlaceCount = artifact.frames.reduce(
    (sum, frame) => sum + frame.actions.filter((action) => action.field === "current_place" && action.action === "accepted").length,
    0,
  )
  const carryForwardCount = artifact.frames.reduce(
    (sum, frame) => sum + frame.actions.filter((action) => action.action === "carry_forward").length,
    0,
  )

  const filteredFrames = artifact.frames.filter((frame) => {
    if (filter === "adjusted") return frameHasAdjustment(frame)
    if (filter === "place") return frameHasPlaceAction(frame)
    return true
  })

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
            {artifact.frames.length} frames
          </span>
        </div>

        <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {paragraphs.length > 0 ? (
            paragraphs.map((paragraph) => {
              const pidKey = normalizePidKey(paragraph.pid)
              const frame = frameMap.get(pidKey)
              const proposed = proposedFrameMap.get(pidKey)
              const unit = classificationMap.get(pidKey)
              const isNarrative = frame?.is_narrative ?? unit?.is_story_text ?? false
              const currentPlace = frame?.validated_state.current_place
              const activeCast = frame?.validated_state.active_cast ?? []
              const hasAdjustment = frame ? frameHasAdjustment(frame) : false

              return (
                <article
                  key={paragraph.pid}
                  ref={(node) => {
                    paragraphRefs.current.set(pidKey, node)
                  }}
                  className={`rounded-xl border border-zinc-200 border-l-4 px-4 py-3 transition-colors ${
                    frame ? frameAccent(frame) : "border-l-zinc-300 bg-white"
                  } ${activePid === paragraph.pid ? "ring-2 ring-amber-300 ring-offset-1" : ""}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-[11px] text-zinc-400">P{paragraph.pid}</p>
                    {unit && (
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${CONTENT_TYPE_META[unit.content_type].pill}`}>
                        {CONTENT_TYPE_META[unit.content_type].label}
                      </span>
                    )}
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] ${
                        isNarrative
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-zinc-100 text-zinc-500"
                      }`}
                    >
                      {isNarrative ? "Narrative" : "Non-Story"}
                    </span>
                    {currentPlace && (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                        {currentPlace}
                      </span>
                    )}
                    {activeCast.slice(0, 3).map((name) => (
                      <span key={`${paragraph.pid}:${name}`} className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">
                        {name}
                      </span>
                    ))}
                    {hasAdjustment && (
                      <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[11px] text-orange-700">
                        adjusted
                      </span>
                    )}
                  </div>

                  <p className={`mt-2 text-[15px] leading-7 ${isNarrative ? "text-zinc-700" : "italic text-zinc-400"}`}>
                    {paragraph.text}
                  </p>

                  {frame && (
                    <div className="mt-3 space-y-1 text-xs leading-5 text-zinc-600">
                      <p>
                        final: cast {activeCast.join(", ") || "-"} | place {currentPlace ?? "-"}
                      </p>
                      {proposed && (
                        <p className="text-zinc-400">
                          proposed: cast {proposed.state.active_cast.join(", ") || "-"} | place {proposed.state.primary_place ?? "-"}
                        </p>
                      )}
                    </div>
                  )}
                </article>
              )
            })
          ) : (
            <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-4 py-6 text-sm text-zinc-500">
              PRE.1 result is required to render validated state frames.
            </div>
          )}
        </div>
      </section>

      <aside className="min-h-0 space-y-4 overflow-y-auto pr-1">
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Result</p>
              <h4 className="mt-1 text-base font-semibold text-zinc-900">STATE.2 State Validation</h4>
            </div>
            <span className="text-xs text-zinc-400">{artifact.model ?? artifact.method}</span>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-4 xl:grid-cols-1 2xl:grid-cols-4">
            <ResultMetaCard label="Frames" value={String(artifact.frames.length)} />
            <ResultMetaCard label="Adjusted" value={String(correctedOrRejectedCount)} />
            <ResultMetaCard label="Place Accepted" value={String(acceptedPlaceCount)} />
            <ResultMetaCard label="Carry Forward" value={String(carryForwardCount)} />
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Legend</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full bg-orange-50 px-2.5 py-1 text-xs text-orange-700">corrected / rejected</span>
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700">accepted</span>
            <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600">carry_forward</span>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Filter</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {([
              ["all", "All"],
              ["adjusted", "Adjusted"],
              ["place", "Place Only"],
            ] as Array<[StateValidationFilter, string]>).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  filter === value
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Frame List</p>
            <span className="text-xs text-zinc-400">{filteredFrames.length} items</span>
          </div>
          <div className="mt-3 space-y-2 overflow-y-auto pr-1">
            {filteredFrames.map((frame) => (
              <button
                key={frame.pid}
                type="button"
                onClick={() => jumpToPid(frame.pid)}
                className={`flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors ${
                  activePid === frame.pid
                    ? "border-zinc-900 bg-zinc-50"
                    : "border-zinc-200 bg-white hover:bg-zinc-50"
                }`}
              >
                <div className={`min-w-0 flex-1 border-l-2 pl-3 ${
                  frameHasAdjustment(frame)
                    ? "border-l-orange-500"
                    : frameHasPlaceAction(frame)
                      ? "border-l-emerald-500"
                      : "border-l-zinc-300"
                }`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-zinc-500">P{frame.pid}</span>
                    <span className="text-xs text-zinc-400">
                      {frame.is_narrative ? "[narrative]" : "[non-story]"}
                    </span>
                    <span className="text-xs text-zinc-400">
                      {frame.validated_state.current_place ? frame.validated_state.current_place : "unplaced"}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {frame.validated_state.active_cast.slice(0, 4).map((name) => (
                      <span key={`${frame.pid}:${name}`} className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">
                        {name}
                      </span>
                    ))}
                    {frame.validated_state.current_place && (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                        {frame.validated_state.current_place}
                      </span>
                    )}
                  </div>

                  <div className="mt-3 space-y-1">
                    {frame.actions.length > 0 ? (
                      frame.actions.map((action, index) => {
                        const meta = STATE_ACTION_META[action.action]
                        const finalText = Array.isArray(action.final)
                          ? action.final.join(", ")
                          : String(action.final ?? "-")
                        return (
                          <div
                            key={`${frame.pid}:${action.field}:${index}`}
                            className={`rounded-lg px-2 py-1.5 text-xs leading-5 ${meta.row}`}
                          >
                            <span className={`rounded-full px-2 py-0.5 font-medium ${meta.pill}`}>
                              {meta.label}
                            </span>{" "}
                            <span className="font-medium text-zinc-700">[{action.field}]</span>{" "}
                            <span className={meta.text}>{finalText}</span>{" "}
                            <span className="text-zinc-400">{action.reason}</span>
                          </div>
                        )
                      })
                    ) : (
                      <p className="text-xs text-zinc-400">No validation actions.</p>
                    )}
                  </div>
                </div>
              </button>
            ))}

            {filteredFrames.length === 0 && (
              <div className="rounded-lg border border-dashed border-zinc-300 px-4 py-6 text-sm text-zinc-500">
                No frames in the current filter.
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  )
}

function SceneIndexPills({ item }: { item: Record<string, unknown> | null }) {
  const groundingType = normalizeGroundingType(item?.grounding_type)
  const confidence = normalizeConfidence(item?.confidence)
  const evidence = formatSceneEvidencePids(item)

  if (!groundingType && !confidence && !evidence) return null

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
      {groundingType && (
        <span className={`rounded-full px-2 py-0.5 font-medium ${GROUNDING_META[groundingType].pill}`}>
          {groundingType}
        </span>
      )}
      {confidence && (
        <span className={`rounded-full px-2 py-0.5 font-medium ${CONFIDENCE_META[confidence].pill}`}>
          {confidence}
        </span>
      )}
      {evidence && <span className="text-zinc-400">{evidence}</span>}
    </div>
  )
}

function SceneIndexFieldCard({
  label,
  value,
  detail,
  item,
}: {
  label: string
  value: string
  detail?: string
  item: Record<string, unknown> | null
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-3 text-lg font-semibold text-zinc-900">{value || "-"}</p>
      {detail && <p className="mt-2 text-sm leading-6 text-zinc-500">{detail}</p>}
      <SceneIndexPills item={item} />
    </div>
  )
}

function SceneIndexListItem({
  primary,
  secondary,
  item,
}: {
  primary: string
  secondary?: string
  item: Record<string, unknown> | null
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3">
      <p className="text-sm leading-7 text-zinc-800">
        <span className="font-semibold">{primary}</span>
        {secondary ? <span className="text-zinc-600"> {secondary}</span> : null}
      </p>
      <SceneIndexPills item={item} />
    </div>
  )
}

function SceneIndexSection({
  title,
  count,
  children,
  className = "",
  collapsible = false,
  defaultOpen = false,
}: {
  title: string
  count: number
  children: React.ReactNode
  className?: string
  collapsible?: boolean
  defaultOpen?: boolean
}) {
  if (collapsible) {
    return (
      <details open={defaultOpen} className={`overflow-hidden rounded-xl border border-zinc-200 bg-white ${className}`}>
        <summary className="cursor-pointer list-none border-b border-zinc-200 bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-800">
          <span className="inline-flex items-center gap-2">
            <span className="text-zinc-500">▾</span>
            <span>{title} ({count})</span>
          </span>
        </summary>
        <div className="space-y-3 px-4 py-4">{children}</div>
      </details>
    )
  }

  return (
    <section className={`overflow-hidden rounded-xl border border-zinc-200 bg-white ${className}`}>
      <div className="border-b border-zinc-200 bg-zinc-50 px-4 py-3">
        <p className="text-sm font-medium text-zinc-800">
          {title} ({count})
        </p>
      </div>
      <div className="space-y-3 px-4 py-4">{children}</div>
    </section>
  )
}

const SCENE_INDEX_FIELD_LABELS: Array<{ key: string; label: string }> = [
  { key: "scene_summary", label: "Summary" },
  { key: "scene_place", label: "Place" },
  { key: "scene_time", label: "Time" },
  { key: "onstage_cast", label: "Onstage Cast" },
  { key: "mentioned_offstage_cast", label: "Mentioned Offstage" },
  { key: "main_actions", label: "Main Actions" },
  { key: "goals", label: "Goals" },
  { key: "relations", label: "Relations" },
  { key: "objects", label: "Objects" },
  { key: "environment", label: "Environment" },
]

function stringifySceneDiffValue(value: unknown): string {
  if (typeof value === "string") {
    return value
  }
  if (value === null) {
    return "null"
  }
  if (value === undefined) {
    return "undefined"
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function summarizeSceneIndexItem(field: string, item: unknown): string {
  const record = toRecord(item)
  switch (field) {
    case "onstage_cast":
    case "mentioned_offstage_cast": {
      return readTextField(record, ["name", "label"]) ?? stringifySceneDiffValue(item)
    }
    case "main_actions": {
      const actor = readTextField(record, ["actor"])
      const action = readTextField(record, ["action"]) ?? stringifySceneDiffValue(item)
      return actor ? `${actor} - ${action}` : action
    }
    case "goals": {
      const holder = readTextField(record, ["holder"])
      const content = readTextField(record, ["content"]) ?? stringifySceneDiffValue(item)
      return holder ? `${holder}: ${content}` : content
    }
    case "objects": {
      const name = readTextField(record, ["name", "label"]) ?? stringifySceneDiffValue(item)
      const role = readTextField(record, ["scene_role", "description", "role"])
      return role ? `${name}: ${role}` : name
    }
    case "environment": {
      return readTextField(record, ["label", "name", "description"]) ?? stringifySceneDiffValue(item)
    }
    case "scene_place": {
      const actual = readTextField(record, ["actual_place", "place", "label"])
      const mentioned = readStringListField(record, ["mentioned_places"])
      return actual
        ? mentioned.length > 0
          ? `${actual} | mentioned: ${mentioned.join(", ")}`
          : actual
        : stringifySceneDiffValue(item)
    }
    case "scene_time": {
      const label = readTextField(record, ["label", "normalized"])
      const normalized = readTextField(record, ["normalized"])
      return normalized && normalized !== label ? `${label ?? "-"} | ${normalized}` : (label ?? stringifySceneDiffValue(item))
    }
    default:
      return stringifySceneDiffValue(item)
  }
}

function buildSceneIndexDiffs(
  originalIndex: Record<string, unknown> | null,
  validatedIndex: Record<string, unknown> | null,
): Array<{ key: string; label: string; before: string; after: string }> {
  if (!originalIndex || !validatedIndex) return []

  return SCENE_INDEX_FIELD_LABELS.flatMap(({ key, label }) => {
    const before = originalIndex[key]
    const after = validatedIndex[key]
    if (JSON.stringify(before) === JSON.stringify(after)) {
      return []
    }
    return [{
      key,
      label,
      before: summarizeSceneIndexItem(key, before),
      after: summarizeSceneIndexItem(key, after),
    }]
  })
}

function SceneValidationChangeCard({
  label,
  before,
  after,
}: {
  label: string
  before: string
  after: string
}) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">{label}</p>
      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        <div className="rounded-lg border border-zinc-200 bg-white p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Before</p>
          <pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-6 text-zinc-700">
            {before}
          </pre>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">After</p>
          <pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-6 text-emerald-900">
            {after}
          </pre>
        </div>
      </div>
    </div>
  )
}

function SceneValidationReasonItem({
  title,
  subtitle,
  reason,
}: {
  title: string
  subtitle?: string
  reason?: string
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3">
      <p className="text-sm font-medium text-zinc-900">{title}</p>
      {subtitle && <p className="mt-1 text-xs leading-5 text-zinc-500">{subtitle}</p>}
      {reason && <p className="mt-2 text-sm leading-6 text-zinc-700">{reason}</p>}
    </div>
  )
}

function Scene2StageView({
  artifact,
  preparedChapter,
  classifyLog,
  validatedStateLog,
  sceneBoundaryLog,
}: {
  artifact: SceneIndexDraft
  preparedChapter?: PreparedChapter
  classifyLog?: ContentUnits
  validatedStateLog?: RefinedStateFrames
  sceneBoundaryLog?: SceneBoundaries
}) {
  const [activeSceneId, setActiveSceneId] = useState<string | null>(artifact.indices[0]?.scene_id ?? null)
  const sceneRefs = useRef(new Map<string, HTMLElement | null>())

  const { prefaceParagraphs, sceneSummaries } = buildSceneTextViewData(
    sceneBoundaryLog,
    preparedChapter,
    classifyLog,
    validatedStateLog,
  )
  const fallbackScenes: SceneTextSummary[] = artifact.indices.map((index, sceneIndex) => ({
    scene_id: index.scene_id,
    title: index.scene_id.replace("_", " "),
    paragraphs: [],
    places: [],
    cast: [],
    accent: SCENE_ACCENTS[sceneIndex % SCENE_ACCENTS.length],
  }))
  const displayScenes = sceneSummaries.length > 0 ? sceneSummaries : fallbackScenes
  const resolvedActiveSceneId = artifact.indices.some((item) => item.scene_id === activeSceneId)
    ? activeSceneId
    : (artifact.indices[0]?.scene_id ?? null)
  const activeIndex = artifact.indices.find((item) => item.scene_id === resolvedActiveSceneId) ?? artifact.indices[0]
  const activeScene = displayScenes.find((item) => item.scene_id === activeIndex?.scene_id) ?? displayScenes[0]
  const scenePlace = toRecord(activeIndex?.scene_place)
  const sceneTime = toRecord(activeIndex?.scene_time)
  const actualPlace = readTextField(scenePlace, ["actual_place", "place", "label"]) ?? "-"
  const mentionedPlaces = readStringListField(scenePlace, ["mentioned_places"])
  const timeLabel = readTextField(sceneTime, ["label", "normalized"]) ?? "-"
  const timeDetail = [
    readTextField(sceneTime, ["normalized"]),
    sceneTime?.is_explicit_jump === true ? "explicit jump" : undefined,
  ].filter((value): value is string => Boolean(value)).join(" / ")

  function jumpToScene(sceneId: string) {
    setActiveSceneId(sceneId)
    const ref = sceneRefs.current.get(sceneId)
    ref?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  return (
    <div className="mt-4 grid min-h-0 flex-1 gap-5 overflow-hidden xl:grid-cols-2">
      <section className="flex min-h-0 min-w-0 flex-col rounded-xl border border-zinc-200 bg-zinc-50 p-5">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Body</p>
            <h4 className="mt-1 text-base font-semibold text-zinc-900">
              {preparedChapter?.chapter_title ?? "Scene Text"}
            </h4>
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-xs text-zinc-500">
            {displayScenes.length} scenes
          </span>
        </div>

        <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {prefaceParagraphs.length > 0 && (
            <section className="rounded-xl border border-zinc-200 bg-white/80 px-4 py-3 text-zinc-400">
              <p className="text-xs font-semibold uppercase tracking-wide">Preface / Non-Scene</p>
              <div className="mt-2 space-y-2">
                {prefaceParagraphs.map((paragraph) => (
                  <p key={paragraph.pid} className="text-sm italic leading-7">
                    {paragraph.text}
                  </p>
                ))}
              </div>
            </section>
          )}

          {displayScenes.map((scene) => (
            <article
              key={scene.scene_id}
              ref={(node) => {
                sceneRefs.current.set(scene.scene_id, node)
              }}
              onClick={() => jumpToScene(scene.scene_id)}
              className={`cursor-pointer rounded-xl border border-zinc-200 border-l-4 px-4 py-3 transition-colors ${scene.accent} ${
                resolvedActiveSceneId === scene.scene_id ? "ring-2 ring-amber-300 ring-offset-1" : ""
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white px-2 py-0.5 font-mono text-[11px] text-zinc-500">
                  {scene.scene_id}
                </span>
                {scene.start_pid !== undefined && scene.end_pid !== undefined && (
                  <span className="text-xs text-zinc-400">
                    P{scene.start_pid}-P{scene.end_pid}
                  </span>
                )}
              </div>
              <h5 className="mt-2 text-sm font-semibold text-zinc-900">{scene.title}</h5>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {scene.places.map((place) => (
                  <span key={`${scene.scene_id}:place:${place}`} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                    {place}
                  </span>
                ))}
                {scene.cast.map((name) => (
                  <span key={`${scene.scene_id}:cast:${name}`} className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">
                    {name}
                  </span>
                ))}
              </div>
              {scene.paragraphs.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {scene.paragraphs.map((paragraph) => (
                    <p key={`${scene.scene_id}:${paragraph.pid}`} className="text-[15px] leading-7 text-zinc-700">
                      {paragraph.text}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm leading-7 text-zinc-600">
                  {artifact.indices.find((item) => item.scene_id === scene.scene_id)?.scene_summary ?? "No scene summary."}
                </p>
              )}
            </article>
          ))}
        </div>
      </section>

      <aside className="min-h-0 space-y-4 overflow-y-auto pr-1">
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Result</p>
              <h4 className="mt-1 text-base font-semibold text-zinc-900">SCENE.2 Semantic Index</h4>
            </div>
            <span className="text-xs text-zinc-400">{artifact.method}</span>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
            <ResultMetaCard label="Scenes" value={String(artifact.indices.length)} />
            <ResultMetaCard label="Onstage Cast" value={String(activeIndex?.onstage_cast.length ?? 0)} />
            <ResultMetaCard label="Main Actions" value={String(activeIndex?.main_actions.length ?? 0)} />
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Scene List</p>
          <div className="mt-3 space-y-2">
            {displayScenes.map((scene) => (
              <button
                key={`scene2:list:${scene.scene_id}`}
                type="button"
                onClick={() => jumpToScene(scene.scene_id)}
                className={`flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors ${
                  resolvedActiveSceneId === scene.scene_id
                    ? "border-zinc-900 bg-zinc-50"
                    : "border-zinc-200 bg-white hover:bg-zinc-50"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs text-zinc-500">{scene.scene_id}</p>
                  <p className="mt-1 text-sm font-medium text-zinc-900">{scene.title}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {activeIndex ? (
          <div className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-mono text-[11px] text-zinc-600">
                  {activeIndex.scene_id}
                </span>
                {activeScene?.start_pid !== undefined && activeScene?.end_pid !== undefined && (
                  <span className="text-xs text-zinc-400">
                    P{activeScene.start_pid}-P{activeScene.end_pid}
                  </span>
                )}
              </div>
              <p className="mt-3 text-sm leading-7 text-zinc-700">{activeIndex.scene_summary}</p>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <SceneIndexFieldCard
                label="Place"
                value={actualPlace}
                detail={mentionedPlaces.length > 0 ? `mentioned: ${mentionedPlaces.join(", ")}` : undefined}
                item={scenePlace}
              />
              <SceneIndexFieldCard
                label="Time"
                value={timeLabel}
                detail={timeDetail || undefined}
                item={sceneTime}
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <SceneIndexSection title="Onstage Cast" count={activeIndex.onstage_cast.length} collapsible>
                {activeIndex.onstage_cast.length > 0 ? (
                  activeIndex.onstage_cast.map((item, itemIndex) => (
                    <SceneIndexListItem
                      key={`onstage:${activeIndex.scene_id}:${itemIndex}`}
                      primary={item.name}
                      item={toRecord(item)}
                    />
                  ))
                ) : (
                  <p className="text-sm text-zinc-400">-</p>
                )}
              </SceneIndexSection>

              <SceneIndexSection title="Mentioned Offstage" count={activeIndex.mentioned_offstage_cast.length} collapsible>
                {activeIndex.mentioned_offstage_cast.length > 0 ? (
                  activeIndex.mentioned_offstage_cast.map((item, itemIndex) => (
                    <SceneIndexListItem
                      key={`offstage:${activeIndex.scene_id}:${itemIndex}`}
                      primary={item.name}
                      item={toRecord(item)}
                    />
                  ))
                ) : (
                  <p className="text-sm text-zinc-400">-</p>
                )}
              </SceneIndexSection>
            </div>

            <SceneIndexSection title="Main Actions" count={activeIndex.main_actions.length} collapsible>
              {activeIndex.main_actions.length > 0 ? (
                activeIndex.main_actions.map((item, itemIndex) => (
                  <SceneIndexListItem
                    key={`action:${activeIndex.scene_id}:${itemIndex}`}
                    primary={item.actor ? `${item.actor} -` : item.action}
                    secondary={item.actor ? item.action : undefined}
                    item={toRecord(item)}
                  />
                ))
              ) : (
                <p className="text-sm text-zinc-400">No main actions.</p>
              )}
            </SceneIndexSection>

            <SceneIndexSection title="Goals" count={activeIndex.goals.length} collapsible>
              {activeIndex.goals.length > 0 ? (
                activeIndex.goals.map((item, itemIndex) => (
                  <SceneIndexListItem
                    key={`goal:${activeIndex.scene_id}:${itemIndex}`}
                    primary={item.holder}
                    secondary={`: ${item.content}`}
                    item={toRecord(item)}
                  />
                ))
              ) : (
                <p className="text-sm text-zinc-400">No goals.</p>
              )}
            </SceneIndexSection>

            <div className="grid gap-4 xl:grid-cols-2">
              <SceneIndexSection title="Objects" count={activeIndex.objects.length} collapsible>
                {activeIndex.objects.length > 0 ? (
                  activeIndex.objects.map((item, itemIndex) => {
                    const record = toRecord(item)
                    const primary = readTextField(record, ["name", "label", "object"]) ?? `Object ${itemIndex + 1}`
                    const secondary = readTextField(record, ["scene_role", "description", "role"])
                    return (
                      <SceneIndexListItem
                        key={`object:${activeIndex.scene_id}:${itemIndex}`}
                        primary={primary}
                        secondary={secondary ? `: ${secondary}` : undefined}
                        item={record}
                      />
                    )
                  })
                ) : (
                  <p className="text-sm text-zinc-400">No objects.</p>
                )}
              </SceneIndexSection>

              <SceneIndexSection title="Environment" count={activeIndex.environment.length} collapsible>
                {activeIndex.environment.length > 0 ? (
                  activeIndex.environment.map((item, itemIndex) => {
                    const record = toRecord(item)
                    const primary = readTextField(record, ["label", "name", "description"]) ?? `Environment ${itemIndex + 1}`
                    return (
                      <SceneIndexListItem
                        key={`environment:${activeIndex.scene_id}:${itemIndex}`}
                        primary={primary}
                        item={record}
                      />
                    )
                  })
                ) : (
                  <p className="text-sm text-zinc-400">No environment notes.</p>
                )}
              </SceneIndexSection>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-4 py-6 text-sm text-zinc-500">
            No scene index data found.
          </div>
        )}
      </aside>
    </div>
  )
}

function Scene3StageView({
  artifact,
  sceneIndexLog,
  preparedChapter,
  classifyLog,
  validatedStateLog,
  sceneBoundaryLog,
}: {
  artifact: GroundedSceneModel
  sceneIndexLog?: SceneIndexDraft
  preparedChapter?: PreparedChapter
  classifyLog?: ContentUnits
  validatedStateLog?: RefinedStateFrames
  sceneBoundaryLog?: SceneBoundaries
}) {
  const [activeSceneId, setActiveSceneId] = useState<string | null>(
    sceneIndexLog?.indices[0]?.scene_id ?? artifact.validated[0]?.scene_id ?? null,
  )
  const sceneRefs = useRef(new Map<string, HTMLElement | null>())

  const { prefaceParagraphs, sceneSummaries } = buildSceneTextViewData(
    sceneBoundaryLog,
    preparedChapter,
    classifyLog,
    validatedStateLog,
  )
  const sceneIds = sceneIndexLog?.indices.map((item) => item.scene_id) ?? artifact.validated.map((item) => item.scene_id)
  const fallbackScenes: SceneTextSummary[] = sceneIds.map((sceneId, sceneIndex) => ({
    scene_id: sceneId,
    title: sceneId.replace("_", " "),
    paragraphs: [],
    places: [],
    cast: [],
    accent: SCENE_ACCENTS[sceneIndex % SCENE_ACCENTS.length],
  }))
  const displayScenes = sceneSummaries.length > 0 ? sceneSummaries : fallbackScenes
  const resolvedActiveSceneId = sceneIds.includes(activeSceneId ?? "")
    ? activeSceneId
    : (sceneIds[0] ?? null)
  const activeEntry = artifact.validated.find((item) => item.scene_id === resolvedActiveSceneId) ?? artifact.validated[0]
  const activeOriginalIndex = sceneIndexLog?.indices.find((item) => item.scene_id === activeEntry?.scene_id)
  const activeScene = displayScenes.find((item) => item.scene_id === activeEntry?.scene_id) ?? displayScenes[0]
  const validatedIndex = toRecord(activeEntry?.validated_scene_index)
  const validatedSummary = readTextField(validatedIndex, ["scene_summary"]) ?? "-"
  const validatedPlace = toRecord(validatedIndex?.scene_place)
  const validatedTime = toRecord(validatedIndex?.scene_time)
  const actualPlace = readTextField(validatedPlace, ["actual_place", "place", "label"]) ?? "-"
  const mentionedPlaces = readStringListField(validatedPlace, ["mentioned_places"])
  const timeLabel = readTextField(validatedTime, ["label", "normalized"]) ?? "-"
  const timeDetail = [
    readTextField(validatedTime, ["normalized"]),
    validatedTime?.is_explicit_jump === true ? "explicit jump" : undefined,
  ].filter((value): value is string => Boolean(value)).join(" / ")
  const onstageCast = readObjectListField(validatedIndex, ["onstage_cast"])
  const offstageCast = readObjectListField(validatedIndex, ["mentioned_offstage_cast"])
  const mainActions = readObjectListField(validatedIndex, ["main_actions"])
  const goals = readObjectListField(validatedIndex, ["goals"])
  const objects = readObjectListField(validatedIndex, ["objects"])
  const environment = readObjectListField(validatedIndex, ["environment"])
  const changedFields = buildSceneIndexDiffs(
    toRecord(activeOriginalIndex as unknown),
    validatedIndex,
  )
  const droppedItems = activeEntry?.dropped_items ?? []
  const downgradedItems = activeEntry?.downgraded_items ?? []
  const mergedItems = activeEntry?.merged_items ?? []
  const validationNotes = activeEntry?.validation_notes ?? []
  const totalDropped = artifact.validated.reduce((sum, entry) => sum + entry.dropped_items.length, 0)
  const totalDowngraded = artifact.validated.reduce((sum, entry) => sum + entry.downgraded_items.length, 0)
  const totalNotes = artifact.validated.reduce((sum, entry) => sum + entry.validation_notes.length, 0)

  function jumpToScene(sceneId: string) {
    setActiveSceneId(sceneId)
    const ref = sceneRefs.current.get(sceneId)
    ref?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  return (
    <div className="mt-4 grid min-h-0 flex-1 gap-5 overflow-hidden xl:grid-cols-2">
      <section className="flex min-h-0 min-w-0 flex-col rounded-xl border border-zinc-200 bg-zinc-50 p-5">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Body</p>
            <h4 className="mt-1 text-base font-semibold text-zinc-900">
              {preparedChapter?.chapter_title ?? "Scene Text"}
            </h4>
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-xs text-zinc-500">
            {displayScenes.length} scenes
          </span>
        </div>

        <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {prefaceParagraphs.length > 0 && (
            <section className="rounded-xl border border-zinc-200 bg-white/80 px-4 py-3 text-zinc-400">
              <p className="text-xs font-semibold uppercase tracking-wide">Preface / Non-Scene</p>
              <div className="mt-2 space-y-2">
                {prefaceParagraphs.map((paragraph) => (
                  <p key={paragraph.pid} className="text-sm italic leading-7">
                    {paragraph.text}
                  </p>
                ))}
              </div>
            </section>
          )}

          {displayScenes.map((scene) => (
            <article
              key={scene.scene_id}
              ref={(node) => {
                sceneRefs.current.set(scene.scene_id, node)
              }}
              onClick={() => jumpToScene(scene.scene_id)}
              className={`cursor-pointer rounded-xl border border-zinc-200 border-l-4 px-4 py-3 transition-colors ${scene.accent} ${
                resolvedActiveSceneId === scene.scene_id ? "ring-2 ring-amber-300 ring-offset-1" : ""
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white px-2 py-0.5 font-mono text-[11px] text-zinc-500">
                  {scene.scene_id}
                </span>
                {scene.start_pid !== undefined && scene.end_pid !== undefined && (
                  <span className="text-xs text-zinc-400">
                    P{scene.start_pid}-P{scene.end_pid}
                  </span>
                )}
              </div>
              <h5 className="mt-2 text-sm font-semibold text-zinc-900">{scene.title}</h5>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {scene.places.map((place) => (
                  <span key={`${scene.scene_id}:place:${place}`} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                    {place}
                  </span>
                ))}
                {scene.cast.map((name) => (
                  <span key={`${scene.scene_id}:cast:${name}`} className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">
                    {name}
                  </span>
                ))}
              </div>
              {scene.paragraphs.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {scene.paragraphs.map((paragraph) => (
                    <p key={`${scene.scene_id}:${paragraph.pid}`} className="text-[15px] leading-7 text-zinc-700">
                      {paragraph.text}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm leading-7 text-zinc-600">
                  {readTextField(
                    toRecord(artifact.validated.find((item) => item.scene_id === scene.scene_id)?.validated_scene_index),
                    ["scene_summary"],
                  ) ?? "No scene summary."}
                </p>
              )}
            </article>
          ))}
        </div>
      </section>

      <aside className="min-h-0 space-y-4 overflow-y-auto pr-1">
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Result</p>
              <h4 className="mt-1 text-base font-semibold text-zinc-900">SCENE.3 Validation</h4>
            </div>
            <span className="text-xs text-zinc-400">{artifact.model ?? artifact.method}</span>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-4 xl:grid-cols-1 2xl:grid-cols-4">
            <ResultMetaCard label="Scenes" value={String(artifact.validated.length)} />
            <ResultMetaCard label="Dropped" value={String(totalDropped)} />
            <ResultMetaCard label="Downgraded" value={String(totalDowngraded)} />
            <ResultMetaCard label="Notes" value={String(totalNotes)} />
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Scene List</p>
          <div className="mt-3 space-y-2">
            {displayScenes.map((scene) => {
              const entry = artifact.validated.find((item) => item.scene_id === scene.scene_id)
              return (
                <button
                  key={`scene3:list:${scene.scene_id}`}
                  type="button"
                  onClick={() => jumpToScene(scene.scene_id)}
                  className={`flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors ${
                    resolvedActiveSceneId === scene.scene_id
                      ? "border-zinc-900 bg-zinc-50"
                      : "border-zinc-200 bg-white hover:bg-zinc-50"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs text-zinc-500">{scene.scene_id}</p>
                    <p className="mt-1 text-sm font-medium text-zinc-900">{scene.title}</p>
                    {entry && (
                      <p className="mt-2 text-xs text-zinc-400">
                        dropped {entry.dropped_items.length} / downgraded {entry.downgraded_items.length}
                      </p>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {activeEntry ? (
          <div className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-mono text-[11px] text-zinc-600">
                  {activeEntry.scene_id}
                </span>
                {activeScene?.start_pid !== undefined && activeScene?.end_pid !== undefined && (
                  <span className="text-xs text-zinc-400">
                    P{activeScene.start_pid}-P{activeScene.end_pid}
                  </span>
                )}
              </div>
              <p className="mt-3 text-sm leading-7 text-zinc-700">{validatedSummary}</p>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <SceneIndexFieldCard
                label="Place"
                value={actualPlace}
                detail={mentionedPlaces.length > 0 ? `mentioned: ${mentionedPlaces.join(", ")}` : undefined}
                item={validatedPlace}
              />
              <SceneIndexFieldCard
                label="Time"
                value={timeLabel}
                detail={timeDetail || undefined}
                item={validatedTime}
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <SceneIndexSection title="Onstage Cast" count={onstageCast.length} collapsible>
                {onstageCast.length > 0 ? (
                  onstageCast.map((item, itemIndex) => (
                    <SceneIndexListItem
                      key={`scene3:onstage:${activeEntry.scene_id}:${itemIndex}`}
                      primary={readTextField(item, ["name", "label"]) ?? `Cast ${itemIndex + 1}`}
                      item={item}
                    />
                  ))
                ) : (
                  <p className="text-sm text-zinc-400">-</p>
                )}
              </SceneIndexSection>

              <SceneIndexSection title="Mentioned Offstage" count={offstageCast.length} collapsible>
                {offstageCast.length > 0 ? (
                  offstageCast.map((item, itemIndex) => (
                    <SceneIndexListItem
                      key={`scene3:offstage:${activeEntry.scene_id}:${itemIndex}`}
                      primary={readTextField(item, ["name", "label"]) ?? `Mention ${itemIndex + 1}`}
                      item={item}
                    />
                  ))
                ) : (
                  <p className="text-sm text-zinc-400">-</p>
                )}
              </SceneIndexSection>
            </div>

            <SceneIndexSection title="Main Actions" count={mainActions.length} collapsible>
              {mainActions.length > 0 ? (
                mainActions.map((item, itemIndex) => {
                  const actor = readTextField(item, ["actor"])
                  const action = readTextField(item, ["action"]) ?? `Action ${itemIndex + 1}`
                  return (
                    <SceneIndexListItem
                      key={`scene3:action:${activeEntry.scene_id}:${itemIndex}`}
                      primary={actor ? `${actor} -` : action}
                      secondary={actor ? action : undefined}
                      item={item}
                    />
                  )
                })
              ) : (
                <p className="text-sm text-zinc-400">No main actions.</p>
              )}
            </SceneIndexSection>

            <SceneIndexSection title="Goals" count={goals.length} collapsible>
              {goals.length > 0 ? (
                goals.map((item, itemIndex) => (
                  <SceneIndexListItem
                    key={`scene3:goal:${activeEntry.scene_id}:${itemIndex}`}
                    primary={readTextField(item, ["holder"]) ?? `Goal ${itemIndex + 1}`}
                    secondary={`: ${readTextField(item, ["content"]) ?? "-"}`}
                    item={item}
                  />
                ))
              ) : (
                <p className="text-sm text-zinc-400">No goals.</p>
              )}
            </SceneIndexSection>

            <div className="grid gap-4 xl:grid-cols-2">
              <SceneIndexSection title="Objects" count={objects.length} collapsible>
                {objects.length > 0 ? (
                  objects.map((item, itemIndex) => (
                    <SceneIndexListItem
                      key={`scene3:object:${activeEntry.scene_id}:${itemIndex}`}
                      primary={readTextField(item, ["name", "label", "object"]) ?? `Object ${itemIndex + 1}`}
                      secondary={(() => {
                        const detail = readTextField(item, ["scene_role", "description", "role"])
                        return detail ? `: ${detail}` : undefined
                      })()}
                      item={item}
                    />
                  ))
                ) : (
                  <p className="text-sm text-zinc-400">No objects.</p>
                )}
              </SceneIndexSection>

              <SceneIndexSection title="Environment" count={environment.length} collapsible>
                {environment.length > 0 ? (
                  environment.map((item, itemIndex) => (
                    <SceneIndexListItem
                      key={`scene3:environment:${activeEntry.scene_id}:${itemIndex}`}
                      primary={readTextField(item, ["label", "name", "description"]) ?? `Environment ${itemIndex + 1}`}
                      item={item}
                    />
                  ))
                ) : (
                  <p className="text-sm text-zinc-400">No environment notes.</p>
                )}
              </SceneIndexSection>
            </div>

            <SceneIndexSection title="Changed Fields" count={changedFields.length}>
              {changedFields.length > 0 ? (
                changedFields.map((change) => (
                  <SceneValidationChangeCard
                    key={`scene3:diff:${activeEntry.scene_id}:${change.key}`}
                    label={change.label}
                    before={change.before}
                    after={change.after}
                  />
                ))
              ) : (
                <p className="text-sm text-zinc-400">No field-level changes from SCENE.2.</p>
              )}
            </SceneIndexSection>

            <div className="grid gap-4 xl:grid-cols-2">
              <SceneIndexSection title="Dropped" count={droppedItems.length}>
                {droppedItems.length > 0 ? (
                  droppedItems.map((item, itemIndex) => (
                    <SceneValidationReasonItem
                      key={`scene3:dropped:${activeEntry.scene_id}:${itemIndex}`}
                      title={summarizeSceneIndexItem(item.field, item.item)}
                      subtitle={`field: ${item.field}`}
                      reason={item.reason}
                    />
                  ))
                ) : (
                  <p className="text-sm text-zinc-400">No dropped items.</p>
                )}
              </SceneIndexSection>

              <SceneIndexSection title="Downgraded" count={downgradedItems.length}>
                {downgradedItems.length > 0 ? (
                  downgradedItems.map((item, itemIndex) => (
                    <SceneValidationReasonItem
                      key={`scene3:downgraded:${activeEntry.scene_id}:${itemIndex}`}
                      title={summarizeSceneIndexItem(item.field, item.item)}
                      subtitle={`field: ${item.field} | ${item.from_label} -> ${item.to_label}`}
                      reason={item.reason}
                    />
                  ))
                ) : (
                  <p className="text-sm text-zinc-400">No downgraded items.</p>
                )}
              </SceneIndexSection>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <SceneIndexSection title="Merged" count={mergedItems.length}>
                {mergedItems.length > 0 ? (
                  mergedItems.map((item, itemIndex) => (
                    <SceneValidationReasonItem
                      key={`scene3:merged:${activeEntry.scene_id}:${itemIndex}`}
                      title={summarizeSceneIndexItem("merged_items", item)}
                    />
                  ))
                ) : (
                  <p className="text-sm text-zinc-400">No merged items.</p>
                )}
              </SceneIndexSection>

              <SceneIndexSection title="Validation Notes" count={validationNotes.length}>
                {validationNotes.length > 0 ? (
                  validationNotes.map((note, noteIndex) => (
                    <SceneValidationReasonItem
                      key={`scene3:note:${activeEntry.scene_id}:${noteIndex}`}
                      title={`Note ${noteIndex + 1}`}
                      reason={note}
                    />
                  ))
                ) : (
                  <p className="text-sm text-zinc-400">No validation notes.</p>
                )}
              </SceneIndexSection>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-4 py-6 text-sm text-zinc-500">
            No scene validation data found.
          </div>
        )}
      </aside>
    </div>
  )
}

function State3StageView({
  artifact,
  preparedChapter,
  classifyLog,
  validatedStateLog,
}: {
  artifact: SceneBoundaries
  preparedChapter?: PreparedChapter
  classifyLog?: ContentUnits
  validatedStateLog?: RefinedStateFrames
}) {
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null)
  const sceneRefs = useRef(new Map<string, HTMLElement | null>())
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    }
  }, [])

  const paragraphs = preparedChapter?.raw_chapter.paragraphs ?? []
  const classificationMap = new Map(
    classifyLog?.units.map((unit, index) => [getContentUnitPidKey(unit, paragraphs[index]?.pid), unit]) ?? [],
  )
  const validatedFrameMap = new Map(
    validatedStateLog?.frames.map((frame) => [normalizePidKey(frame.pid), frame]) ?? [],
  )
  const narrativeParagraphs = paragraphs.filter((paragraph) => {
    const frame = validatedFrameMap.get(normalizePidKey(paragraph.pid))
    return frame?.is_narrative ?? false
  })
  const firstSceneStart = artifact.scenes[0]?.start_pid
  const prefaceParagraphs = firstSceneStart === undefined
    ? paragraphs.filter((paragraph) => {
        const unit = classificationMap.get(normalizePidKey(paragraph.pid))
        return !(unit?.is_story_text ?? false)
      })
    : paragraphs.filter((paragraph) => paragraph.pid < firstSceneStart)
  const sceneSummaries = artifact.scenes.map((scene, index) => {
    const sceneParagraphs = narrativeParagraphs.filter(
      (paragraph) => paragraph.pid >= scene.start_pid && paragraph.pid <= scene.end_pid,
    )
    const sceneFrames = sceneParagraphs
      .map((paragraph) => validatedFrameMap.get(normalizePidKey(paragraph.pid)))
      .filter((frame): frame is NonNullable<typeof frame> => Boolean(frame))
    const title = artifact.scene_titles[scene.scene_id] || scene.scene_id.replace("_", " ")
    const placeSet = Array.from(
      new Set(
        sceneFrames
          .map((frame) => frame.validated_state.current_place)
          .filter((value): value is string => Boolean(value)),
      ),
    )
    const castSet = Array.from(
      new Set(sceneFrames.flatMap((frame) => frame.validated_state.active_cast)),
    )
    return {
      ...scene,
      title,
      paragraphs: sceneParagraphs,
      places: placeSet,
      cast: castSet,
      accent: SCENE_ACCENTS[index % SCENE_ACCENTS.length],
    }
  })
  const boundaryMap = new Map(artifact.boundaries.map((boundary) => [boundary.boundary_before_pid, boundary]))
  const sceneBoundaryCount = artifact.boundaries.filter((boundary) => boundary.label === "scene_boundary").length
  const weakBoundaryCount = artifact.boundaries.filter((boundary) => boundary.label === "weak_boundary_candidate").length

  function jumpToScene(sceneId: string) {
    const ref = sceneRefs.current.get(sceneId)
    ref?.scrollIntoView({ behavior: "smooth", block: "start" })
    setActiveSceneId(sceneId)
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    flashTimerRef.current = setTimeout(() => setActiveSceneId(null), 1600)
  }

  function formatBoundaryReason(
    reason: SceneBoundaries["boundaries"][number]["reasons"][number],
  ): string {
    switch (reason.type) {
      case "place_shift":
        return `place_shift ${reason.from_place ?? "-"} -> ${reason.to_place ?? "-"}`
      case "place_set_after_previous_place":
        return `place_set ${reason.to_place ?? "-"}`
      case "cast_turnover":
        return `cast_turnover (delta=${reason.delta ?? 0}, n=${reason.turnover ?? 0})`
      case "time_signal":
        return `time_signal ${reason.signals?.join(", ") ?? "-"}`
      default:
        return reason.type
    }
  }

  return (
    <div className="mt-4 grid min-h-0 flex-1 gap-5 overflow-hidden xl:grid-cols-2">
      <section className="flex min-h-0 min-w-0 flex-col rounded-xl border border-zinc-200 bg-zinc-50 p-5">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Body</p>
            <h4 className="mt-1 text-base font-semibold text-zinc-900">
              {preparedChapter?.chapter_title ?? "Scene Text"}
            </h4>
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-xs text-zinc-500">
            {sceneSummaries.length} scenes
          </span>
        </div>

        <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {prefaceParagraphs.length > 0 && (
            <section className="rounded-xl border border-zinc-200 bg-white/80 px-4 py-3 text-zinc-400">
              <p className="text-xs font-semibold uppercase tracking-wide">Preface / Non-Scene</p>
              <div className="mt-2 space-y-2">
                {prefaceParagraphs.map((paragraph) => (
                  <p key={paragraph.pid} className="text-sm italic leading-7">
                    {paragraph.text}
                  </p>
                ))}
              </div>
            </section>
          )}

          {sceneSummaries.map((scene) => (
            <article
              key={scene.scene_id}
              ref={(node) => {
                sceneRefs.current.set(scene.scene_id, node)
              }}
              className={`rounded-xl border border-zinc-200 border-l-4 px-4 py-3 transition-colors ${scene.accent} ${
                activeSceneId === scene.scene_id ? "ring-2 ring-amber-300 ring-offset-1" : ""
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white px-2 py-0.5 font-mono text-[11px] text-zinc-500">
                  {scene.scene_id}
                </span>
                <span className="text-xs text-zinc-400">
                  P{scene.start_pid}-P{scene.end_pid}
                </span>
              </div>
              <h5 className="mt-2 text-sm font-semibold text-zinc-900">{scene.title}</h5>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {scene.places.map((place) => (
                  <span key={`${scene.scene_id}:place:${place}`} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                    {place}
                  </span>
                ))}
                {scene.cast.map((name) => (
                  <span key={`${scene.scene_id}:cast:${name}`} className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">
                    {name}
                  </span>
                ))}
              </div>
              <div className="mt-3 space-y-2">
                {scene.paragraphs.map((paragraph) => (
                  <p key={`${scene.scene_id}:${paragraph.pid}`} className="text-[15px] leading-7 text-zinc-700">
                    {paragraph.text}
                  </p>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <aside className="min-h-0 space-y-4 overflow-y-auto pr-1">
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Result</p>
              <h4 className="mt-1 text-base font-semibold text-zinc-900">STATE.3 Boundary Detection</h4>
            </div>
            <span className="text-xs text-zinc-400">{artifact.method}</span>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
            <ResultMetaCard label="Scenes" value={String(sceneSummaries.length)} />
            <ResultMetaCard label="Scene Boundaries" value={String(sceneBoundaryCount)} />
            <ResultMetaCard label="Weak Boundaries" value={String(weakBoundaryCount)} />
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Scene List</p>
          <div className="mt-3 space-y-3 overflow-y-auto pr-1">
            {sceneSummaries.map((scene, index) => {
              const nextScene = sceneSummaries[index + 1]
              const trailingBoundary = nextScene
                ? boundaryMap.get(nextScene.start_pid)
                : undefined
              return (
                <div key={`list:${scene.scene_id}`} className="space-y-2">
                  <button
                    type="button"
                    onClick={() => jumpToScene(scene.scene_id)}
                    className={`flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors ${
                      activeSceneId === scene.scene_id
                        ? "border-zinc-900 bg-zinc-50"
                        : "border-zinc-200 bg-white hover:bg-zinc-50"
                    }`}
                  >
                    <div className={`min-w-0 flex-1 border-l-2 pl-3 ${
                      scene.accent.includes("border-l-") ? scene.accent.match(/border-l-[^\s]+/)?.[0] ?? "border-l-sky-400" : "border-l-sky-400"
                    }`}>
                      <p className="text-sm text-zinc-700">
                        <span className="font-mono text-xs text-zinc-500">{scene.scene_id}</span>{" "}
                        <span className="font-medium text-zinc-900">P{scene.start_pid}-P{scene.end_pid}</span>
                      </p>
                      <p className="mt-1 text-sm text-zinc-700">{scene.title}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {scene.places.map((place) => (
                          <span key={`${scene.scene_id}:list:place:${place}`} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                            {place}
                          </span>
                        ))}
                        {scene.cast.map((name) => (
                          <span key={`${scene.scene_id}:list:cast:${name}`} className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">
                            {name}
                          </span>
                        ))}
                      </div>
                    </div>
                  </button>

                  {trailingBoundary && (
                    <div className="rounded-lg border border-dashed border-rose-300 bg-rose-50/40 px-3 py-2 text-xs leading-5 text-rose-700">
                      <p className="font-medium">
                        {trailingBoundary.label} score={trailingBoundary.score}
                      </p>
                      {trailingBoundary.reasons.map((reason, index) => (
                        <p key={`${scene.scene_id}:boundary:${index}`} className="mt-1">
                          {formatBoundaryReason(reason)}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}

            {sceneSummaries.length === 0 && (
              <div className="rounded-lg border border-dashed border-zinc-300 px-4 py-6 text-sm text-zinc-500">
                No scenes found.
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  )
}

function Scene1StageView({
  artifact,
  preparedChapter,
  classifyLog,
}: {
  artifact: ScenePackets
  preparedChapter?: PreparedChapter
  classifyLog?: ContentUnits
}) {
  const [activeSceneId, setActiveSceneId] = useState<string | null>(artifact.packets[0]?.scene_id ?? null)
  const [flashSceneId, setFlashSceneId] = useState<string | null>(null)
  const sceneRefs = useRef(new Map<string, HTMLElement | null>())
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    }
  }, [])

  const paragraphs = preparedChapter?.raw_chapter.paragraphs ?? []
  const classificationMap = new Map(
    classifyLog?.units.map((unit, index) => [getContentUnitPidKey(unit, paragraphs[index]?.pid), unit]) ?? [],
  )
  const firstSceneStart = artifact.packets[0]?.start_pid
  const prefaceParagraphs = firstSceneStart === undefined
    ? paragraphs.filter((paragraph) => {
        const unit = classificationMap.get(normalizePidKey(paragraph.pid))
        return !(unit?.is_story_text ?? false)
      })
    : paragraphs.filter((paragraph) => paragraph.pid < firstSceneStart)
  const packetSummaries = artifact.packets.map((packet, index) => {
    const pidSet = new Set(packet.pids)
    return {
      ...packet,
      paragraphs: paragraphs.filter((paragraph) => pidSet.has(paragraph.pid)),
      accent: SCENE_ACCENTS[index % SCENE_ACCENTS.length],
    }
  })
  const selectedPacket = packetSummaries.find((packet) => packet.scene_id === activeSceneId) ?? packetSummaries[0]

  function jumpToScene(sceneId: string) {
    const ref = sceneRefs.current.get(sceneId)
    ref?.scrollIntoView({ behavior: "smooth", block: "start" })
    setActiveSceneId(sceneId)
    setFlashSceneId(sceneId)
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    flashTimerRef.current = setTimeout(() => setFlashSceneId((current) => (current === sceneId ? null : current)), 1600)
  }

  function readStateValue(state: Record<string, unknown>, key: "current_place" | "mentioned_place"): string | undefined {
    const value = state[key]
    return typeof value === "string" && value.trim() ? value : undefined
  }

  function readCastValue(state: Record<string, unknown>): string[] {
    const value = state.active_cast
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : []
  }

  return (
    <div className="mt-4 grid min-h-0 flex-1 gap-5 overflow-hidden xl:grid-cols-2">
      <section className="flex min-h-0 min-w-0 flex-col rounded-xl border border-zinc-200 bg-zinc-50 p-5">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Body</p>
            <h4 className="mt-1 text-base font-semibold text-zinc-900">
              {preparedChapter?.chapter_title ?? "Scene Text"}
            </h4>
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-xs text-zinc-500">
            {packetSummaries.length} scenes
          </span>
        </div>

        <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {prefaceParagraphs.length > 0 && (
            <section className="rounded-xl border border-zinc-200 bg-white/80 px-4 py-3 text-zinc-400">
              <p className="text-xs font-semibold uppercase tracking-wide">Preface / Non-Scene</p>
              <div className="mt-2 space-y-2">
                {prefaceParagraphs.map((paragraph) => (
                  <p key={paragraph.pid} className="text-sm italic leading-7">
                    {paragraph.text}
                  </p>
                ))}
              </div>
            </section>
          )}

          {packetSummaries.map((packet) => (
            <article
              key={packet.scene_id}
              ref={(node) => {
                sceneRefs.current.set(packet.scene_id, node)
              }}
              onClick={() => setActiveSceneId(packet.scene_id)}
              className={`cursor-pointer rounded-xl border border-zinc-200 border-l-4 px-4 py-3 transition-colors ${packet.accent} ${
                activeSceneId === packet.scene_id || flashSceneId === packet.scene_id
                  ? "ring-2 ring-amber-300 ring-offset-1"
                  : ""
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white px-2 py-0.5 font-mono text-[11px] text-zinc-500">
                  {packet.scene_id}
                </span>
                <span className="text-xs text-zinc-400">
                  P{packet.start_pid}-P{packet.end_pid}
                </span>
                <span className="text-xs text-zinc-400">
                  {packet.pids.length} narrative paragraphs
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {packet.scene_current_places.map((place) => (
                  <span key={`${packet.scene_id}:place:${place}`} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                    {place}
                  </span>
                ))}
                {packet.scene_cast_union.map((name) => (
                  <span key={`${packet.scene_id}:cast:${name}`} className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">
                    {name}
                  </span>
                ))}
              </div>
              <div className="mt-3 space-y-2">
                {packet.paragraphs.length > 0 ? (
                  packet.paragraphs.map((paragraph) => (
                    <p key={`${packet.scene_id}:${paragraph.pid}`} className="text-[15px] leading-7 text-zinc-700">
                      {paragraph.text}
                    </p>
                  ))
                ) : (
                  <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-white/70 px-3 py-2 text-[15px] leading-7 text-zinc-700">
                    {packet.scene_text_with_pid_markers}
                  </pre>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      <aside className="min-h-0 space-y-4 overflow-y-auto pr-1">
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Result</p>
              <h4 className="mt-1 text-base font-semibold text-zinc-900">SCENE.1 Scene Packet Builder</h4>
            </div>
            <span className="text-xs text-zinc-400">{artifact.method}</span>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
            <ResultMetaCard label="Scene Packets" value={String(packetSummaries.length)} />
            <ResultMetaCard
              label="Phase Markers"
              value={String(packetSummaries.reduce((sum, packet) => sum + packet.phase_markers.length, 0))}
            />
            <ResultMetaCard
              label="Entity Registry"
              value={String(packetSummaries.reduce((sum, packet) => sum + Object.keys(packet.entity_registry).length, 0))}
            />
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Scene Selector</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {packetSummaries.map((packet) => (
              <button
                key={`selector:${packet.scene_id}`}
                type="button"
                onClick={() => jumpToScene(packet.scene_id)}
                className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  activeSceneId === packet.scene_id
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                }`}
              >
                {packet.scene_id}
              </button>
            ))}
          </div>
        </div>

        {selectedPacket ? (
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h5 className="text-sm font-semibold text-zinc-900">{selectedPacket.scene_id}</h5>
              <span className="text-xs text-zinc-400">
                P{selectedPacket.start_pid}-P{selectedPacket.end_pid}
              </span>
              <span className="text-xs text-zinc-400">
                ({selectedPacket.pids.length} narrative paragraphs)
              </span>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Start State</p>
                <div className="mt-3 space-y-3">
                  <div>
                    <p className="text-xs text-zinc-400">Current Place</p>
                    <p className="mt-1 text-sm text-zinc-700">
                      {readStateValue(selectedPacket.start_state, "current_place") ?? "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-400">Mentioned Place</p>
                    <p className="mt-1 text-sm text-zinc-700">
                      {readStateValue(selectedPacket.start_state, "mentioned_place") ?? "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-400">Active Cast</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {readCastValue(selectedPacket.start_state).length > 0 ? (
                        readCastValue(selectedPacket.start_state).map((name) => (
                          <span key={`${selectedPacket.scene_id}:start:${name}`} className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">
                            {name}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-zinc-400">-</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">End State</p>
                <div className="mt-3 space-y-3">
                  <div>
                    <p className="text-xs text-zinc-400">Current Place</p>
                    <p className="mt-1 text-sm text-zinc-700">
                      {readStateValue(selectedPacket.end_state, "current_place") ?? "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-400">Mentioned Place</p>
                    <p className="mt-1 text-sm text-zinc-700">
                      {readStateValue(selectedPacket.end_state, "mentioned_place") ?? "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-400">Active Cast</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {readCastValue(selectedPacket.end_state).length > 0 ? (
                        readCastValue(selectedPacket.end_state).map((name) => (
                          <span key={`${selectedPacket.scene_id}:end:${name}`} className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">
                            {name}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-zinc-400">-</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-3">
              <div className="rounded-xl border border-zinc-200 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Cast Union</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {selectedPacket.scene_cast_union.length > 0 ? (
                    selectedPacket.scene_cast_union.map((name) => (
                      <span key={`${selectedPacket.scene_id}:union:${name}`} className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">
                        {name}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-zinc-400">-</span>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-zinc-200 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Places</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {selectedPacket.scene_current_places.map((place) => (
                    <span key={`${selectedPacket.scene_id}:current-place:${place}`} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                      {place}
                    </span>
                  ))}
                  {selectedPacket.scene_mentioned_places
                    .filter((place) => !selectedPacket.scene_current_places.includes(place))
                    .map((place) => (
                      <span key={`${selectedPacket.scene_id}:mentioned-place:${place}`} className="rounded-full bg-lime-50 px-2 py-0.5 text-[11px] text-lime-700">
                        {place}
                      </span>
                    ))}
                  {selectedPacket.scene_current_places.length === 0 && selectedPacket.scene_mentioned_places.length === 0 && (
                    <span className="text-sm text-zinc-400">-</span>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-zinc-200 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Time Signals</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {selectedPacket.scene_time_signals.length > 0 ? (
                    selectedPacket.scene_time_signals.map((signal) => (
                      <span key={`${selectedPacket.scene_id}:time:${signal}`} className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] text-violet-700">
                        {signal}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-zinc-400">-</span>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
              <div className="rounded-xl border border-zinc-200 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Entity Registry</p>
                {Object.keys(selectedPacket.entity_registry).length > 0 ? (
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-left text-sm text-zinc-700">
                      <thead className="text-xs uppercase tracking-wide text-zinc-400">
                        <tr>
                          <th className="pb-2 pr-4 font-medium">canonical_name</th>
                          <th className="pb-2 font-medium">entity_id</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(selectedPacket.entity_registry).map(([name, entityId]) => (
                          <tr key={`${selectedPacket.scene_id}:entity:${name}`} className="border-t border-zinc-100">
                            <td className="py-2 pr-4 font-mono text-emerald-700">{name}</td>
                            <td className="py-2 font-mono text-emerald-700">{entityId}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-zinc-400">No entity registry entries.</p>
                )}
              </div>

              <div className="rounded-xl border border-zinc-200 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Phase Markers</p>
                <div className="mt-3 space-y-2">
                  {selectedPacket.phase_markers.length > 0 ? (
                    selectedPacket.phase_markers.map((marker, index) => (
                      <div
                        key={`${selectedPacket.scene_id}:marker:${index}`}
                        className="rounded-lg border border-dashed border-amber-300 bg-amber-50/50 px-3 py-2 text-xs leading-5 text-amber-800"
                      >
                        <p className="font-medium">
                          {marker.label} score={marker.score}
                        </p>
                        <p className="mt-1">before P{marker.boundary_before_pid}</p>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-zinc-400">No internal phase markers.</p>
                  )}
                </div>
              </div>
            </div>

            <details className="mt-4 rounded-xl border border-zinc-200">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-700">
                Scene Text (pid markers)
              </summary>
              <pre className="overflow-x-auto border-t border-zinc-200 bg-zinc-50 px-4 py-3 text-xs leading-6 text-zinc-700">
                {selectedPacket.scene_text_with_pid_markers}
              </pre>
            </details>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-sm text-zinc-500">
            No scene packets found.
          </div>
        )}
      </aside>
    </div>
  )
}

function Vis2StageView({
  artifact,
  scenePacketLog,
  preparedChapter,
}: {
  artifact: StageBlueprint
  scenePacketLog?: ScenePackets
  preparedChapter?: PreparedChapter
}) {
  const [activeSceneId, setActiveSceneId] = useState<string | null>(artifact.packets[0]?.scene_id ?? null)
  const [flashSceneId, setFlashSceneId] = useState<string | null>(null)
  const sceneRefs = useRef(new Map<string, HTMLElement | null>())
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    }
  }, [])

  const paragraphs = preparedChapter?.raw_chapter.paragraphs ?? []
  const scenePacketMap = new Map(
    scenePacketLog?.packets.map((packet, index) => [
      packet.scene_id,
      { ...packet, accent: SCENE_ACCENTS[index % SCENE_ACCENTS.length] },
    ]) ?? [],
  )
  const blueprintPackets = artifact.packets.map((packet, index) => {
    const scenePacket = scenePacketMap.get(packet.scene_id)
    const pidSet = new Set(scenePacket?.pids ?? [])
    return {
      ...packet,
      scenePacket,
      accent: scenePacket?.accent ?? SCENE_ACCENTS[index % SCENE_ACCENTS.length],
      paragraphs: paragraphs.filter((paragraph) => pidSet.has(paragraph.pid)),
    }
  })
  const selectedPacket = blueprintPackets.find((packet) => packet.scene_id === activeSceneId) ?? blueprintPackets[0]
  const validCount = artifact.packets.filter((packet) => packet.blueprint_valid).length
  const warningCount = artifact.packets.reduce((sum, packet) => sum + packet.blueprint_warnings.length, 0)
  const zonePriorityClass: Record<string, string> = {
    high: "bg-red-600 text-white",
    medium: "bg-orange-500 text-white",
    low: "bg-zinc-300 text-zinc-700",
  }
  const zoneScaleClass: Record<string, string> = {
    dominant: "bg-blue-600 text-white",
    secondary: "bg-slate-600 text-white",
    minor: "bg-zinc-500 text-white",
  }

  function collapseSection(
    title: string,
    countLabel: string,
    accentClass: string,
    key: string,
    items?: string[],
    body?: string,
  ) {
    const itemList = items ?? []
    const hasBody = typeof body === "string" && body.trim().length > 0

    return (
      <details key={key} className="rounded-xl border border-zinc-200 bg-white">
        <summary className="cursor-pointer list-none px-5 py-4">
          <div className="flex items-center gap-3 text-sm text-zinc-800">
            <span className="text-xs text-zinc-500">▾</span>
            {countLabel ? (
              <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-[11px] font-semibold ${accentClass}`}>
                {countLabel}
              </span>
            ) : null}
            <span className="text-[15px] font-medium">{title}</span>
          </div>
        </summary>
        <div className="border-t border-zinc-200 px-5 py-4">
          {itemList.length > 0 ? (
            <div className="space-y-2 text-sm leading-7 text-zinc-700">
              {itemList.map((item) => (
                <p key={`${key}:${item}`} className="text-red-600">
                  - {item}
                </p>
              ))}
            </div>
          ) : hasBody ? (
            <p className="text-sm leading-7 text-zinc-700">{body}</p>
          ) : (
            <p className="text-sm text-zinc-400">No content.</p>
          )}
        </div>
      </details>
    )
  }

  function jumpToScene(sceneId: string) {
    const ref = sceneRefs.current.get(sceneId)
    ref?.scrollIntoView({ behavior: "smooth", block: "start" })
    setActiveSceneId(sceneId)
    setFlashSceneId(sceneId)
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    flashTimerRef.current = setTimeout(() => setFlashSceneId((current) => (current === sceneId ? null : current)), 1600)
  }

  return (
    <div className="mt-4 grid min-h-0 flex-1 gap-5 overflow-hidden xl:grid-cols-2">
      <section className="flex min-h-0 min-w-0 flex-col rounded-xl border border-zinc-200 bg-zinc-50 p-5">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Body</p>
            <h4 className="mt-1 text-base font-semibold text-zinc-900">
              {preparedChapter?.chapter_title ?? "Scene Text"}
            </h4>
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-xs text-zinc-500">
            {blueprintPackets.length} blueprints
          </span>
        </div>

        <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {blueprintPackets.map((packet) => (
            <article
              key={packet.scene_id}
              ref={(node) => {
                sceneRefs.current.set(packet.scene_id, node)
              }}
              onClick={() => setActiveSceneId(packet.scene_id)}
              className={`cursor-pointer rounded-xl border border-zinc-200 border-l-4 px-4 py-3 transition-colors ${packet.accent} ${
                activeSceneId === packet.scene_id || flashSceneId === packet.scene_id
                  ? "ring-2 ring-amber-300 ring-offset-1"
                  : ""
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white px-2 py-0.5 font-mono text-[11px] text-zinc-500">
                  {packet.scene_id}
                </span>
                {packet.scenePacket && (
                  <span className="text-xs text-zinc-400">
                    P{packet.scenePacket.start_pid}-P{packet.scenePacket.end_pid}
                  </span>
                )}
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] ${
                    packet.blueprint_valid ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {packet.blueprint_valid ? "valid" : "needs review"}
                </span>
              </div>
              <h5 className="mt-2 text-sm font-semibold text-zinc-900">{packet.layout_summary}</h5>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                  {packet.environment_type}
                </span>
                <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[11px] text-orange-700">
                  {packet.stage_archetype}
                </span>
              </div>
              <div className="mt-3 space-y-2">
                {packet.paragraphs.length > 0 ? (
                  packet.paragraphs.map((paragraph) => (
                    <p key={`${packet.scene_id}:${paragraph.pid}`} className="text-[15px] leading-7 text-zinc-700">
                      {paragraph.text}
                    </p>
                  ))
                ) : (
                  <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-white/70 px-3 py-2 text-[15px] leading-7 text-zinc-700">
                    {packet.scenePacket?.scene_text_with_pid_markers ?? packet.layout_summary}
                  </pre>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      <aside className="min-h-0 space-y-4 overflow-y-auto pr-1">
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Result</p>
              <h4 className="mt-1 text-base font-semibold text-zinc-900">VIS.2 Stage Blueprint</h4>
            </div>
            <span className="text-xs text-zinc-400">{artifact.method}</span>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
            <ResultMetaCard label="Packets" value={String(artifact.packets.length)} />
            <ResultMetaCard label="Valid" value={String(validCount)} />
            <ResultMetaCard label="Warnings" value={String(warningCount)} />
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Scene Selector</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {blueprintPackets.map((packet) => (
              <button
                key={`vis2-selector:${packet.scene_id}`}
                type="button"
                onClick={() => jumpToScene(packet.scene_id)}
                className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  activeSceneId === packet.scene_id
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                }`}
              >
                {packet.scene_id}
              </button>
            ))}
          </div>
        </div>

        {selectedPacket ? (
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h5 className="text-[17px] font-semibold text-zinc-900">{selectedPacket.scene_id}</h5>
              <span className="rounded-full bg-sky-700 px-3 py-1 text-[12px] font-semibold text-white">
                {selectedPacket.environment_type}
              </span>
              <span className="rounded-full bg-slate-700 px-3 py-1 text-[12px] font-semibold text-white">
                {selectedPacket.stage_archetype}
              </span>
              <span
                className={`rounded-full px-3 py-1 text-[12px] font-semibold ${
                  selectedPacket.blueprint_valid
                    ? "bg-emerald-600 text-white"
                    : "bg-amber-500 text-white"
                }`}
              >
                {selectedPacket.blueprint_valid ? "valid" : "needs review"}
              </span>
            </div>

            <div className="mt-5 space-y-3">
              <div className="rounded-xl bg-sky-100 px-4 py-4">
                <p className="text-sm font-semibold text-blue-800">Key moment</p>
                <p className="mt-2 text-[17px] italic leading-8 text-slate-700">{selectedPacket.key_moment}</p>
              </div>

              <div className="rounded-xl bg-fuchsia-50 px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[15px] text-slate-700">
                  <span>{selectedPacket.setting.location}</span>
                  <span className="text-zinc-300">|</span>
                  <span>{selectedPacket.setting.time_of_day}</span>
                  <span className="text-zinc-300">|</span>
                  <span>{selectedPacket.setting.atmosphere}</span>
                  <span className="text-zinc-300">|</span>
                  <span>{selectedPacket.setting.lighting}</span>
                </div>
              </div>

              <div className="rounded-xl bg-indigo-50 px-4 py-4">
                <p className="text-sm font-semibold text-indigo-800">Stage Grammar</p>
                <p className="mt-2 text-[15px] leading-7 text-slate-700">
                  form: {selectedPacket.zones[0]?.shape ?? selectedPacket.geometry?.dominant_geometry ?? "-"}
                  {" · "}enclosure: {selectedPacket.geometry?.enclosure ?? "-"}
                  {" · "}axis: {selectedPacket.geometry?.main_axis ?? "-"}
                  {" · "}ground: {selectedPacket.geometry?.ground_profile ?? "-"}
                  {" · "}height: {selectedPacket.geometry?.height_profile ?? "-"}
                  {" · "}openness: {selectedPacket.geometry?.openness ?? "-"}
                </p>
              </div>

              <div className="rounded-xl bg-lime-50 px-4 py-4">
                <p className="text-sm font-semibold text-lime-800">Layout</p>
                <p className="mt-2 text-[15px] leading-7 text-slate-700">{selectedPacket.layout_summary}</p>
              </div>
            </div>

            <div className="mt-8 border-t border-zinc-200 pt-6">
              <p className="text-[15px] text-zinc-500">Zones ({selectedPacket.zones.length})</p>
              <div className="mt-5 space-y-4">
                {selectedPacket.zones.length > 0 ? selectedPacket.zones.map((zone) => (
                  <div key={`${selectedPacket.scene_id}:zone:${zone.name}`} className="flex flex-wrap items-center gap-2 text-[15px] text-zinc-800">
                    <span className="text-lg text-violet-700">▣</span>
                    <span className="font-semibold">{zone.name}</span>
                    <span className="rounded-full bg-slate-500 px-2.5 py-1 text-[12px] font-semibold text-white">
                      {zone.shape}
                    </span>
                    <span className="rounded-full bg-slate-600 px-2.5 py-1 text-[12px] font-semibold text-white">
                      {zone.position}
                    </span>
                    <span className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${zoneScaleClass[zone.scale] ?? "bg-zinc-700 text-white"}`}>
                      {zone.scale}
                    </span>
                    <span className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${zonePriorityClass[zone.priority] ?? "bg-zinc-700 text-white"}`}>
                      {zone.priority}
                    </span>
                  </div>
                )) : (
                  <p className="text-sm text-zinc-400">No zones.</p>
                )}
              </div>
            </div>

            <div className="mt-8">
              <p className="text-[15px] text-zinc-500">Boundaries ({selectedPacket.boundaries.length})</p>
              <div className="mt-5 space-y-5">
                {selectedPacket.boundaries.length > 0 ? selectedPacket.boundaries.map((item) => (
                  <p key={`${selectedPacket.scene_id}:boundary:${item}`} className="text-[15px] leading-7 text-zinc-800">
                    · {item}
                  </p>
                )) : (
                  <p className="text-sm text-zinc-400">No boundaries.</p>
                )}
              </div>
            </div>

            {false && (
            <div className="mt-8">
              <p className="text-[15px] text-zinc-500">Characters ({selectedPacket.characters.length})</p>
              <div className="mt-5 space-y-6">
                {selectedPacket.characters.length > 0 ? (
                  selectedPacket.characters.map((character) => (
                    <div key={`${selectedPacket.scene_id}:char:${character.name}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-lg text-violet-700">♟</span>
                        <span className="text-[17px] font-semibold text-zinc-900">{character.name}</span>
                        <span className="rounded-full bg-blue-600 px-2.5 py-1 text-[12px] font-semibold text-white">
                          {character.composition_position}
                        </span>
                      </div>
                      <p className="mt-2 pl-7 text-[15px] leading-7 text-zinc-700">
                        {character.pose}
                        {character.expression ? ` · ${character.expression}` : ""}
                        {character.gaze_direction ? ` · ${character.gaze_direction}` : ""}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-zinc-400">No onstage characters in blueprint.</p>
                )}
              </div>
            </div>
            )}

            <div className="mt-8">
              <p className="text-[15px] text-zinc-500">Structural elements ({selectedPacket.structural_elements.length})</p>
              <div className="mt-5 flex flex-wrap gap-2">
                {selectedPacket.structural_elements.length > 0 ? selectedPacket.structural_elements.map((item) => (
                  <span
                    key={`${selectedPacket.scene_id}:struct:${item}`}
                    className="rounded-full bg-slate-700 px-3 py-1.5 text-[13px] font-semibold text-white"
                  >
                    {item}
                  </span>
                )) : (
                  <span className="text-sm text-zinc-400">No structural elements.</span>
                )}
              </div>
            </div>

            <div className="mt-8 space-y-5 border-t border-zinc-200 pt-5">
              {collapseSection(
                "Forbid",
                String(selectedPacket.forbid.length),
                "bg-red-50 text-red-600",
                `${selectedPacket.scene_id}:forbid`,
                selectedPacket.forbid,
              )}
              {collapseSection(
                "Avoid",
                String(selectedPacket.avoid.length),
                "bg-orange-50 text-orange-600",
                `${selectedPacket.scene_id}:avoid`,
                selectedPacket.avoid,
              )}
              {collapseSection(
                "Must NOT show",
                String(selectedPacket.must_not_show.length),
                "bg-rose-50 text-rose-600",
                `${selectedPacket.scene_id}:must-not-show`,
                selectedPacket.must_not_show,
              )}
              {collapseSection(
                "Continuity note",
                "",
                "bg-violet-50 text-violet-600",
                `${selectedPacket.scene_id}:continuity-note`,
                [],
                selectedPacket.continuity_note,
              )}
            </div>

            <div className="mt-4 rounded-xl border border-zinc-200 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Warnings / Uncertainties</p>
              <div className="mt-3 grid gap-3 xl:grid-cols-2">
                <div>
                  <p className="text-xs font-medium text-zinc-500">Warnings</p>
                  <div className="mt-2 space-y-1 text-xs text-amber-700">
                    {selectedPacket.blueprint_warnings.length > 0 ? selectedPacket.blueprint_warnings.map((item) => (
                      <p key={`${selectedPacket.scene_id}:warning:${item}`}>{item}</p>
                    )) : <p className="text-zinc-400">-</p>}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-zinc-500">Uncertainties</p>
                  <div className="mt-2 space-y-1 text-xs text-zinc-700">
                    {selectedPacket.uncertainties.length > 0 ? selectedPacket.uncertainties.map((item) => (
                      <p key={`${selectedPacket.scene_id}:uncertainty:${item}`}>{item}</p>
                    )) : <p className="text-zinc-400">-</p>}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-sm text-zinc-500">
            No blueprint packets found.
          </div>
        )}
      </aside>
    </div>
  )
}

function Vis4StageView({
  artifact,
  scenePacketLog,
  blueprintLog,
  preparedChapter,
}: {
  artifact: RenderedImages
  scenePacketLog?: ScenePackets
  blueprintLog?: StageBlueprint
  preparedChapter?: PreparedChapter
}) {
  const [activeSceneId, setActiveSceneId] = useState<string | null>(artifact.results[0]?.scene_id ?? null)
  const [flashSceneId, setFlashSceneId] = useState<string | null>(null)
  const sceneRefs = useRef(new Map<string, HTMLElement | null>())
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    }
  }, [])

  const paragraphs = preparedChapter?.raw_chapter.paragraphs ?? []
  const scenePacketMap = new Map(
    scenePacketLog?.packets.map((packet, index) => [
      packet.scene_id,
      { ...packet, accent: SCENE_ACCENTS[index % SCENE_ACCENTS.length] },
    ]) ?? [],
  )
  const blueprintMap = new Map(blueprintLog?.packets.map((packet) => [packet.scene_id, packet]) ?? [])
  const renderResults = artifact.results.map((result, index) => {
    const scenePacket = scenePacketMap.get(result.scene_id)
    const blueprintPacket = blueprintMap.get(result.scene_id)
    const pidSet = new Set(scenePacket?.pids ?? [])
    return {
      ...result,
      scenePacket,
      blueprintPacket,
      accent: scenePacket?.accent ?? SCENE_ACCENTS[index % SCENE_ACCENTS.length],
      paragraphs: paragraphs.filter((paragraph) => pidSet.has(paragraph.pid)),
      imageSrc: result.download_url || result.image_path,
    }
  })
  const selectedResult = renderResults.find((result) => result.scene_id === activeSceneId) ?? renderResults[0]
  const successCount = artifact.results.filter((result) => result.success).length
  const failureCount = Math.max(0, artifact.results.length - successCount)

  function jumpToScene(sceneId: string) {
    const ref = sceneRefs.current.get(sceneId)
    ref?.scrollIntoView({ behavior: "smooth", block: "start" })
    setActiveSceneId(sceneId)
    setFlashSceneId(sceneId)
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    flashTimerRef.current = setTimeout(() => setFlashSceneId((current) => (current === sceneId ? null : current)), 1600)
  }

  return (
    <div className="mt-4 grid min-h-0 flex-1 gap-5 overflow-hidden xl:grid-cols-2">
      <section className="flex min-h-0 min-w-0 flex-col rounded-xl border border-zinc-200 bg-zinc-50 p-5">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Body</p>
            <h4 className="mt-1 text-base font-semibold text-zinc-900">
              {preparedChapter?.chapter_title ?? "Scene Text"}
            </h4>
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-xs text-zinc-500">
            {renderResults.length} renders
          </span>
        </div>

        <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {renderResults.map((result) => (
            <article
              key={result.scene_id}
              ref={(node) => {
                sceneRefs.current.set(result.scene_id, node)
              }}
              onClick={() => setActiveSceneId(result.scene_id)}
              className={`cursor-pointer rounded-xl border border-zinc-200 border-l-4 px-4 py-3 transition-colors ${result.accent} ${
                activeSceneId === result.scene_id || flashSceneId === result.scene_id
                  ? "ring-2 ring-amber-300 ring-offset-1"
                  : ""
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white px-2 py-0.5 font-mono text-[11px] text-zinc-500">
                  {result.scene_id}
                </span>
                {result.scenePacket && (
                  <span className="text-xs text-zinc-400">
                    P{result.scenePacket.start_pid}-P{result.scenePacket.end_pid}
                  </span>
                )}
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] ${
                    result.success ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                  }`}
                >
                  {result.success ? "rendered" : "failed"}
                </span>
              </div>
              {result.blueprintPacket?.setting.location && (
                <p className="mt-2 text-sm font-medium text-zinc-800">
                  {result.blueprintPacket.setting.location}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {result.blueprintPacket?.characters.slice(0, 4).map((character) => (
                  <span key={`${result.scene_id}:char:${character.name}`} className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">
                    {character.name}
                  </span>
                ))}
                {result.blueprintPacket?.structural_elements.slice(0, 3).map((item) => (
                  <span key={`${result.scene_id}:struct:${item}`} className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] text-violet-700">
                    {item}
                  </span>
                ))}
              </div>
              <div className="mt-3 space-y-2">
                {result.paragraphs.length > 0 ? (
                  result.paragraphs.map((paragraph) => (
                    <p key={`${result.scene_id}:${paragraph.pid}`} className="text-[15px] leading-7 text-zinc-700">
                      {paragraph.text}
                    </p>
                  ))
                ) : (
                  <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-white/70 px-3 py-2 text-[15px] leading-7 text-zinc-700">
                    {result.scenePacket?.scene_text_with_pid_markers ?? result.blueprintPacket?.layout_summary ?? result.scene_id}
                  </pre>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      <aside className="min-h-0 space-y-4 overflow-y-auto pr-1">
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Result</p>
              <h4 className="mt-1 text-base font-semibold text-zinc-900">VIS.4 Image Generation</h4>
            </div>
            <span className="text-xs text-zinc-400">{artifact.method}</span>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
            <ResultMetaCard label="Renders" value={String(artifact.results.length)} />
            <ResultMetaCard label="Success" value={String(successCount)} />
            <ResultMetaCard label="Failed" value={String(failureCount)} />
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Scene Selector</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {renderResults.map((result) => (
              <button
                key={`vis4-selector:${result.scene_id}`}
                type="button"
                onClick={() => jumpToScene(result.scene_id)}
                className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  activeSceneId === result.scene_id
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                }`}
              >
                {result.scene_id}
              </button>
            ))}
          </div>
        </div>

        {selectedResult ? (
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h5 className="text-[17px] font-semibold text-zinc-900">{selectedResult.scene_id}</h5>
              <span
                className={`rounded-full px-3 py-1 text-[12px] font-semibold ${
                  selectedResult.success ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"
                }`}
              >
                {selectedResult.success ? "rendered" : "failed"}
              </span>
              {selectedResult.blueprintPacket?.setting.location && (
                <span className="rounded-full bg-zinc-100 px-3 py-1 text-[12px] font-semibold text-zinc-700">
                  {selectedResult.blueprintPacket.setting.location}
                </span>
              )}
            </div>

            <div className="mt-4 overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50">
              {selectedResult.success && selectedResult.imageSrc ? (
                <div className="flex h-[520px] items-center justify-center bg-zinc-100/70 p-3 2xl:h-[620px]">
                  <img
                    src={selectedResult.imageSrc}
                    alt={`${selectedResult.scene_id} render`}
                    className="h-full w-full object-contain"
                  />
                </div>
              ) : (
                <div className="flex h-[520px] items-center justify-center px-6 text-center text-sm text-zinc-500 2xl:h-[620px]">
                  {selectedResult.error ?? "No rendered image available for this scene."}
                </div>
              )}
            </div>

            {selectedResult.blueprintPacket && (
              <>
                <div className="mt-4 rounded-xl bg-sky-50 px-4 py-3">
                  <p className="text-sm leading-6 text-slate-700">
                    {selectedResult.blueprintPacket.key_moment}
                  </p>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-zinc-50 px-4 py-3 text-[14px] text-zinc-700">
                  <span>{selectedResult.blueprintPacket.setting.location}</span>
                  <span className="text-zinc-300">|</span>
                  <span>{selectedResult.blueprintPacket.setting.atmosphere}</span>
                  <span className="text-zinc-300">|</span>
                  <span>{selectedResult.blueprintPacket.setting.lighting}</span>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {selectedResult.blueprintPacket.characters.map((character) => (
                    <span
                      key={`${selectedResult.scene_id}:detail:char:${character.name}`}
                      className="rounded-full bg-blue-600 px-3 py-1.5 text-[13px] font-semibold text-white"
                    >
                      {character.name}
                    </span>
                  ))}
                  {selectedResult.blueprintPacket.structural_elements.slice(0, 6).map((item) => (
                    <span
                      key={`${selectedResult.scene_id}:detail:struct:${item}`}
                      className="rounded-full bg-violet-600 px-3 py-1.5 text-[13px] font-semibold text-white"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </>
            )}

            <div className="mt-5 grid gap-4 xl:grid-cols-2">
              <div className="rounded-xl border border-zinc-200 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Render Metadata</p>
                <div className="mt-3 space-y-2 text-sm text-zinc-700">
                  <p><span className="text-zinc-400">model</span> {selectedResult.model || artifact.model || "-"}</p>
                  <p><span className="text-zinc-400">style</span> {artifact.style || "-"}</p>
                  <p><span className="text-zinc-400">content type</span> {selectedResult.content_type || "-"}</p>
                  <p><span className="text-zinc-400">size</span> {typeof selectedResult.size_bytes === "number" ? `${selectedResult.size_bytes.toLocaleString()} bytes` : "-"}</p>
                </div>
              </div>
              <div className="rounded-xl border border-zinc-200 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Storage</p>
                <div className="mt-3 space-y-2 break-all text-sm text-zinc-700">
                  <p><span className="text-zinc-400">image</span> {selectedResult.imageSrc || "-"}</p>
                  <p><span className="text-zinc-400">storage path</span> {selectedResult.storage_path || "-"}</p>
                  <p><span className="text-zinc-400">gs uri</span> {selectedResult.gs_uri || "-"}</p>
                </div>
              </div>
            </div>

            {selectedResult.error && (
              <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {selectedResult.error}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-sm text-zinc-500">
            No rendered image results found.
          </div>
        )}
      </aside>
    </div>
  )
}

type Vis3Tab =
  | "full_prompt"
  | "common_style_block"
  | "scene_blueprint_block"
  | "presentation_block"
  | "hard_constraints_block"
  | "failure_patch_block"

const VIS3_TAB_META: Array<{ id: Vis3Tab; label: string; title: string }> = [
  { id: "full_prompt", label: "Full Prompt", title: "full_prompt" },
  { id: "common_style_block", label: "Style Block", title: "common_style_block" },
  { id: "scene_blueprint_block", label: "Scene Block", title: "scene_blueprint_block" },
  { id: "presentation_block", label: "Presentation", title: "presentation_block" },
  { id: "hard_constraints_block", label: "Constraints", title: "hard_constraints_block" },
  { id: "failure_patch_block", label: "Failure Patch", title: "failure_patch_block" },
]

function Vis3StageView({ artifact }: { artifact: RenderPackage }) {
  const [activeTabs, setActiveTabs] = useState<Record<string, Vis3Tab>>({})
  const totalChars = artifact.items.reduce((sum, item) => sum + item.full_prompt.length, 0)

  function getActiveTab(sceneId: string): Vis3Tab {
    return activeTabs[sceneId] ?? "full_prompt"
  }

  function selectTab(sceneId: string, tab: Vis3Tab) {
    setActiveTabs((prev) => ({ ...prev, [sceneId]: tab }))
  }

  function getBlockText(item: RenderPackage["items"][number], tab: Vis3Tab): string {
    switch (tab) {
      case "full_prompt":
        return item.full_prompt
      case "common_style_block":
        return item.common_style_block
      case "scene_blueprint_block":
        return item.scene_blueprint_block
      case "presentation_block":
        return item.presentation_block
      case "hard_constraints_block":
        return item.hard_constraints_block
      case "failure_patch_block":
        return item.failure_patch_block
      default:
        return item.full_prompt
    }
  }

  return (
    <div className="mt-4 min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto pr-1">
      <div className="rounded-xl border border-zinc-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Result</p>
            <h4 className="mt-1 text-base font-semibold text-zinc-900">VIS.3 Render Package</h4>
          </div>
          <span className="text-xs text-zinc-400">{artifact.method}</span>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <ResultMetaCard label="Scenes" value={String(artifact.items.length)} />
          <ResultMetaCard label="Schema" value={artifact.items[0]?.prompt_schema_version ?? "-"} />
          <ResultMetaCard label="Prompt Chars" value={totalChars.toLocaleString()} />
        </div>
      </div>

      <div className="space-y-4">
        {artifact.items.map((item) => {
          const activeTab = getActiveTab(item.scene_id)
          const activeMeta = VIS3_TAB_META.find((tab) => tab.id === activeTab) ?? VIS3_TAB_META[0]
          const activeText = getBlockText(item, activeTab)

          return (
            <details key={item.scene_id} className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
              <summary className="cursor-pointer px-5 py-4 text-sm text-zinc-800">
                <span className="inline-flex items-center gap-3">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-emerald-500 text-xs font-semibold text-white">
                    v
                  </span>
                  <span className="font-medium">{item.scene_id}</span>
                </span>
              </summary>

              <div className="border-t border-zinc-200 px-5 py-5">
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-2xl font-semibold text-zinc-900">
                    Scene ID:{" "}
                    <span className="rounded-md bg-emerald-50 px-2 py-1 font-mono text-lg text-emerald-700">
                      {item.scene_id}
                    </span>
                  </p>
                  <p className="text-2xl font-semibold text-zinc-900">
                    Schema:{" "}
                    <span className="rounded-md bg-cyan-50 px-2 py-1 font-mono text-lg text-cyan-700">
                      {item.prompt_schema_version}
                    </span>
                  </p>
                </div>

                <p className="mt-6 text-base text-zinc-400">
                  Total prompt chars: {item.full_prompt.length.toLocaleString()}
                </p>

                <div className="mt-8 flex flex-wrap gap-5 border-b border-zinc-200">
                  {VIS3_TAB_META.map((tab) => (
                    <button
                      key={`${item.scene_id}:tab:${tab.id}`}
                      type="button"
                      onClick={() => selectTab(item.scene_id, tab.id)}
                      className={`border-b-2 px-1 pb-3 text-lg transition-colors ${
                        activeTab === tab.id
                          ? "border-red-400 text-red-500"
                          : "border-transparent text-zinc-800 hover:text-zinc-600"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="mt-6">
                  <p className="text-sm text-zinc-400">{activeMeta.title}</p>
                  <pre className="mt-3 max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-zinc-50 p-5 text-sm leading-8 text-zinc-500">
                    {activeText}
                  </pre>
                </div>
              </div>
            </details>
          )
        })}
      </div>
    </div>
  )
}

function Vis1StageView({
  artifact,
  scenePacketLog,
  preparedChapter,
}: {
  artifact: VisualGrounding
  scenePacketLog?: ScenePackets
  preparedChapter?: PreparedChapter
}) {
  const [activeSceneId, setActiveSceneId] = useState<string | null>(artifact.packets[0]?.scene_id ?? null)
  const [flashSceneId, setFlashSceneId] = useState<string | null>(null)
  const sceneRefs = useRef(new Map<string, HTMLElement | null>())
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    }
  }, [])

  const paragraphs = preparedChapter?.raw_chapter.paragraphs ?? []
  const scenePacketMap = new Map(
    scenePacketLog?.packets.map((packet, index) => [
      packet.scene_id,
      { ...packet, accent: SCENE_ACCENTS[index % SCENE_ACCENTS.length] },
    ]) ?? [],
  )
  const firstSceneStart = scenePacketLog?.packets[0]?.start_pid
  const prefaceParagraphs = firstSceneStart === undefined
    ? []
    : paragraphs.filter((paragraph) => paragraph.pid < firstSceneStart)
  const visualPackets = artifact.packets.map((packet, index) => {
    const scenePacket = scenePacketMap.get(packet.scene_id)
    const pidSet = new Set(scenePacket?.pids ?? [])
    return {
      ...packet,
      scenePacket,
      accent: scenePacket?.accent ?? SCENE_ACCENTS[index % SCENE_ACCENTS.length],
      paragraphs: paragraphs.filter((paragraph) => pidSet.has(paragraph.pid)),
    }
  })
  const selectedPacket = visualPackets.find((packet) => packet.scene_id === activeSceneId) ?? visualPackets[0]
  const ambiguityCount = artifact.packets.reduce((sum, packet) => sum + packet.ambiguity_resolutions.length, 0)

  function jumpToScene(sceneId: string) {
    const ref = sceneRefs.current.get(sceneId)
    ref?.scrollIntoView({ behavior: "smooth", block: "start" })
    setActiveSceneId(sceneId)
    setFlashSceneId(sceneId)
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    flashTimerRef.current = setTimeout(() => setFlashSceneId((current) => (current === sceneId ? null : current)), 1600)
  }

  return (
    <div className="mt-4 grid min-h-0 flex-1 gap-5 overflow-hidden xl:grid-cols-2">
      <section className="flex min-h-0 min-w-0 flex-col rounded-xl border border-zinc-200 bg-zinc-50 p-5">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Body</p>
            <h4 className="mt-1 text-base font-semibold text-zinc-900">
              {preparedChapter?.chapter_title ?? "Scene Text"}
            </h4>
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-xs text-zinc-500">
            {visualPackets.length} scenes
          </span>
        </div>

        <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {prefaceParagraphs.length > 0 && (
            <section className="rounded-xl border border-zinc-200 bg-white/80 px-4 py-3 text-zinc-400">
              <p className="text-xs font-semibold uppercase tracking-wide">Preface / Non-Scene</p>
              <div className="mt-2 space-y-2">
                {prefaceParagraphs.map((paragraph) => (
                  <p key={paragraph.pid} className="text-sm italic leading-7">
                    {paragraph.text}
                  </p>
                ))}
              </div>
            </section>
          )}

          {visualPackets.map((packet) => (
            <article
              key={packet.scene_id}
              ref={(node) => {
                sceneRefs.current.set(packet.scene_id, node)
              }}
              onClick={() => setActiveSceneId(packet.scene_id)}
              className={`cursor-pointer rounded-xl border border-zinc-200 border-l-4 px-4 py-3 transition-colors ${packet.accent} ${
                activeSceneId === packet.scene_id || flashSceneId === packet.scene_id
                  ? "ring-2 ring-amber-300 ring-offset-1"
                  : ""
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white px-2 py-0.5 font-mono text-[11px] text-zinc-500">
                  {packet.scene_id}
                </span>
                {packet.scenePacket && (
                  <span className="text-xs text-zinc-400">
                    P{packet.scenePacket.start_pid}-P{packet.scenePacket.end_pid}
                  </span>
                )}
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                  {packet.environment_type}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600">
                  {packet.canonical_place_key}
                </span>
                <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[11px] text-orange-700">
                  {packet.stage_archetype}
                </span>
              </div>
              <div className="mt-3 space-y-2">
                {packet.paragraphs.length > 0 ? (
                  packet.paragraphs.map((paragraph) => (
                    <p key={`${packet.scene_id}:${paragraph.pid}`} className="text-[15px] leading-7 text-zinc-700">
                      {paragraph.text}
                    </p>
                  ))
                ) : (
                  <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-white/70 px-3 py-2 text-[15px] leading-7 text-zinc-700">
                    {packet.scenePacket?.scene_text_with_pid_markers ?? packet.grounded_scene_description}
                  </pre>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      <aside className="min-h-0 space-y-4 overflow-y-auto pr-1">
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Result</p>
              <h4 className="mt-1 text-base font-semibold text-zinc-900">VIS.1 Semantic Clarification</h4>
            </div>
            <span className="text-xs text-zinc-400">{artifact.method}</span>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
            <ResultMetaCard label="Packets" value={String(artifact.packets.length)} />
            <ResultMetaCard label="Ambiguities" value={String(ambiguityCount)} />
            <ResultMetaCard
              label="Constraints"
              value={String(artifact.packets.reduce((sum, packet) => sum + packet.visual_constraints.length, 0))}
            />
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Scene Selector</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {visualPackets.map((packet) => (
              <button
                key={`vis1-selector:${packet.scene_id}`}
                type="button"
                onClick={() => jumpToScene(packet.scene_id)}
                className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  activeSceneId === packet.scene_id
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                }`}
              >
                {packet.scene_id}
              </button>
            ))}
          </div>
        </div>

        {selectedPacket ? (
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h5 className="text-sm font-semibold text-zinc-900">{selectedPacket.scene_id}</h5>
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                {selectedPacket.environment_type}
              </span>
              <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[11px] text-orange-700">
                {selectedPacket.stage_archetype}
              </span>
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600">
                {selectedPacket.canonical_place_key}
              </span>
            </div>

            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                Grounded Description
              </p>
              <p className="mt-3 text-[15px] leading-7 text-zinc-800">
                {selectedPacket.grounded_scene_description}
              </p>
            </div>

            <div className="mt-4">
              <p className="text-sm font-medium text-zinc-700">
                Ambiguity Resolutions ({selectedPacket.ambiguity_resolutions.length})
              </p>
              <div className="mt-3 space-y-3">
                {selectedPacket.ambiguity_resolutions.length > 0 ? (
                  selectedPacket.ambiguity_resolutions.map((item, index) => {
                    const confidence = normalizeConfidence(item.confidence)
                    return (
                      <div
                        key={`${selectedPacket.scene_id}:ambiguity:${index}`}
                        className="rounded-xl border border-amber-200 bg-amber-50/50 px-4 py-4"
                      >
                        <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-700">
                          <span className="font-semibold text-zinc-900">&quot;{item.surface_form}&quot;</span>
                          <span className="text-zinc-400">-&gt;</span>
                          <span className="font-semibold text-blue-700">{item.resolved_sense}</span>
                          {confidence && (
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${CONFIDENCE_META[confidence].pill}`}>
                              {confidence}
                            </span>
                          )}
                        </div>
                        <p className="mt-3 text-sm leading-6 text-zinc-700">{item.render_hint}</p>
                        {item.reason && (
                          <p className="mt-3 text-sm leading-6 text-zinc-500">{item.reason}</p>
                        )}
                        {item.avoid.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {item.avoid.map((avoid) => (
                              <span
                                key={`${selectedPacket.scene_id}:ambiguity:${index}:avoid:${avoid}`}
                                className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] text-rose-700"
                              >
                                {avoid}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })
                ) : (
                  <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-sm text-zinc-500">
                    No ambiguity resolutions for this scene.
                  </div>
                )}
              </div>
            </div>

            <details className="mt-4 rounded-xl border border-zinc-200">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-700">
                Visual Constraints ({selectedPacket.visual_constraints.length})
              </summary>
              <div className="border-t border-zinc-200 px-4 py-4">
                {selectedPacket.visual_constraints.length > 0 ? (
                  <ul className="space-y-2 text-sm leading-6 text-zinc-700">
                    {selectedPacket.visual_constraints.map((constraint) => (
                      <li key={`${selectedPacket.scene_id}:constraint:${constraint}`} className="list-disc ml-5">
                        {constraint}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-zinc-400">No visual constraints.</p>
                )}
              </div>
            </details>

            <div className="mt-4 rounded-xl border border-zinc-200 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Avoid</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {selectedPacket.avoid.length > 0 ? (
                  selectedPacket.avoid.map((item) => (
                    <span
                      key={`${selectedPacket.scene_id}:avoid:${item}`}
                      className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] text-rose-700"
                    >
                      {item}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-zinc-400">-</span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-sm text-zinc-500">
            No semantic clarification packets found.
          </div>
        )}
      </aside>
    </div>
  )
}

function Sub1StageView({
  artifact,
  scenePacketLog,
  preparedChapter,
}: {
  artifact: SubsceneProposals
  scenePacketLog?: ScenePackets
  preparedChapter?: PreparedChapter
}) {
  const [activeSceneId, setActiveSceneId] = useState<string | null>(artifact.packets[0]?.scene_id ?? null)
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(null)

  const paragraphs = preparedChapter?.raw_chapter.paragraphs ?? []
  const scenePacketMap = new Map(
    scenePacketLog?.packets.map((packet, index) => [
      packet.scene_id,
      { ...packet, accent: SCENE_ACCENTS[index % SCENE_ACCENTS.length] },
    ]) ?? [],
  )

  const proposalPackets = artifact.packets.map((packet, index) => {
    const scenePacket = scenePacketMap.get(packet.scene_id)
    const pidSet = new Set(scenePacket?.pids ?? [])
    const parsedSceneText = scenePacket?.scene_text_with_pid_markers
      ? parsePidMarkedText(scenePacket.scene_text_with_pid_markers)
      : []
    const sortedCandidates = [...packet.candidate_subscenes].sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence
      if (a.start_pid !== b.start_pid) return a.start_pid - b.start_pid
      return a.end_pid - b.end_pid
    })
    const timelineCandidates = [...sortedCandidates].sort((a, b) => {
      if (a.start_pid !== b.start_pid) return a.start_pid - b.start_pid
      if (a.end_pid !== b.end_pid) return a.end_pid - b.end_pid
      return b.confidence - a.confidence
    })

    return {
      ...packet,
      scenePacket,
      accent: scenePacket?.accent ?? SCENE_ACCENTS[index % SCENE_ACCENTS.length],
      paragraphs: paragraphs.filter((paragraph) => pidSet.has(paragraph.pid)),
      parsedSceneText,
      sortedCandidates,
      timelineCandidates,
    }
  })

  const resolvedActiveSceneId = proposalPackets.some((packet) => packet.scene_id === activeSceneId)
    ? activeSceneId
    : (proposalPackets[0]?.scene_id ?? null)
  const activePacket = proposalPackets.find((packet) => packet.scene_id === resolvedActiveSceneId) ?? proposalPackets[0]
  const topCandidateId = activePacket?.sortedCandidates[0]?.candidate_id ?? null
  const resolvedCandidateId = activePacket?.sortedCandidates.some((candidate) => candidate.candidate_id === activeCandidateId)
    ? activeCandidateId
    : topCandidateId
  const activeCandidate = activePacket?.sortedCandidates.find(
    (candidate) => candidate.candidate_id === resolvedCandidateId,
  )

  const totalCandidates = artifact.packets.reduce(
    (sum, packet) => sum + packet.candidate_subscenes.length,
    0,
  )

  return (
    <div className="mt-4 grid min-h-0 flex-1 gap-5 overflow-hidden xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
      <section className="flex min-h-0 min-w-0 flex-col rounded-xl border border-zinc-200 bg-zinc-50 p-5">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Body</p>
            <h4 className="mt-1 text-base font-semibold text-zinc-900">
              {preparedChapter?.chapter_title ?? "Scene Text"}
            </h4>
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-xs text-zinc-500">
            {proposalPackets.length} scenes
          </span>
        </div>

        <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {proposalPackets.map((packet) => {
            const selected = activePacket?.scene_id === packet.scene_id
            return (
              <article
                key={packet.scene_id}
                onClick={() => setActiveSceneId(packet.scene_id)}
                className={`rounded-xl border border-zinc-200 border-l-4 px-4 py-4 transition-colors ${packet.accent} ${
                  selected ? "ring-2 ring-amber-300 ring-offset-1" : ""
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-white px-2 py-0.5 font-mono text-[11px] text-zinc-500">
                    {packet.scene_id}
                  </span>
                  {packet.scenePacket && (
                    <span className="text-xs text-zinc-400">
                      P{packet.scenePacket.start_pid}-P{packet.scenePacket.end_pid}
                    </span>
                  )}
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-zinc-600">
                    {packet.sortedCandidates.length} candidates
                  </span>
                </div>

                {packet.parsedSceneText.length > 0 ? (
                  <div className="mt-3 space-y-2.5">
                    {packet.parsedSceneText.map((line, index) => {
                      const isSelected =
                        !!activeCandidate &&
                        activePacket?.scene_id === packet.scene_id &&
                        typeof line.pid === "number" &&
                        line.pid >= activeCandidate.start_pid &&
                        line.pid <= activeCandidate.end_pid

                      return (
                        <div
                          key={`${packet.scene_id}:line:${line.pidLabel ?? index}`}
                          className={`rounded-lg px-3 py-2 ${
                            isSelected ? "bg-amber-100/80" : "bg-transparent"
                          }`}
                        >
                          {line.pidLabel ? (
                            <div className="mb-1.5">
                              <span className="inline-flex rounded-full border border-zinc-200 bg-white px-2 py-0.5 font-mono text-[11px] text-zinc-400">
                                {line.pidLabel}
                              </span>
                            </div>
                          ) : null}
                          <p className="text-[15px] leading-7 text-zinc-700">
                            {line.body}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="mt-3 space-y-2">
                    {packet.paragraphs.map((paragraph) => {
                      const pid = paragraph.pid
                      const isSelected =
                        activeCandidate &&
                        activePacket?.scene_id === packet.scene_id &&
                        pid >= activeCandidate.start_pid &&
                        pid <= activeCandidate.end_pid

                      return (
                        <p
                          key={`${packet.scene_id}:${pid}`}
                          className={`rounded-lg px-3 py-2 text-[15px] leading-7 ${
                            isSelected ? "bg-amber-100/80 text-zinc-900" : "text-zinc-700"
                          }`}
                        >
                          <span className="mr-2 font-mono text-xs text-zinc-400">P{pid}</span>
                          {paragraph.text}
                        </p>
                      )
                    })}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      </section>

      <aside className="min-h-0 space-y-4 overflow-y-auto pr-1">
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Result</p>
              <h4 className="mt-1 text-base font-semibold text-zinc-900">SUB.1 Subscene Proposal</h4>
            </div>
            <span className="text-xs text-zinc-400">{artifact.model ?? artifact.method}</span>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
            <ResultMetaCard label="Scenes" value={String(artifact.packets.length)} />
            <ResultMetaCard label="Candidates" value={String(totalCandidates)} />
            <ResultMetaCard
              label="Avg Confidence"
              value={
                totalCandidates > 0
                  ? `${Math.round(
                      artifact.packets.reduce(
                        (sum, packet) =>
                          sum +
                          packet.candidate_subscenes.reduce((inner, candidate) => inner + candidate.confidence, 0),
                        0,
                      ) /
                        totalCandidates *
                        100,
                    )}%`
                  : "-"
              }
            />
          </div>
        </div>

        {activePacket ? (
          <>
            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Scene Selector</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {proposalPackets.map((packet) => (
                  <button
                    key={`sub1-scene:${packet.scene_id}`}
                    type="button"
                    onClick={() => {
                      setActiveSceneId(packet.scene_id)
                      setActiveCandidateId(null)
                    }}
                    className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                      activePacket.scene_id === packet.scene_id
                        ? "border-zinc-900 bg-zinc-900 text-white"
                        : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                    }`}
                  >
                    {packet.scene_id}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <div className="flex flex-wrap items-center gap-2">
                <h5 className="text-[17px] font-semibold text-zinc-900">{activePacket.scene_id}</h5>
                {activePacket.scenePacket && (
                  <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[12px] font-medium text-zinc-600">
                    P{activePacket.scenePacket.start_pid}-P{activePacket.scenePacket.end_pid}
                  </span>
                )}
              </div>

              {activePacket.scenePacket && activePacket.scenePacket.pids.length > 0 && (
                <div className="mt-5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Candidate Timeline</p>
                  <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-4">
                    <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
                      <span>P{activePacket.scenePacket.start_pid}</span>
                      <span>P{activePacket.scenePacket.end_pid}</span>
                    </div>
                    <div className="mt-3 space-y-3">
                      {activePacket.timelineCandidates.map((candidate) => {
                        const sceneStart = activePacket.scenePacket!.start_pid
                        const sceneEnd = activePacket.scenePacket!.end_pid
                        const scenePids = Array.from(
                          { length: Math.max(1, sceneEnd - sceneStart + 1) },
                          (_, offset) => sceneStart + offset,
                        )
                        const overlaps = activePacket.timelineCandidates.some(
                            (other) =>
                              other.candidate_id !== candidate.candidate_id &&
                              !(other.end_pid < candidate.start_pid || other.start_pid > candidate.end_pid),
                          )
                        const selected = activeCandidate?.candidate_id === candidate.candidate_id
                        const bestCandidate =
                          activePacket.sortedCandidates[0]?.candidate_id === candidate.candidate_id

                        return (
                          <button
                            key={candidate.candidate_id}
                            type="button"
                            onClick={() => setActiveCandidateId(candidate.candidate_id)}
                            className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${
                              selected
                                ? "border-zinc-900 bg-white shadow-sm"
                                : "border-zinc-200 bg-white hover:bg-zinc-50"
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-medium text-zinc-900">{candidate.label}</span>
                                {bestCandidate && (
                                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                                    best candidate
                                  </span>
                                )}
                                {overlaps && (
                                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                                    overlapping
                                  </span>
                                )}
                              </div>
                                <span className="text-xs font-mono text-zinc-400">
                                  P{candidate.start_pid}-P{candidate.end_pid}
                                </span>
                              </div>
                            <div className="mt-3">
                              <div
                                className="grid gap-1"
                                style={{ gridTemplateColumns: `repeat(${scenePids.length}, minmax(0, 1fr))` }}
                              >
                                {scenePids.map((pid) => {
                                  const covered = pid >= candidate.start_pid && pid <= candidate.end_pid
                                  return (
                                    <span
                                      key={`${candidate.candidate_id}:pid:${pid}`}
                                      className={`h-2 rounded-full transition-colors ${
                                        covered
                                          ? selected
                                            ? "bg-zinc-900"
                                            : "bg-emerald-600"
                                          : "bg-zinc-200"
                                      }`}
                                      title={`P${pid}`}
                                    />
                                  )
                                })}
                              </div>
                              <div className="mt-2 flex items-center justify-between text-[11px] font-mono text-zinc-400">
                                <span>P{sceneStart}</span>
                                <span>{scenePids.length} paragraphs</span>
                                <span>P{sceneEnd}</span>
                              </div>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {activeCandidate ? (
              <div className="rounded-xl border border-zinc-200 bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h5 className="text-lg font-semibold text-zinc-900">{activeCandidate.label}</h5>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[12px] font-medium text-zinc-600">
                        {activeCandidate.shift_type}
                      </span>
                      <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[12px] font-medium text-blue-700">
                        P{activeCandidate.start_pid}-P{activeCandidate.end_pid}
                      </span>
                      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[12px] font-medium text-emerald-700">
                        {activeCandidate.confidence >= 0.85
                          ? "high confidence"
                          : activeCandidate.confidence >= 0.6
                            ? "medium confidence"
                            : "low confidence"}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-semibold text-zinc-900">
                      {Math.round(activeCandidate.confidence * 100)}%
                    </p>
                    <p className="text-xs text-zinc-400">confidence</p>
                  </div>
                </div>

                <div className="mt-5 space-y-4">
                  <div className="rounded-xl bg-rose-50 px-4 py-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">
                      Why Split Here
                    </p>
                    <p className="mt-2 text-[15px] leading-7 text-zinc-800">
                      {activeCandidate.boundary_reason}
                    </p>
                  </div>

                  <div className="rounded-xl bg-amber-50 px-4 py-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                      Trigger Event
                    </p>
                    <p className="mt-2 text-[15px] leading-7 text-zinc-800">
                      {activeCandidate.trigger_event}
                    </p>
                  </div>

                  <div className="rounded-xl bg-sky-50 px-4 py-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">
                      Local Focus
                    </p>
                    <p className="mt-2 text-[15px] leading-7 text-zinc-800">
                      {activeCandidate.local_focus}
                    </p>
                  </div>

                  <details className="rounded-xl border border-zinc-200">
                    <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-700">
                      Evidence ({activeCandidate.evidence.length})
                    </summary>
                    <div className="border-t border-zinc-200 px-4 py-4">
                      {activeCandidate.evidence.length > 0 ? (
                        <div className="space-y-2">
                          {activeCandidate.evidence.map((item) => (
                            <p key={`${activeCandidate.candidate_id}:evidence:${item}`} className="text-sm leading-7 text-zinc-700">
                              - {item}
                            </p>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-zinc-400">No evidence lines.</p>
                      )}
                    </div>
                  </details>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-sm text-zinc-500">
                No candidate proposals for this scene.
              </div>
            )}
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-sm text-zinc-500">
            No SUB.1 proposals found.
          </div>
        )}
      </aside>
    </div>
  )
}

function Sub2StageView({
  artifact,
  scenePacketLog,
  preparedChapter,
}: {
  artifact: SubsceneStates
  scenePacketLog?: ScenePackets
  preparedChapter?: PreparedChapter
}) {
  const [activeSceneId, setActiveSceneId] = useState<string | null>(artifact.packets[0]?.scene_id ?? null)
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(artifact.packets[0]?.records[0]?.candidate_id ?? null)

  const paragraphs = preparedChapter?.raw_chapter.paragraphs ?? []
  const scenePacketMap = new Map(
    scenePacketLog?.packets.map((packet, index) => [
      packet.scene_id,
      { ...packet, accent: SCENE_ACCENTS[index % SCENE_ACCENTS.length] },
    ]) ?? [],
  )

  const statePackets = artifact.packets.map((packet, index) => {
    const scenePacket = scenePacketMap.get(packet.scene_id)
    const pidSet = new Set(scenePacket?.pids ?? [])
    const parsedSceneText = scenePacket?.scene_text_with_pid_markers
      ? parsePidMarkedText(scenePacket.scene_text_with_pid_markers)
      : []

    return {
      ...packet,
      scenePacket,
      accent: scenePacket?.accent ?? SCENE_ACCENTS[index % SCENE_ACCENTS.length],
      paragraphs: paragraphs.filter((paragraph) => pidSet.has(paragraph.pid)),
      parsedSceneText,
    }
  })

  const resolvedActiveSceneId = statePackets.some((packet) => packet.scene_id === activeSceneId)
    ? activeSceneId
    : (statePackets[0]?.scene_id ?? null)
  const activePacket = statePackets.find((packet) => packet.scene_id === resolvedActiveSceneId) ?? statePackets[0]
  const resolvedCandidateId = activePacket?.records.some((record) => record.candidate_id === activeCandidateId)
    ? activeCandidateId
    : (activePacket?.records[0]?.candidate_id ?? null)
  const activeRecord = activePacket?.records.find((record) => record.candidate_id === resolvedCandidateId) ?? activePacket?.records[0]

  const totalRecords = artifact.packets.reduce((sum, packet) => sum + packet.records.length, 0)
  const actionModes = countBy(
    artifact.packets.flatMap((packet) => packet.records.map((record) => record.action_mode).filter(Boolean)),
  )

  return (
    <div className="mt-4 grid min-h-0 flex-1 gap-5 overflow-hidden xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
      <section className="flex min-h-0 min-w-0 flex-col rounded-xl border border-zinc-200 bg-zinc-50 p-5">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Body</p>
            <h4 className="mt-1 text-base font-semibold text-zinc-900">
              {preparedChapter?.chapter_title ?? "Scene Text"}
            </h4>
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-xs text-zinc-500">
            {statePackets.length} scenes
          </span>
        </div>

        <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {statePackets.map((packet) => {
            const selected = activePacket?.scene_id === packet.scene_id
            return (
              <article
                key={packet.scene_id}
                onClick={() => setActiveSceneId(packet.scene_id)}
                className={`rounded-xl border border-zinc-200 border-l-4 px-4 py-4 transition-colors ${packet.accent} ${
                  selected ? "ring-2 ring-amber-300 ring-offset-1" : ""
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-white px-2 py-0.5 font-mono text-[11px] text-zinc-500">
                    {packet.scene_id}
                  </span>
                  {packet.scenePacket && (
                    <span className="text-xs text-zinc-400">
                      P{packet.scenePacket.start_pid}-P{packet.scenePacket.end_pid}
                    </span>
                  )}
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-zinc-600">
                    {packet.records.length} records
                  </span>
                </div>

                {packet.parsedSceneText.length > 0 ? (
                  <div className="mt-3 space-y-2.5">
                    {packet.parsedSceneText.map((line, index) => {
                      const isSelected =
                        !!activeRecord &&
                        activePacket?.scene_id === packet.scene_id &&
                        typeof line.pid === "number" &&
                        line.pid >= activeRecord.start_pid &&
                        line.pid <= activeRecord.end_pid

                      return (
                        <div
                          key={`${packet.scene_id}:line:${line.pidLabel ?? index}`}
                          className={`rounded-lg px-3 py-2 ${
                            isSelected ? "bg-sky-100/80" : "bg-transparent"
                          }`}
                        >
                          {line.pidLabel ? (
                            <div className="mb-1.5">
                              <span className="inline-flex rounded-full border border-zinc-200 bg-white px-2 py-0.5 font-mono text-[11px] text-zinc-400">
                                {line.pidLabel}
                              </span>
                            </div>
                          ) : null}
                          <p className="text-[15px] leading-7 text-zinc-700">
                            {line.body}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="mt-3 space-y-2">
                    {packet.paragraphs.map((paragraph) => {
                      const pid = paragraph.pid
                      const isSelected =
                        activeRecord &&
                        activePacket?.scene_id === packet.scene_id &&
                        pid >= activeRecord.start_pid &&
                        pid <= activeRecord.end_pid

                      return (
                        <p
                          key={`${packet.scene_id}:${pid}`}
                          className={`rounded-lg px-3 py-2 text-[15px] leading-7 ${
                            isSelected ? "bg-sky-100/80 text-zinc-900" : "text-zinc-700"
                          }`}
                        >
                          <span className="mr-2 font-mono text-xs text-zinc-400">P{pid}</span>
                          {paragraph.text}
                        </p>
                      )
                    })}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      </section>

      <aside className="min-h-0 space-y-4 overflow-y-auto pr-1">
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Result</p>
              <h4 className="mt-1 text-base font-semibold text-zinc-900">SUB.2 Subscene State Records</h4>
            </div>
            <span className="text-xs text-zinc-400">{artifact.model ?? artifact.method}</span>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
            <ResultMetaCard label="Scenes" value={String(artifact.packets.length)} />
            <ResultMetaCard label="Records" value={String(totalRecords)} />
            <ResultMetaCard label="Modes" value={actionModes || "-"} />
          </div>
        </div>

        {activePacket ? (
          <>
            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Scene Selector</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {statePackets.map((packet) => (
                  <button
                    key={`sub2-scene:${packet.scene_id}`}
                    type="button"
                    onClick={() => {
                      setActiveSceneId(packet.scene_id)
                      setActiveCandidateId(packet.records[0]?.candidate_id ?? null)
                    }}
                    className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                      activePacket.scene_id === packet.scene_id
                        ? "border-zinc-900 bg-zinc-900 text-white"
                        : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                    }`}
                  >
                    {packet.scene_id}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h5 className="text-[17px] font-semibold text-zinc-900">{activePacket.scene_id}</h5>
                  {activePacket.scenePacket && (
                    <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[12px] font-medium text-zinc-600">
                      P{activePacket.scenePacket.start_pid}-P{activePacket.scenePacket.end_pid}
                    </span>
                  )}
                </div>
                <span className="text-xs text-zinc-400">{activePacket.records.length} records</span>
              </div>

              <div className="mt-4 space-y-3">
                {activePacket.records.map((record) => {
                  const selected = activeRecord?.candidate_id === record.candidate_id
                  return (
                    <button
                      key={record.candidate_id}
                      type="button"
                      onClick={() => setActiveCandidateId(record.candidate_id)}
                      className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                        selected
                          ? "border-zinc-900 bg-zinc-50 shadow-sm"
                          : "border-zinc-200 bg-white hover:bg-zinc-50"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-[15px] font-semibold text-zinc-900">{record.label}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                              {record.action_mode}
                            </span>
                            <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700">
                              P{record.start_pid}-P{record.end_pid}
                            </span>
                          </div>
                        </div>
                        <span className="font-mono text-[11px] text-zinc-400">{record.candidate_id}</span>
                      </div>
                      {record.action_summary && (
                        <p className="mt-3 line-clamp-2 text-sm leading-6 text-zinc-600">
                          {record.action_summary}
                        </p>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            {activeRecord ? (
              <div className="rounded-xl border border-zinc-200 bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h5 className="text-lg font-semibold text-zinc-900">{activeRecord.label}</h5>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[12px] font-medium text-amber-700">
                        {activeRecord.action_mode}
                      </span>
                      <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[12px] font-medium text-blue-700">
                        P{activeRecord.start_pid}-P{activeRecord.end_pid}
                      </span>
                      <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[12px] font-medium text-zinc-600">
                        {activeRecord.candidate_id}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-5 space-y-4">
                  {activeRecord.local_goal && (
                    <div className="rounded-xl bg-emerald-50 px-4 py-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                        Local Goal
                      </p>
                      <p className="mt-2 text-[15px] leading-7 text-zinc-800">
                        {activeRecord.local_goal}
                      </p>
                    </div>
                  )}

                  <div className="rounded-xl bg-sky-50 px-4 py-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">
                      Action Summary
                    </p>
                    <p className="mt-2 text-[15px] leading-7 text-zinc-800">
                      {activeRecord.action_summary || "-"}
                    </p>
                  </div>

                  {activeRecord.problem_state && (
                    <div className="rounded-xl bg-rose-50 px-4 py-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">
                        Problem State
                      </p>
                      <p className="mt-2 text-[15px] leading-7 text-zinc-800">
                        {activeRecord.problem_state}
                      </p>
                    </div>
                  )}

                  <div className="grid gap-4 xl:grid-cols-2">
                    <div className="rounded-xl border border-zinc-200 px-4 py-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                        Causal Input
                      </p>
                      <p className="mt-2 text-sm leading-7 text-zinc-700">
                        {activeRecord.causal_input || "-"}
                      </p>
                    </div>
                    <div className="rounded-xl border border-zinc-200 px-4 py-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                        Causal Result
                      </p>
                      <p className="mt-2 text-sm leading-7 text-zinc-700">
                        {activeRecord.causal_result || "-"}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-2">
                    <div className="rounded-xl border border-zinc-200 px-4 py-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                        Narrative Importance
                      </p>
                      <p className="mt-2 text-sm leading-7 text-zinc-700">
                        {activeRecord.narrative_importance || "-"}
                      </p>
                    </div>
                    <div className="rounded-xl border border-zinc-200 px-4 py-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                        Emotional Tone
                      </p>
                      <p className="mt-2 text-sm leading-7 text-zinc-700">
                        {activeRecord.emotional_tone || "-"}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-2">
                    <div className="rounded-xl border border-zinc-200 px-4 py-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                        Active Cast
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {activeRecord.active_cast.length > 0 ? (
                          activeRecord.active_cast.map((name) => (
                            <span
                              key={`${activeRecord.candidate_id}:cast:${name}`}
                              className="rounded-full bg-blue-50 px-2.5 py-1 text-[12px] font-medium text-blue-700"
                            >
                              {name}
                            </span>
                          ))
                        ) : (
                          <span className="text-sm text-zinc-400">-</span>
                        )}
                      </div>
                    </div>
                    <div className="rounded-xl border border-zinc-200 px-4 py-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                        Key Objects
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {activeRecord.key_objects.length > 0 ? (
                          activeRecord.key_objects.map((item) => (
                            <span
                              key={`${activeRecord.candidate_id}:object:${item}`}
                              className="rounded-full bg-orange-50 px-2.5 py-1 text-[12px] font-medium text-orange-700"
                            >
                              {item}
                            </span>
                          ))
                        ) : (
                          <span className="text-sm text-zinc-400">-</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <details className="rounded-xl border border-zinc-200">
                    <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-700">
                      Evidence ({activeRecord.evidence.length})
                    </summary>
                    <div className="border-t border-zinc-200 px-4 py-4">
                      {activeRecord.evidence.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {activeRecord.evidence.map((item) => (
                            <span
                              key={`${activeRecord.candidate_id}:evidence:${item}`}
                              className="rounded-full bg-violet-50 px-2 py-0.5 font-mono text-[11px] text-violet-700"
                            >
                              {item}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-zinc-400">No evidence lines.</p>
                      )}
                    </div>
                  </details>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-sm text-zinc-500">
                No subscene state record for this scene.
              </div>
            )}
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-sm text-zinc-500">
            No SUB.2 records found.
          </div>
        )}
      </aside>
    </div>
  )
}

function Sub3StageView({
  artifact,
  scenePacketLog,
  proposalLog,
  stateLog,
  preparedChapter,
}: {
  artifact: ValidatedSubscenes
  scenePacketLog?: ScenePackets
  proposalLog?: SubsceneProposals
  stateLog?: SubsceneStates
  preparedChapter?: PreparedChapter
}) {
  const [activeSceneId, setActiveSceneId] = useState<string | null>(artifact.packets[0]?.scene_id ?? null)
  const [activeSubsceneId, setActiveSubsceneId] = useState<string | null>(
    artifact.packets[0]?.validated_subscenes[0]?.subscene_id ?? null,
  )

  const paragraphs = preparedChapter?.raw_chapter.paragraphs ?? []
  const scenePacketMap = new Map(
    scenePacketLog?.packets.map((packet, index) => [
      packet.scene_id,
      { ...packet, accent: SCENE_ACCENTS[index % SCENE_ACCENTS.length] },
    ]) ?? [],
  )
  const proposalMap = new Map(proposalLog?.packets.map((packet) => [packet.scene_id, packet]) ?? [])
  const stateMap = new Map(stateLog?.packets.map((packet) => [packet.scene_id, packet]) ?? [])

  const validatedPackets = artifact.packets.map((packet, index) => {
    const scenePacket = scenePacketMap.get(packet.scene_id)
    const proposalPacket = proposalMap.get(packet.scene_id)
    const statePacket = stateMap.get(packet.scene_id)
    const pidSet = new Set(scenePacket?.pids ?? [])
    const parsedSceneText = scenePacket?.scene_text_with_pid_markers
      ? parsePidMarkedText(scenePacket.scene_text_with_pid_markers)
      : []

    const sourceCandidateIds = new Set(
      packet.validated_subscenes.flatMap((subscene) => subscene.source_candidates ?? []),
    )
    const rejectedCandidates = (proposalPacket?.candidate_subscenes ?? []).filter(
      (candidate) => !sourceCandidateIds.has(candidate.candidate_id),
    )
    const stateRecordMap = new Map(
      (statePacket?.records ?? []).map((record) => [record.candidate_id, record]),
    )

    return {
      ...packet,
      scenePacket,
      proposalPacket,
      statePacket,
      stateRecordMap,
      rejectedCandidates,
      accent: scenePacket?.accent ?? SCENE_ACCENTS[index % SCENE_ACCENTS.length],
      paragraphs: paragraphs.filter((paragraph) => pidSet.has(paragraph.pid)),
      parsedSceneText,
    }
  })

  const resolvedActiveSceneId = validatedPackets.some((packet) => packet.scene_id === activeSceneId)
    ? activeSceneId
    : (validatedPackets[0]?.scene_id ?? null)
  const activePacket = validatedPackets.find((packet) => packet.scene_id === resolvedActiveSceneId) ?? validatedPackets[0]
  const resolvedSubsceneId = activePacket?.validated_subscenes.some((subscene) => subscene.subscene_id === activeSubsceneId)
    ? activeSubsceneId
    : (activePacket?.validated_subscenes[0]?.subscene_id ?? null)
  const activeSubscene =
    activePacket?.validated_subscenes.find((subscene) => subscene.subscene_id === resolvedSubsceneId) ??
    activePacket?.validated_subscenes[0]

  const totalSubscenes = artifact.packets.reduce((sum, packet) => sum + packet.validated_subscenes.length, 0)
  const mergedTotal = artifact.packets.reduce((sum, packet) => sum + packet.merged_count, 0)
  const rejectedTotal = artifact.packets.reduce((sum, packet) => sum + packet.rejected_count, 0)

  return (
    <div className="mt-4 grid min-h-0 flex-1 gap-5 overflow-hidden xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
      <section className="flex min-h-0 min-w-0 flex-col rounded-xl border border-zinc-200 bg-zinc-50 p-5">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Body</p>
            <h4 className="mt-1 text-base font-semibold text-zinc-900">
              {preparedChapter?.chapter_title ?? "Scene Text"}
            </h4>
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-xs text-zinc-500">
            {validatedPackets.length} scenes
          </span>
        </div>

        <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {validatedPackets.map((packet) => {
            const selected = activePacket?.scene_id === packet.scene_id
            return (
              <article
                key={packet.scene_id}
                onClick={() => setActiveSceneId(packet.scene_id)}
                className={`rounded-xl border border-zinc-200 border-l-4 px-4 py-4 transition-colors ${packet.accent} ${
                  selected ? "ring-2 ring-amber-300 ring-offset-1" : ""
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-white px-2 py-0.5 font-mono text-[11px] text-zinc-500">
                    {packet.scene_id}
                  </span>
                  {packet.scenePacket && (
                    <span className="text-xs text-zinc-400">
                      P{packet.scenePacket.start_pid}-P{packet.scenePacket.end_pid}
                    </span>
                  )}
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-zinc-600">
                    {packet.validated_subscenes.length} validated
                  </span>
                </div>

                {packet.parsedSceneText.length > 0 ? (
                  <div className="mt-3 space-y-2.5">
                    {packet.parsedSceneText.map((line, index) => {
                      const isSelected =
                        !!activeSubscene &&
                        activePacket?.scene_id === packet.scene_id &&
                        typeof line.pid === "number" &&
                        line.pid >= activeSubscene.start_pid &&
                        line.pid <= activeSubscene.end_pid

                      return (
                        <div
                          key={`${packet.scene_id}:line:${line.pidLabel ?? index}`}
                          className={`rounded-lg px-3 py-2 ${
                            isSelected ? "bg-emerald-100/80" : "bg-transparent"
                          }`}
                        >
                          {line.pidLabel ? (
                            <div className="mb-1.5">
                              <span className="inline-flex rounded-full border border-zinc-200 bg-white px-2 py-0.5 font-mono text-[11px] text-zinc-400">
                                {line.pidLabel}
                              </span>
                            </div>
                          ) : null}
                          <p className="text-[15px] leading-7 text-zinc-700">{line.body}</p>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="mt-3 space-y-2">
                    {packet.paragraphs.map((paragraph) => {
                      const pid = paragraph.pid
                      const isSelected =
                        activeSubscene &&
                        activePacket?.scene_id === packet.scene_id &&
                        pid >= activeSubscene.start_pid &&
                        pid <= activeSubscene.end_pid

                      return (
                        <p
                          key={`${packet.scene_id}:${pid}`}
                          className={`rounded-lg px-3 py-2 text-[15px] leading-7 ${
                            isSelected ? "bg-emerald-100/80 text-zinc-900" : "text-zinc-700"
                          }`}
                        >
                          <span className="mr-2 font-mono text-xs text-zinc-400">P{pid}</span>
                          {paragraph.text}
                        </p>
                      )
                    })}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      </section>

      <aside className="min-h-0 space-y-4 overflow-y-auto pr-1">
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Result</p>
              <h4 className="mt-1 text-base font-semibold text-zinc-900">SUB.3 Validated Subscenes</h4>
            </div>
            <span className="text-xs text-zinc-400">{artifact.model ?? artifact.method}</span>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
            <ResultMetaCard label="Validated" value={String(totalSubscenes)} />
            <ResultMetaCard label="Merged" value={String(mergedTotal)} />
            <ResultMetaCard label="Rejected" value={String(rejectedTotal)} />
          </div>
        </div>

        {activePacket ? (
          <>
            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Scene Selector</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {validatedPackets.map((packet) => (
                  <button
                    key={`sub3-scene:${packet.scene_id}`}
                    type="button"
                    onClick={() => {
                      setActiveSceneId(packet.scene_id)
                      setActiveSubsceneId(packet.validated_subscenes[0]?.subscene_id ?? null)
                    }}
                    className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                      activePacket.scene_id === packet.scene_id
                        ? "border-zinc-900 bg-zinc-900 text-white"
                        : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                    }`}
                  >
                    {packet.scene_id}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h5 className="text-[17px] font-semibold text-zinc-900">{activePacket.scene_id}</h5>
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[12px] font-medium text-emerald-700">
                    accepted {activePacket.accepted_count}
                  </span>
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[12px] font-medium text-amber-700">
                    merged {activePacket.merged_count}
                  </span>
                  <span className="rounded-full bg-rose-50 px-2.5 py-1 text-[12px] font-medium text-rose-700">
                    rejected {activePacket.rejected_count}
                  </span>
                </div>
                <span className="text-xs text-zinc-400">original {activePacket.original_count}</span>
              </div>

              <div className="mt-4 space-y-3">
                {activePacket.validated_subscenes.map((subscene) => {
                  const selected = activeSubscene?.subscene_id === subscene.subscene_id
                  const merged = subscene.source_candidates.length > 1 || subscene.decision === "merged"
                  return (
                    <button
                      key={subscene.subscene_id}
                      type="button"
                      onClick={() => setActiveSubsceneId(subscene.subscene_id)}
                      className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                        selected
                          ? "border-zinc-900 bg-zinc-50 shadow-sm"
                          : "border-zinc-200 bg-white hover:bg-zinc-50"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-[15px] font-semibold text-zinc-900">{subscene.label}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                              merged ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"
                            }`}>
                              {merged ? "merged" : "accepted"}
                            </span>
                            <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700">
                              P{subscene.start_pid}-P{subscene.end_pid}
                            </span>
                          </div>
                        </div>
                        <span className="font-mono text-[11px] text-zinc-400">{subscene.subscene_id}</span>
                      </div>
                      <p className="mt-3 line-clamp-2 text-sm leading-6 text-zinc-600">{subscene.headline}</p>
                      <p className="mt-2 text-xs text-zinc-400">
                        from {subscene.source_candidates.join(", ") || "-"}
                      </p>
                    </button>
                  )
                })}
              </div>
            </div>

            {activeSubscene ? (
              <div className="rounded-xl border border-zinc-200 bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h5 className="text-lg font-semibold text-zinc-900">{activeSubscene.label}</h5>
                    <p className="mt-2 text-[15px] leading-7 text-zinc-700">{activeSubscene.headline}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-[12px] font-medium ${
                        activeSubscene.source_candidates.length > 1 || activeSubscene.decision === "merged"
                          ? "bg-amber-50 text-amber-700"
                          : "bg-emerald-50 text-emerald-700"
                      }`}>
                        {activeSubscene.source_candidates.length > 1 || activeSubscene.decision === "merged"
                          ? "merged"
                          : "accepted"}
                      </span>
                      <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[12px] font-medium text-blue-700">
                        P{activeSubscene.start_pid}-P{activeSubscene.end_pid}
                      </span>
                      <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[12px] font-medium text-zinc-600">
                        {Math.round(activeSubscene.confidence * 100)}%
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-5 space-y-4">
                  <div className="rounded-xl bg-zinc-50 px-4 py-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      Source Candidates
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {activeSubscene.source_candidates.map((candidateId) => {
                        const sourceRecord = activePacket.stateRecordMap.get(candidateId)
                        return (
                          <span
                            key={`${activeSubscene.subscene_id}:source:${candidateId}`}
                            className="rounded-full bg-white px-2.5 py-1 text-[12px] font-medium text-zinc-700"
                            title={sourceRecord?.label ?? candidateId}
                          >
                            {sourceRecord?.label ?? candidateId}
                          </span>
                        )
                      })}
                    </div>
                  </div>

                  <div className="rounded-xl bg-sky-50 px-4 py-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Action Summary</p>
                    <p className="mt-2 text-[15px] leading-7 text-zinc-800">{activeSubscene.action_summary}</p>
                  </div>

                  {activeSubscene.local_goal && (
                    <div className="rounded-xl bg-emerald-50 px-4 py-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Local Goal</p>
                      <p className="mt-2 text-[15px] leading-7 text-zinc-800">{activeSubscene.local_goal}</p>
                    </div>
                  )}

                  <div className="grid gap-4 xl:grid-cols-2">
                    <div className="rounded-xl border border-zinc-200 px-4 py-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Problem State</p>
                      <p className="mt-2 text-sm leading-7 text-zinc-700">{activeSubscene.problem_state || "-"}</p>
                    </div>
                    <div className="rounded-xl border border-zinc-200 px-4 py-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Action Mode</p>
                      <p className="mt-2 text-sm leading-7 text-zinc-700">{activeSubscene.action_mode || "-"}</p>
                    </div>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-2">
                    <div className="rounded-xl border border-zinc-200 px-4 py-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Causal Input</p>
                      <p className="mt-2 text-sm leading-7 text-zinc-700">{activeSubscene.causal_input || "-"}</p>
                    </div>
                    <div className="rounded-xl border border-zinc-200 px-4 py-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Causal Result</p>
                      <p className="mt-2 text-sm leading-7 text-zinc-700">{activeSubscene.causal_result || "-"}</p>
                    </div>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-2">
                    <div className="rounded-xl border border-zinc-200 px-4 py-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Active Cast</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {activeSubscene.active_cast.length > 0 ? activeSubscene.active_cast.map((name) => (
                          <span
                            key={`${activeSubscene.subscene_id}:cast:${name}`}
                            className="rounded-full bg-blue-50 px-2.5 py-1 text-[12px] font-medium text-blue-700"
                          >
                            {name}
                          </span>
                        )) : <span className="text-sm text-zinc-400">-</span>}
                      </div>
                    </div>
                    <div className="rounded-xl border border-zinc-200 px-4 py-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Key Objects</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {activeSubscene.key_objects.length > 0 ? activeSubscene.key_objects.map((item) => (
                          <span
                            key={`${activeSubscene.subscene_id}:object:${item}`}
                            className="rounded-full bg-orange-50 px-2.5 py-1 text-[12px] font-medium text-orange-700"
                          >
                            {item}
                          </span>
                        )) : <span className="text-sm text-zinc-400">-</span>}
                      </div>
                    </div>
                  </div>

                  <details className="rounded-xl border border-zinc-200" open>
                    <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-700">
                      Validation Notes ({activeSubscene.validation_notes.length})
                    </summary>
                    <div className="border-t border-zinc-200 px-4 py-4">
                      {activeSubscene.validation_notes.length > 0 ? (
                        <div className="space-y-2">
                          {activeSubscene.validation_notes.map((note, index) => (
                            <p key={`${activeSubscene.subscene_id}:note:${index}`} className="text-sm leading-7 text-zinc-700">
                              - {note}
                            </p>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-zinc-400">No validation notes.</p>
                      )}
                    </div>
                  </details>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-sm text-zinc-500">
                No validated subscene for this scene.
              </div>
            )}

            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Rejected Candidates ({activePacket.rejectedCandidates.length})
              </p>
              {activePacket.rejectedCandidates.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {activePacket.rejectedCandidates.map((candidate) => {
                    const sourceRecord = activePacket.stateRecordMap.get(candidate.candidate_id)
                    return (
                      <div key={candidate.candidate_id} className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium text-rose-900">{candidate.label}</p>
                          <span className="font-mono text-[11px] text-rose-500">
                            P{candidate.start_pid}-P{candidate.end_pid}
                          </span>
                        </div>
                        {sourceRecord?.action_summary && (
                          <p className="mt-2 text-sm leading-6 text-rose-800">{sourceRecord.action_summary}</p>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="mt-3 text-sm text-zinc-400">No rejected candidates.</p>
              )}
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-sm text-zinc-500">
            No SUB.3 records found.
          </div>
        )}
      </aside>
    </div>
  )
}

const SUB4_INFO_META: Record<
  string,
  {
    pill: string
    panel: string
  }
> = {
  action: {
    pill: "bg-rose-50 text-rose-700 border border-rose-200",
    panel: "border-rose-200 bg-rose-50",
  },
  event: {
    pill: "bg-orange-50 text-orange-700 border border-orange-200",
    panel: "border-orange-200 bg-orange-50",
  },
  goal: {
    pill: "bg-emerald-50 text-emerald-700 border border-emerald-200",
    panel: "border-emerald-200 bg-emerald-50",
  },
  problem: {
    pill: "bg-amber-50 text-amber-700 border border-amber-200",
    panel: "border-amber-200 bg-amber-50",
  },
  object: {
    pill: "bg-violet-50 text-violet-700 border border-violet-200",
    panel: "border-violet-200 bg-violet-50",
  },
  why_matters: {
    pill: "bg-sky-50 text-sky-700 border border-sky-200",
    panel: "border-sky-200 bg-sky-50",
  },
  what_changed: {
    pill: "bg-cyan-50 text-cyan-700 border border-cyan-200",
    panel: "border-cyan-200 bg-cyan-50",
  },
}

const FINAL1_PANEL_META: Record<
  string,
  {
    pill: string
    panel: string
  }
> = {
  goal: {
    pill: "bg-emerald-50 text-emerald-700 border border-emerald-200",
    panel: "border-emerald-200 bg-emerald-50",
  },
  problem: {
    pill: "bg-amber-50 text-amber-700 border border-amber-200",
    panel: "border-amber-200 bg-amber-50",
  },
  what_changed: {
    pill: "bg-sky-50 text-sky-700 border border-sky-200",
    panel: "border-sky-200 bg-sky-50",
  },
  why_it_matters: {
    pill: "bg-cyan-50 text-cyan-700 border border-cyan-200",
    panel: "border-cyan-200 bg-cyan-50",
  },
  object: {
    pill: "bg-violet-50 text-violet-700 border border-violet-200",
    panel: "border-violet-200 bg-violet-50",
  },
}

const FINAL2_VISIBILITY_META: Record<
  string,
  {
    pill: string
    marker: string
  }
> = {
  placed: {
    pill: "bg-emerald-50 text-emerald-700 border border-emerald-200",
    marker: "bg-emerald-600",
  },
  approximate: {
    pill: "bg-amber-50 text-amber-700 border border-amber-200",
    marker: "bg-amber-500",
  },
  fallback: {
    pill: "bg-zinc-100 text-zinc-700 border border-zinc-200",
    marker: "bg-zinc-500",
  },
  not_visible: {
    pill: "bg-rose-50 text-rose-700 border border-rose-200",
    marker: "bg-rose-500",
  },
}

function Sub4StageView({
  artifact,
  scenePacketLog,
  validatedSubsceneLog,
  preparedChapter,
}: {
  artifact: InterventionPackages
  scenePacketLog?: ScenePackets
  validatedSubsceneLog?: ValidatedSubscenes
  preparedChapter?: PreparedChapter
}) {
  const [activeSceneId, setActiveSceneId] = useState<string | null>(artifact.packets[0]?.scene_id ?? null)
  const [activeUnitId, setActiveUnitId] = useState<string | null>(artifact.packets[0]?.subscene_ui_units[0]?.subscene_id ?? null)

  const paragraphs = preparedChapter?.raw_chapter.paragraphs ?? []
  const scenePacketMap = new Map(
    scenePacketLog?.packets.map((packet, index) => [
      packet.scene_id,
      { ...packet, accent: SCENE_ACCENTS[index % SCENE_ACCENTS.length] },
    ]) ?? [],
  )
  const validatedMap = new Map(validatedSubsceneLog?.packets.map((packet) => [packet.scene_id, packet]) ?? [])

  const packages = artifact.packets.map((packet, index) => {
    const scenePacket = scenePacketMap.get(packet.scene_id)
    const validatedPacket = validatedMap.get(packet.scene_id)
    const pidSet = new Set(scenePacket?.pids ?? [])
    const parsedSceneText = scenePacket?.scene_text_with_pid_markers
      ? parsePidMarkedText(scenePacket.scene_text_with_pid_markers)
      : []
    const validatedSubsceneMap = new Map(
      (validatedPacket?.validated_subscenes ?? []).map((subscene) => [subscene.subscene_id, subscene]),
    )

    return {
      ...packet,
      scenePacket,
      validatedPacket,
      validatedSubsceneMap,
      accent: scenePacket?.accent ?? SCENE_ACCENTS[index % SCENE_ACCENTS.length],
      paragraphs: paragraphs.filter((paragraph) => pidSet.has(paragraph.pid)),
      parsedSceneText,
    }
  })

  const resolvedActiveSceneId = packages.some((packet) => packet.scene_id === activeSceneId)
    ? activeSceneId
    : (packages[0]?.scene_id ?? null)
  const activePacket = packages.find((packet) => packet.scene_id === resolvedActiveSceneId) ?? packages[0]
  const resolvedActiveUnitId = activePacket?.subscene_ui_units.some((unit) => unit.subscene_id === activeUnitId)
    ? activeUnitId
    : (activePacket?.subscene_ui_units[0]?.subscene_id ?? null)
  const activeUnit =
    activePacket?.subscene_ui_units.find((unit) => unit.subscene_id === resolvedActiveUnitId) ??
    activePacket?.subscene_ui_units[0]
  const activeValidatedSubscene = activeUnit
    ? activePacket?.validatedSubsceneMap.get(activeUnit.subscene_id)
    : undefined
  const activeJumpTargets = new Set(
    (activeUnit?.jump_targets ?? [])
      .map((target) => {
        const match = String(target).match(/^P(\d+)$/)
        return match ? Number(match[1]) : null
      })
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
  )

  const totalUnits = artifact.packets.reduce((sum, packet) => sum + packet.subscene_ui_units.length, 0)
  const avgPriority =
    totalUnits > 0
      ? artifact.packets.reduce(
          (sum, packet) => sum + packet.subscene_ui_units.reduce((inner, unit) => inner + unit.priority, 0),
          0,
        ) / totalUnits
      : 0

  return (
    <div className="mt-4 grid min-h-0 flex-1 gap-5 overflow-hidden xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
      <section className="flex min-h-0 min-w-0 flex-col rounded-xl border border-zinc-200 bg-zinc-50 p-5">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Body</p>
            <h4 className="mt-1 text-base font-semibold text-zinc-900">
              {preparedChapter?.chapter_title ?? "Scene Text"}
            </h4>
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-xs text-zinc-500">
            {packages.length} scenes
          </span>
        </div>

        <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {packages.map((packet) => {
            const selected = activePacket?.scene_id === packet.scene_id
            return (
              <article
                key={packet.scene_id}
                onClick={() => setActiveSceneId(packet.scene_id)}
                className={`rounded-xl border border-zinc-200 border-l-4 px-4 py-4 transition-colors ${packet.accent} ${
                  selected ? "ring-2 ring-amber-300 ring-offset-1" : ""
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-white px-2 py-0.5 font-mono text-[11px] text-zinc-500">
                    {packet.scene_id}
                  </span>
                  {packet.scenePacket && (
                    <span className="text-xs text-zinc-400">
                      P{packet.scenePacket.start_pid}-P{packet.scenePacket.end_pid}
                    </span>
                  )}
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-zinc-600">
                    {packet.subscene_ui_units.length} units
                  </span>
                </div>

                {packet.parsedSceneText.length > 0 ? (
                  <div className="mt-3 space-y-2.5">
                    {packet.parsedSceneText.map((line, index) => {
                      const isSelected =
                        activePacket?.scene_id === packet.scene_id &&
                        typeof line.pid === "number" &&
                        activeJumpTargets.has(line.pid)

                      return (
                        <div
                          key={`${packet.scene_id}:line:${line.pidLabel ?? index}`}
                          className={`rounded-lg px-3 py-2 ${
                            isSelected ? "bg-blue-100/80" : "bg-transparent"
                          }`}
                        >
                          {line.pidLabel ? (
                            <div className="mb-1.5">
                              <span className="inline-flex rounded-full border border-zinc-200 bg-white px-2 py-0.5 font-mono text-[11px] text-zinc-400">
                                {line.pidLabel}
                              </span>
                            </div>
                          ) : null}
                          <p className="text-[15px] leading-7 text-zinc-700">{line.body}</p>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="mt-3 space-y-2">
                    {packet.paragraphs.map((paragraph) => {
                      const isSelected =
                        activePacket?.scene_id === packet.scene_id && activeJumpTargets.has(paragraph.pid)
                      return (
                        <p
                          key={`${packet.scene_id}:${paragraph.pid}`}
                          className={`rounded-lg px-3 py-2 text-[15px] leading-7 ${
                            isSelected ? "bg-blue-100/80 text-zinc-900" : "text-zinc-700"
                          }`}
                        >
                          <span className="mr-2 font-mono text-xs text-zinc-400">P{paragraph.pid}</span>
                          {paragraph.text}
                        </p>
                      )
                    })}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      </section>

      <aside className="min-h-0 space-y-4 overflow-y-auto pr-1">
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Result</p>
              <h4 className="mt-1 text-base font-semibold text-zinc-900">SUB.4 Reader Units</h4>
            </div>
            <span className="text-xs text-zinc-400">{artifact.model ?? artifact.method}</span>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
            <ResultMetaCard label="Scenes" value={String(artifact.packets.length)} />
            <ResultMetaCard label="Units" value={String(totalUnits)} />
            <ResultMetaCard label="Avg Priority" value={`${Math.round(avgPriority * 100)}%`} />
          </div>
        </div>

        {activePacket ? (
          <>
            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Scene Selector</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {packages.map((packet) => (
                  <button
                    key={`sub4-scene:${packet.scene_id}`}
                    type="button"
                    onClick={() => {
                      setActiveSceneId(packet.scene_id)
                      setActiveUnitId(packet.subscene_ui_units[0]?.subscene_id ?? null)
                    }}
                    className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                      activePacket.scene_id === packet.scene_id
                        ? "border-zinc-900 bg-zinc-900 text-white"
                        : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                    }`}
                  >
                    {packet.scene_id}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h5 className="text-[17px] font-semibold text-zinc-900">{activePacket.scene_id}</h5>
                  <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[12px] font-medium text-zinc-600">
                    {activePacket.subscene_ui_units.length} units
                  </span>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {activePacket.subscene_ui_units.map((unit) => {
                  const selected = activeUnit?.subscene_id === unit.subscene_id
                  return (
                    <button
                      key={unit.subscene_id}
                      type="button"
                      onClick={() => setActiveUnitId(unit.subscene_id)}
                      className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                        selected
                          ? "border-zinc-900 bg-zinc-50 shadow-sm"
                          : "border-zinc-200 bg-white hover:bg-zinc-50"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-[15px] font-semibold text-zinc-900">{unit.title}</p>
                          <p className="mt-2 line-clamp-2 text-sm leading-6 text-zinc-600">
                            {unit.one_line_summary}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-zinc-800">
                            {Math.round(unit.priority * 100)}%
                          </p>
                          <p className="text-[11px] text-zinc-400">priority</p>
                        </div>
                      </div>
                      <div className="mt-3 h-2 rounded-full bg-zinc-200">
                        <div
                          className="h-2 rounded-full bg-orange-500"
                          style={{ width: `${Math.max(6, Math.min(100, unit.priority * 100))}%` }}
                        />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {unit.jump_targets.map((target) => (
                          <span
                            key={`${unit.subscene_id}:jump:${target}`}
                            className="rounded-full bg-violet-50 px-2 py-0.5 font-mono text-[11px] text-violet-700"
                          >
                            {target}
                          </span>
                        ))}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {activeUnit ? (
              <div className="rounded-xl border border-zinc-200 bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h5 className="text-lg font-semibold text-zinc-900">{activeUnit.title}</h5>
                    <p className="mt-2 text-[15px] leading-7 text-zinc-700">{activeUnit.one_line_summary}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[12px] font-medium text-zinc-600">
                        {activeUnit.subscene_id}
                      </span>
                      <span className="rounded-full bg-orange-50 px-2.5 py-1 text-[12px] font-medium text-orange-700">
                        {Math.round(activeUnit.priority * 100)}%
                      </span>
                    </div>
                  </div>
                </div>

                {activeValidatedSubscene && (
                  <div className="mt-4 rounded-xl bg-sky-50 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Validated Subscene</p>
                    <p className="mt-2 text-sm leading-6 text-zinc-700">{activeValidatedSubscene.headline}</p>
                  </div>
                )}

                <div className="mt-5 space-y-5">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      On Image — Cast Buttons
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {activeUnit.cast_buttons.map((button) => (
                        <span
                          key={`${activeUnit.subscene_id}:castchip:${button.name}`}
                          className="rounded-full bg-blue-600 px-3 py-1.5 text-[13px] font-semibold text-white"
                        >
                          {button.name}
                        </span>
                      ))}
                    </div>
                    <div className="mt-4 space-y-3">
                      {activeUnit.cast_buttons.map((button) => (
                        <details
                          key={`${activeUnit.subscene_id}:cast:${button.name}`}
                          className="rounded-xl border border-zinc-200"
                        >
                          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-800">
                            {button.name} — {button.role}
                          </summary>
                          <div className="border-t border-zinc-200 px-4 py-4">
                            <p className="text-sm leading-7 text-zinc-700">{button.reveal}</p>
                          </div>
                        </details>
                      ))}
                      {activeUnit.cast_buttons.length === 0 && (
                        <p className="text-sm text-zinc-400">No cast buttons.</p>
                      )}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      Below Image — Info Buttons
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {activeUnit.info_buttons.map((button, index) => {
                        const meta = SUB4_INFO_META[button.button_type] ?? {
                          pill: "bg-zinc-50 text-zinc-700 border border-zinc-200",
                          panel: "border-zinc-200 bg-zinc-50",
                        }
                        return (
                          <span
                            key={`${activeUnit.subscene_id}:infopill:${index}`}
                            className={`rounded-full px-3 py-1.5 text-[13px] font-medium ${meta.pill}`}
                          >
                            {button.label}
                          </span>
                        )
                      })}
                    </div>
                    <div className="mt-4 grid gap-3 xl:grid-cols-2">
                      {activeUnit.info_buttons.map((button, index) => {
                        const meta = SUB4_INFO_META[button.button_type] ?? {
                          pill: "bg-zinc-50 text-zinc-700 border border-zinc-200",
                          panel: "border-zinc-200 bg-zinc-50",
                        }
                        return (
                          <details
                            key={`${activeUnit.subscene_id}:info:${index}`}
                            className={`rounded-xl border ${meta.panel}`}
                          >
                            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-800">
                              {button.label}
                            </summary>
                            <div className="border-t border-white/60 px-4 py-4">
                              <p className="text-sm leading-7 text-zinc-700">{button.reveal}</p>
                            </div>
                          </details>
                        )
                      })}
                      {activeUnit.info_buttons.length === 0 && (
                        <p className="text-sm text-zinc-400">No info buttons.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-sm text-zinc-500">
                No reader unit for this scene.
              </div>
            )}
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-sm text-zinc-500">
            No SUB.4 packages found.
          </div>
        )}
      </aside>
    </div>
  )
}

function Final1StageView({
  artifact,
  scenePacketLog,
}: {
  artifact: SceneReaderPackageLog
  scenePacketLog?: ScenePackets
}) {
  const [activeSceneId, setActiveSceneId] = useState<string | null>(artifact.packets[0]?.scene_id ?? null)
  const [activeSubsceneId, setActiveSubsceneId] = useState<string | null>(
    artifact.packets[0]?.default_active_subscene_id ?? artifact.packets[0]?.subscene_nav[0]?.subscene_id ?? null,
  )

  const scenePacketMap = new Map(scenePacketLog?.packets.map((packet) => [packet.scene_id, packet]) ?? [])
  const packets = artifact.packets.map((packet) => ({
    ...packet,
    scenePacket: scenePacketMap.get(packet.scene_id),
    parsedSceneText: scenePacketMap.get(packet.scene_id)?.scene_text_with_pid_markers
      ? parsePidMarkedText(scenePacketMap.get(packet.scene_id)!.scene_text_with_pid_markers)
      : packet.body_paragraphs.map((body) => ({ pid: null, pidLabel: null, body })),
  }))

  const activePacket =
    packets.find((packet) => packet.scene_id === activeSceneId) ??
    packets[0]
  const activeSubscene =
    activePacket?.subscene_nav.find((item) => item.subscene_id === activeSubsceneId) ??
    activePacket?.subscene_nav.find((item) => item.subscene_id === activePacket.default_active_subscene_id) ??
    activePacket?.subscene_nav[0]
  const activeView = activeSubscene
    ? activePacket?.subscene_views[activeSubscene.subscene_id]
    : undefined

  return (
    <div className="mt-4 grid min-h-0 flex-1 gap-5 overflow-hidden xl:grid-cols-[minmax(0,1.15fr)_minmax(380px,0.85fr)]">
      <section className="flex min-h-0 min-w-0 flex-col rounded-xl border border-zinc-200 bg-zinc-50 p-5">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Body</p>
            <h4 className="mt-1 text-base font-semibold text-zinc-900">{activePacket?.scene_title || activePacket?.scene_id}</h4>
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-xs text-zinc-500">
            {artifact.packets.length} scenes
          </span>
        </div>

        <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {packets.map((packet) => {
            const selected = packet.scene_id === activePacket?.scene_id
            const selectedBodySet =
              selected && activeSubscene ? new Set(activeSubscene.body_paragraphs) : new Set<string>()

            return (
              <article
                key={packet.scene_id}
                onClick={() => {
                  setActiveSceneId(packet.scene_id)
                  setActiveSubsceneId(packet.default_active_subscene_id || packet.subscene_nav[0]?.subscene_id || null)
                }}
                className={`rounded-xl border border-zinc-200 px-4 py-4 transition-colors ${
                  selected ? "border-zinc-900 bg-white shadow-sm" : "bg-white"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-mono text-[11px] text-zinc-500">
                    {packet.scene_id}
                  </span>
                  {packet.scenePacket && (
                    <span className="text-xs text-zinc-400">
                      P{packet.scenePacket.start_pid}-P{packet.scenePacket.end_pid}
                    </span>
                  )}
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600">
                    {packet.subscene_nav.length} subscenes
                  </span>
                </div>
                <div className="mt-3 space-y-2.5">
                  {packet.parsedSceneText.map((line, index) => {
                    const isSelected = selected && selectedBodySet.has(line.body)
                    return (
                      <div
                        key={`${packet.scene_id}:body:${line.pidLabel ?? index}`}
                        className={`rounded-lg px-3 py-2 ${isSelected ? "bg-blue-100/80" : "bg-transparent"}`}
                      >
                        {line.pidLabel ? (
                          <div className="mb-1.5">
                            <span className="inline-flex rounded-full border border-zinc-200 bg-white px-2 py-0.5 font-mono text-[11px] text-zinc-400">
                              {line.pidLabel}
                            </span>
                          </div>
                        ) : null}
                        <p className="text-[15px] leading-7 text-zinc-700">{line.body}</p>
                      </div>
                    )
                  })}
                </div>
              </article>
            )
          })}
        </div>
      </section>

      <aside className="min-h-0 space-y-4 overflow-y-auto pr-1">
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Result</p>
              <h4 className="mt-1 text-base font-semibold text-zinc-900">FINAL.1 Reader Package</h4>
            </div>
            <span className="text-xs text-zinc-400">{artifact.method}</span>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
            <ResultMetaCard label="Scenes" value={String(artifact.packets.length)} />
            <ResultMetaCard
              label="Subscenes"
              value={String(artifact.packets.reduce((sum, packet) => sum + packet.subscene_nav.length, 0))}
            />
            <ResultMetaCard
              label="Characters"
              value={String(artifact.packets.reduce((sum, packet) => sum + packet.visual.overlay_characters.length, 0))}
            />
          </div>
        </div>

        {activePacket ? (
          <>
            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Scene Selector</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {packets.map((packet) => (
                  <button
                    key={`final1-scene:${packet.scene_id}`}
                    type="button"
                    onClick={() => {
                      setActiveSceneId(packet.scene_id)
                      setActiveSubsceneId(packet.default_active_subscene_id || packet.subscene_nav[0]?.subscene_id || null)
                    }}
                    className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                      packet.scene_id === activePacket.scene_id
                        ? "border-zinc-900 bg-zinc-900 text-white"
                        : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                    }`}
                  >
                    {packet.scene_id}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h5 className="text-lg font-semibold text-zinc-900">{activePacket.scene_title || activePacket.scene_id}</h5>
                  <p className="mt-2 text-sm leading-6 text-zinc-600">{activePacket.scene_summary}</p>
                </div>
                <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-600">
                  {activePacket.visual.mode}
                </span>
              </div>

              <div className="mt-4 overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50">
                {activePacket.visual.image_path ? (
                  <div className="flex h-[420px] items-center justify-center bg-zinc-100/70 p-3">
                    <img
                      src={activePacket.visual.image_path}
                      alt={`${activePacket.scene_id} visual`}
                      className="h-full w-full object-contain"
                    />
                  </div>
                ) : (
                  <div className="flex h-[240px] items-center justify-center px-6 text-center text-sm text-zinc-500">
                    Blueprint preview only. No rendered image attached.
                  </div>
                )}
              </div>

              {activePacket.visual.chips.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {activePacket.visual.chips.map((chip) => (
                    <span key={`${activePacket.scene_id}:chip:${chip}`} className="rounded-full bg-violet-50 px-2.5 py-1 text-[12px] font-medium text-violet-700">
                      {chip}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Subscene Selector</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {activePacket.subscene_nav.map((item) => (
                  <button
                    key={`final1-subscene:${item.subscene_id}`}
                    type="button"
                    onClick={() => setActiveSubsceneId(item.subscene_id)}
                    className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                      item.subscene_id === activeSubscene?.subscene_id
                        ? "border-zinc-900 bg-zinc-900 text-white"
                        : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {activeSubscene && activeView ? (
              <div className="rounded-xl border border-zinc-200 bg-white p-5">
                <h5 className="text-lg font-semibold text-zinc-900">{activeSubscene.label}</h5>
                <p className="mt-2 text-[15px] leading-7 text-zinc-700">{activeView.headline}</p>

                <div className="mt-5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Buttons Under Image
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {activePacket.visual.overlay_characters.map((character) => (
                      <span
                        key={`${activePacket.scene_id}:char:${character.character_id}`}
                        className="rounded-full bg-blue-600 px-3 py-1.5 text-[13px] font-semibold text-white"
                      >
                        {character.label}
                      </span>
                    ))}
                    {activeView.buttons.map((button) => {
                      const meta = FINAL1_PANEL_META[button.key] ?? {
                        pill: "bg-zinc-50 text-zinc-700 border border-zinc-200",
                        panel: "border-zinc-200 bg-zinc-50",
                      }
                      return (
                        <span
                          key={`${activeSubscene.subscene_id}:button:${button.key}`}
                          className={`rounded-full px-3 py-1.5 text-[13px] font-medium ${meta.pill}`}
                        >
                          {button.label}
                        </span>
                      )
                    })}
                  </div>
                </div>

                <div className="mt-5 space-y-3">
                  {activePacket.visual.overlay_characters.map((character) => {
                    const text = activePacket.character_panels[character.panel_key]?.[activeSubscene.subscene_id]
                    return (
                      <details
                        key={`${activePacket.scene_id}:charpanel:${character.character_id}`}
                        className="rounded-xl border border-zinc-200"
                      >
                        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-800">
                          {character.label}
                        </summary>
                        <div className="border-t border-zinc-200 px-4 py-4">
                          <p className="text-sm leading-7 text-zinc-700">{text || "No character note for this subscene."}</p>
                        </div>
                      </details>
                    )
                  })}

                  {activeView.buttons.map((button) => {
                    const meta = FINAL1_PANEL_META[button.key] ?? {
                      pill: "bg-zinc-50 text-zinc-700 border border-zinc-200",
                      panel: "border-zinc-200 bg-zinc-50",
                    }
                    return (
                      <details
                        key={`${activeSubscene.subscene_id}:panel:${button.key}`}
                        className={`rounded-xl border ${meta.panel}`}
                      >
                        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-800">
                          {button.label}
                        </summary>
                        <div className="border-t border-white/60 px-4 py-4">
                          <p className="text-sm leading-7 text-zinc-700">
                            {activeView.panels[button.key] || "No panel text."}
                          </p>
                        </div>
                      </details>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-sm text-zinc-500">
                No FINAL.1 subscene view found.
              </div>
            )}
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-sm text-zinc-500">
            No FINAL.1 packets found.
          </div>
        )}
      </aside>
    </div>
  )
}

function Final2StageView({
  artifact,
  sceneReaderLog,
  scenePacketLog,
}: {
  artifact: OverlayRefinementResult
  sceneReaderLog?: SceneReaderPackageLog
  scenePacketLog?: ScenePackets
}) {
  const [activeSceneId, setActiveSceneId] = useState<string | null>(artifact.scenes[0]?.scene_id ?? null)
  const imageFrameRef = useRef<HTMLDivElement | null>(null)
  const [imageMetrics, setImageMetrics] = useState({
    naturalWidth: 0,
    naturalHeight: 0,
    containerWidth: 0,
    containerHeight: 0,
  })

  const readerMap = new Map(sceneReaderLog?.packets.map((packet) => [packet.scene_id, packet]) ?? [])
  const scenePacketMap = new Map(scenePacketLog?.packets.map((packet) => [packet.scene_id, packet]) ?? [])
  const scenes = artifact.scenes.map((scene) => {
    const readerPacket = readerMap.get(scene.scene_id)
    const scenePacket = scenePacketMap.get(scene.scene_id)
    return {
      ...scene,
      imageSrc: scene.image_path || readerPacket?.visual.image_path,
      scenePacket,
      parsedSceneText: scenePacket?.scene_text_with_pid_markers
        ? parsePidMarkedText(scenePacket.scene_text_with_pid_markers)
        : readerPacket?.body_paragraphs.map((body) => ({ pid: null, pidLabel: null, body })) ?? [],
    }
  })

  const activeScene = scenes.find((scene) => scene.scene_id === activeSceneId) ?? scenes[0]
  const containedRect = getContainedImageRect(imageMetrics)

  useEffect(() => {
    const element = imageFrameRef.current
    if (!element || typeof ResizeObserver === "undefined") return

    const update = () => {
      setImageMetrics((prev) => ({
        ...prev,
        containerWidth: element.clientWidth,
        containerHeight: element.clientHeight,
      }))
    }

    update()
    const observer = new ResizeObserver(() => update())
    observer.observe(element)
    return () => observer.disconnect()
  }, [activeScene?.scene_id])

  return (
    <div className="mt-4 grid min-h-0 flex-1 gap-5 overflow-hidden xl:grid-cols-[minmax(0,1.15fr)_minmax(380px,0.85fr)]">
      <section className="flex min-h-0 min-w-0 flex-col rounded-xl border border-zinc-200 bg-zinc-50 p-5">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Body</p>
            <h4 className="mt-1 text-base font-semibold text-zinc-900">{activeScene?.scene_id ?? "Scene"}</h4>
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-xs text-zinc-500">
            {artifact.scenes.length} scenes
          </span>
        </div>

        <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {scenes.map((scene) => {
            const selected = scene.scene_id === activeScene?.scene_id
            return (
              <article
                key={scene.scene_id}
                onClick={() => setActiveSceneId(scene.scene_id)}
                className={`rounded-xl border border-zinc-200 px-4 py-4 transition-colors ${
                  selected ? "border-zinc-900 bg-white shadow-sm" : "bg-white"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-mono text-[11px] text-zinc-500">
                    {scene.scene_id}
                  </span>
                  {scene.scenePacket && (
                    <span className="text-xs text-zinc-400">
                      P{scene.scenePacket.start_pid}-P{scene.scenePacket.end_pid}
                    </span>
                  )}
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600">
                    {scene.characters.length} markers
                  </span>
                </div>
                <div className="mt-3 space-y-2.5">
                  {scene.parsedSceneText.map((line, index) => (
                    <div key={`${scene.scene_id}:body:${line.pidLabel ?? index}`} className="rounded-lg px-3 py-2">
                      {line.pidLabel ? (
                        <div className="mb-1.5">
                          <span className="inline-flex rounded-full border border-zinc-200 bg-white px-2 py-0.5 font-mono text-[11px] text-zinc-400">
                            {line.pidLabel}
                          </span>
                        </div>
                      ) : null}
                      <p className="text-[15px] leading-7 text-zinc-700">{line.body}</p>
                    </div>
                  ))}
                </div>
              </article>
            )
          })}
        </div>
      </section>

      <aside className="min-h-0 space-y-4 overflow-y-auto pr-1">
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Result</p>
              <h4 className="mt-1 text-base font-semibold text-zinc-900">FINAL.2 Overlay Refinement</h4>
            </div>
            <span className="text-xs text-zinc-400">{artifact.method}</span>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
            <ResultMetaCard label="Scenes" value={String(artifact.scenes.length)} />
            <ResultMetaCard
              label="Placed"
              value={String(
                artifact.scenes.reduce(
                  (sum, scene) => sum + scene.characters.filter((item) => item.visibility === "placed").length,
                  0,
                ),
              )}
            />
            <ResultMetaCard
              label="Approx/Fallback"
              value={String(
                artifact.scenes.reduce(
                  (sum, scene) =>
                    sum +
                    scene.characters.filter(
                      (item) => item.visibility === "approximate" || item.visibility === "fallback",
                    ).length,
                  0,
                ),
              )}
            />
          </div>
        </div>

        {activeScene ? (
          <>
            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Scene Selector</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {scenes.map((scene) => (
                  <button
                    key={`final2-scene:${scene.scene_id}`}
                    type="button"
                    onClick={() => setActiveSceneId(scene.scene_id)}
                    className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                      scene.scene_id === activeScene.scene_id
                        ? "border-zinc-900 bg-zinc-900 text-white"
                        : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                    }`}
                  >
                    {scene.scene_id}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h5 className="text-lg font-semibold text-zinc-900">{activeScene.scene_id}</h5>
                <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-600">
                  {activeScene.characters.length} placements
                </span>
              </div>

              <div className="mt-4 overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50">
                {activeScene.imageSrc ? (
                  <div className="relative flex h-[520px] items-center justify-center bg-zinc-100/70 p-3 2xl:h-[620px]">
                    <div ref={imageFrameRef} className="relative h-full w-full">
                      <img
                        src={activeScene.imageSrc}
                        alt={`${activeScene.scene_id} overlay`}
                        className="h-full w-full object-contain"
                        onLoad={(event) => {
                          const target = event.currentTarget
                          setImageMetrics((prev) => ({
                            ...prev,
                            naturalWidth: target.naturalWidth,
                            naturalHeight: target.naturalHeight,
                            containerWidth: imageFrameRef.current?.clientWidth ?? prev.containerWidth,
                            containerHeight: imageFrameRef.current?.clientHeight ?? prev.containerHeight,
                          }))
                        }}
                      />
                      <div className="pointer-events-none absolute inset-0">
                        {activeScene.characters.map((character) => {
                          const meta = FINAL2_VISIBILITY_META[character.visibility] ?? FINAL2_VISIBILITY_META.fallback
                          const left =
                            containedRect.left +
                            (Math.max(0, Math.min(100, character.anchor_x)) / 100) * containedRect.width
                          const top =
                            containedRect.top +
                            (Math.max(0, Math.min(100, character.anchor_y)) / 100) * containedRect.height
                          const bbox = character.bbox_norm
                            ? {
                                left: containedRect.left + (character.bbox_norm.x / 100) * containedRect.width,
                                top: containedRect.top + (character.bbox_norm.y / 100) * containedRect.height,
                                width: (character.bbox_norm.w / 100) * containedRect.width,
                                height: (character.bbox_norm.h / 100) * containedRect.height,
                              }
                            : null

                          return (
                            <div
                              key={`${activeScene.scene_id}:marker:${character.character_id}`}
                              className="absolute"
                              style={{ left, top, transform: "translate(-50%, -50%)" }}
                            >
                              {bbox ? (
                                <div
                                  className="absolute rounded border-2 border-white/80 shadow-sm"
                                  style={{
                                    left: bbox.left - left,
                                    top: bbox.top - top,
                                    width: bbox.width,
                                    height: bbox.height,
                                  }}
                                />
                              ) : null}
                              <div className="flex items-center gap-2">
                                <span className={`h-3.5 w-3.5 rounded-full ring-2 ring-white ${meta.marker}`} />
                                <span className="rounded-full bg-white/95 px-2.5 py-1 text-[12px] font-medium text-zinc-800 shadow-sm">
                                  {character.label}
                                </span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-[320px] items-center justify-center px-6 text-center text-sm text-zinc-500">
                    No scene image available for overlay preview.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Placement List</p>
              <div className="mt-3 space-y-3">
                {activeScene.characters.map((character) => {
                  const meta = FINAL2_VISIBILITY_META[character.visibility] ?? FINAL2_VISIBILITY_META.fallback
                  return (
                    <div
                      key={`${activeScene.scene_id}:placement:${character.character_id}`}
                      className="rounded-xl border border-zinc-200 px-4 py-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-zinc-900">{character.label}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.pill}`}>
                              {character.visibility}
                            </span>
                            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600">
                              {character.source}
                            </span>
                            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600">
                              {Math.round(character.confidence * 100)}%
                            </span>
                          </div>
                        </div>
                        <span className="font-mono text-[11px] text-zinc-400">
                          x {character.anchor_x.toFixed(1)} / y {character.anchor_y.toFixed(1)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-zinc-700">{character.reason || "-"}</p>
                    </div>
                  )
                })}
                {activeScene.characters.length === 0 && (
                  <p className="text-sm text-zinc-400">No overlay refinement characters found.</p>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-sm text-zinc-500">
            No FINAL.2 scenes found.
          </div>
        )}
      </aside>
    </div>
  )
}

export default function PipelineRunner({ docId, chapterId, runId, onRunIdChange }: Props) {
  const [stages, setStages] = useState<StageMap>(() => createInitialStageMap())
  const [results, setResults] = useState<StageResultMap>({})
  const [running, setRunning] = useState(false)
  const [loadingResults, setLoadingResults] = useState(false)
  const [deletingStageId, setDeletingStageId] = useState<StageId | null>(null)
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
      const savedStageModels = extractSavedStageModels(raw)
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
      setStageModels((prev) =>
        Object.keys(savedStageModels).length > 0
          ? { ...createInitialStageModels(), ...savedStageModels }
          : prev,
      )
    } finally {
      setLoadingResults(false)
    }
  }, [chapterId, docId, runId])

  useEffect(() => {
    setStages(createInitialStageMap())
    setResults({})
    setSelectedStageId("PRE.1")
    setStageModels(createInitialStageModels())
  }, [chapterId, docId])

  useEffect(() => {
    void refreshResults()
  }, [refreshResults])

  function updateStageModel(stageId: StageId, value: string) {
    const nextModels = { ...stageModels, [stageId]: value }
    setStageModels(nextModels)
    void saveRunStageModels(docId, chapterId, runId, nextModels)
  }

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
    await saveRunStageModels(docId, chapterId, nextRunId, stageModels)

    const nextResults = filterResultsByStages(currentResults, preservedStages)
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
    if (targetRunId !== currentRunId) {
      onRunIdChange?.(targetRunId)
    }

    try {
      const model = stage.usesModel ? stageModels[stageId]?.trim() : undefined
      await saveRunStageModels(docId, chapterId, targetRunId, stageModels)
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

  async function handleDeleteStage(stageId: StageId) {
    if (deletingStageId || results[stageId] === undefined) return
    const confirmed = window.confirm(`Delete ${stageId} result from the current run?`)
    if (!confirmed) return

    setDeletingStageId(stageId)
    try {
      await deleteStageResult(docId, chapterId, runId, stageId)
      await refreshResults()
    } finally {
      setDeletingStageId(null)
    }
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
  const selectedLLMTrials = extractLLMTrials(selectedResult)
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
  const selectedMentionCandidates =
    selectedStageId === "ENT.1" && selectedResult && typeof selectedResult === "object"
      ? (selectedResult as MentionCandidates)
      : undefined
  const selectedFilteredMentions =
    selectedStageId === "ENT.2" && selectedResult && typeof selectedResult === "object"
      ? (selectedResult as FilteredMentions)
      : undefined
  const selectedEntityGraph =
    selectedStageId === "ENT.3" && selectedResult && typeof selectedResult === "object"
      ? (selectedResult as EntityGraph)
      : undefined
  const selectedStateFrames =
    selectedStageId === "STATE.1" && selectedResult && typeof selectedResult === "object"
      ? (selectedResult as StateFrames)
      : undefined
  const selectedValidatedStateFrames =
    selectedStageId === "STATE.2" && selectedResult && typeof selectedResult === "object"
      ? (selectedResult as RefinedStateFrames)
      : undefined
  const selectedSceneBoundaries =
    selectedStageId === "STATE.3" && selectedResult && typeof selectedResult === "object"
      ? (selectedResult as SceneBoundaries)
      : undefined
  const selectedSceneIndexDraft =
    selectedStageId === "SCENE.2" && selectedResult && typeof selectedResult === "object"
      ? (selectedResult as SceneIndexDraft)
      : undefined
  const selectedGroundedSceneModel =
    selectedStageId === "SCENE.3" && selectedResult && typeof selectedResult === "object"
      ? (selectedResult as GroundedSceneModel)
      : undefined
  const selectedScenePackets =
    selectedStageId === "SCENE.1" && selectedResult && typeof selectedResult === "object"
      ? (selectedResult as ScenePackets)
      : undefined
  const selectedVisualGrounding =
    selectedStageId === "VIS.1" && selectedResult && typeof selectedResult === "object"
      ? (selectedResult as VisualGrounding)
      : undefined
  const selectedStageBlueprint =
    selectedStageId === "VIS.2" && selectedResult && typeof selectedResult === "object"
      ? (selectedResult as StageBlueprint)
      : undefined
  const selectedSubsceneProposals =
    selectedStageId === "SUB.1" && selectedResult && typeof selectedResult === "object"
      ? (selectedResult as SubsceneProposals)
      : undefined
  const selectedSubsceneStates =
    selectedStageId === "SUB.2" && selectedResult && typeof selectedResult === "object"
      ? (selectedResult as SubsceneStates)
      : undefined
  const selectedValidatedSubscenes =
    selectedStageId === "SUB.3" && selectedResult && typeof selectedResult === "object"
      ? (selectedResult as ValidatedSubscenes)
      : undefined
  const selectedInterventionPackages =
    selectedStageId === "SUB.4" && selectedResult && typeof selectedResult === "object"
      ? (selectedResult as InterventionPackages)
      : undefined
  const selectedSceneReaderPackage =
    selectedStageId === "FINAL.1" && selectedResult && typeof selectedResult === "object"
      ? (selectedResult as SceneReaderPackageLog)
      : undefined
  const selectedOverlayRefinement =
    selectedStageId === "FINAL.2" && selectedResult && typeof selectedResult === "object"
      ? (selectedResult as OverlayRefinementResult)
      : undefined
  const selectedRenderPackage =
    selectedStageId === "VIS.3" && selectedResult && typeof selectedResult === "object"
      ? (selectedResult as RenderPackage)
      : undefined
  const selectedRenderedImages =
    selectedStageId === "VIS.4" && selectedResult && typeof selectedResult === "object"
      ? (selectedResult as RenderedImages)
      : undefined
  const latestStageWithResult = [...PIPELINE_STAGES]
    .reverse()
    .find((stage) => results[stage.id] !== undefined)?.id
  const canDeleteSelectedStage =
    selectedResult !== undefined &&
    latestStageWithResult === selectedStageId &&
    deletingStageId === null &&
    !running
  const selectedStageDeleteHelp =
    selectedResult === undefined
      ? "No saved result for this stage."
      : latestStageWithResult !== selectedStageId
        ? `Only the latest saved stage can be deleted. Current latest: ${latestStageWithResult ?? "-"}`
        : "Delete this stage result from the current run."

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

      <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-[480px_minmax(0,1fr)]">
        <aside className="min-h-0">
          <div className="h-full space-y-1 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-2">
            <div className="px-3 py-2">
              <p className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Stages</p>
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
                      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
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
                        className="flex-1 text-left text-[15px] text-zinc-700"
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
                      <button
                        type="button"
                        onClick={() => void handleDeleteStage(stage.id)}
                        disabled={
                          running ||
                          deletingStageId !== null ||
                          results[stage.id] === undefined ||
                          latestStageWithResult !== stage.id
                        }
                        title={
                          results[stage.id] === undefined
                            ? "No saved result for this stage."
                            : latestStageWithResult !== stage.id
                              ? `Only the latest saved stage can be deleted. Current latest: ${latestStageWithResult ?? "-"}`
                              : "Delete this stage result from the current run."
                        }
                        className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-30"
                      >
                        {deletingStageId === stage.id ? "..." : "Delete"}
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
                          onChange={(event) => updateStageModel(stage.id, event.target.value)}
                          onClick={(event) => event.stopPropagation()}
                          placeholder={stage.modelPlaceholder ?? "openai/gpt-4o-mini"}
                          className="w-full rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-sm text-zinc-700"
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
            <div className="flex flex-wrap items-center justify-end gap-2">
              {selectedStage?.usesModel && (
                <input
                  value={selectedModel}
                  onChange={(event) => updateStageModel(selectedStage.id, event.target.value)}
                  placeholder={selectedStage.modelPlaceholder ?? "openai/gpt-4o-mini"}
                  className="w-[280px] max-w-full rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700"
                />
              )}
              <button
                type="button"
                onClick={() => void handleDeleteStage(selectedStageId)}
                disabled={!canDeleteSelectedStage}
                title={selectedStageDeleteHelp}
                className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-30"
              >
                {deletingStageId === selectedStageId ? "Deleting..." : "Delete Stage Result"}
              </button>
              <span className={`text-xs font-medium ${statusColor[stages[selectedStageId]?.status ?? "idle"]}`}>
                {stages[selectedStageId]?.status ?? "idle"}
              </span>
            </div>
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

          {selectedLLMTrials.length > 0 && <LLMPromptPanel trials={selectedLLMTrials} />}

          {selectedPreparedChapter && <Pre1StageView artifact={selectedPreparedChapter} />}

          {selectedContentUnits && (
            <Pre2StageView artifact={selectedContentUnits} preparedChapter={preparedChapter} />
          )}

          {selectedMentionCandidates && (
            <Ent1StageView
              artifact={selectedMentionCandidates}
              preparedChapter={preparedChapter}
              classifyLog={results["PRE.2"] as ContentUnits | undefined}
            />
          )}

          {selectedFilteredMentions && (
            <Ent2StageView
              artifact={selectedFilteredMentions}
              preparedChapter={preparedChapter}
              classifyLog={results["PRE.2"] as ContentUnits | undefined}
            />
          )}

          {selectedStateFrames && (
            <State1StageView
              artifact={selectedStateFrames}
              preparedChapter={preparedChapter}
              classifyLog={results["PRE.2"] as ContentUnits | undefined}
              entityGraph={results["ENT.3"] as EntityGraph | undefined}
            />
          )}

          {selectedValidatedStateFrames && (
            <State2StageView
              artifact={selectedValidatedStateFrames}
              preparedChapter={preparedChapter}
              classifyLog={results["PRE.2"] as ContentUnits | undefined}
              stateLog={results["STATE.1"] as StateFrames | undefined}
            />
          )}

          {selectedSceneBoundaries && (
            <State3StageView
              artifact={selectedSceneBoundaries}
              preparedChapter={preparedChapter}
              classifyLog={results["PRE.2"] as ContentUnits | undefined}
              validatedStateLog={results["STATE.2"] as RefinedStateFrames | undefined}
            />
          )}

          {selectedScenePackets && (
            <Scene1StageView
              key={selectedScenePackets.run_id}
              artifact={selectedScenePackets}
              preparedChapter={preparedChapter}
              classifyLog={results["PRE.2"] as ContentUnits | undefined}
            />
          )}

          {selectedSceneIndexDraft && (
            <Scene2StageView
              key={selectedSceneIndexDraft.run_id}
              artifact={selectedSceneIndexDraft}
              preparedChapter={preparedChapter}
              classifyLog={results["PRE.2"] as ContentUnits | undefined}
              validatedStateLog={results["STATE.2"] as RefinedStateFrames | undefined}
              sceneBoundaryLog={results["STATE.3"] as SceneBoundaries | undefined}
            />
          )}

          {selectedVisualGrounding && (
            <Vis1StageView
              key={selectedVisualGrounding.run_id}
              artifact={selectedVisualGrounding}
              scenePacketLog={results["SCENE.1"] as ScenePackets | undefined}
              preparedChapter={preparedChapter}
            />
          )}

          {selectedStageBlueprint && (
            <Vis2StageView
              key={selectedStageBlueprint.run_id}
              artifact={selectedStageBlueprint}
              scenePacketLog={results["SCENE.1"] as ScenePackets | undefined}
              preparedChapter={preparedChapter}
            />
          )}

          {selectedSubsceneProposals && (
            <Sub1StageView
              key={selectedSubsceneProposals.run_id}
              artifact={selectedSubsceneProposals}
              scenePacketLog={results["SCENE.1"] as ScenePackets | undefined}
              preparedChapter={preparedChapter}
            />
          )}

          {selectedSubsceneStates && (
            <Sub2StageView
              key={selectedSubsceneStates.run_id}
              artifact={selectedSubsceneStates}
              scenePacketLog={results["SCENE.1"] as ScenePackets | undefined}
              preparedChapter={preparedChapter}
            />
          )}

          {selectedValidatedSubscenes && (
            <Sub3StageView
              key={selectedValidatedSubscenes.run_id}
              artifact={selectedValidatedSubscenes}
              scenePacketLog={results["SCENE.1"] as ScenePackets | undefined}
              proposalLog={results["SUB.1"] as SubsceneProposals | undefined}
              stateLog={results["SUB.2"] as SubsceneStates | undefined}
              preparedChapter={preparedChapter}
            />
          )}

          {selectedInterventionPackages && (
            <Sub4StageView
              key={selectedInterventionPackages.run_id}
              artifact={selectedInterventionPackages}
              scenePacketLog={results["SCENE.1"] as ScenePackets | undefined}
              validatedSubsceneLog={results["SUB.3"] as ValidatedSubscenes | undefined}
              preparedChapter={preparedChapter}
            />
          )}

          {selectedSceneReaderPackage && (
            <Final1StageView
              key={selectedSceneReaderPackage.run_id}
              artifact={selectedSceneReaderPackage}
              scenePacketLog={results["SCENE.1"] as ScenePackets | undefined}
            />
          )}

          {selectedOverlayRefinement && (
            <Final2StageView
              key={selectedOverlayRefinement.run_id}
              artifact={selectedOverlayRefinement}
              sceneReaderLog={results["FINAL.1"] as SceneReaderPackageLog | undefined}
              scenePacketLog={results["SCENE.1"] as ScenePackets | undefined}
            />
          )}

          {selectedRenderPackage && (
            <Vis3StageView
              key={selectedRenderPackage.run_id}
              artifact={selectedRenderPackage}
            />
          )}

          {selectedRenderedImages && (
            <Vis4StageView
              key={selectedRenderedImages.run_id}
              artifact={selectedRenderedImages}
              scenePacketLog={results["SCENE.1"] as ScenePackets | undefined}
              blueprintLog={results["VIS.2"] as StageBlueprint | undefined}
              preparedChapter={preparedChapter}
            />
          )}

          {selectedGroundedSceneModel && (
            <Scene3StageView
              key={selectedGroundedSceneModel.run_id}
              artifact={selectedGroundedSceneModel}
              sceneIndexLog={results["SCENE.2"] as SceneIndexDraft | undefined}
              preparedChapter={preparedChapter}
              classifyLog={results["PRE.2"] as ContentUnits | undefined}
              validatedStateLog={results["STATE.2"] as RefinedStateFrames | undefined}
              sceneBoundaryLog={results["STATE.3"] as SceneBoundaries | undefined}
            />
          )}

          {selectedEntityGraph && (
            <Ent3StageView
              key={selectedEntityGraph.run_id}
              artifact={selectedEntityGraph}
              preparedChapter={preparedChapter}
              classifyLog={results["PRE.2"] as ContentUnits | undefined}
            />
          )}

          {!selectedPreparedChapter && !selectedContentUnits && !selectedMentionCandidates && !selectedFilteredMentions && !selectedStateFrames && !selectedValidatedStateFrames && !selectedSceneBoundaries && !selectedScenePackets && !selectedSceneIndexDraft && !selectedVisualGrounding && !selectedStageBlueprint && !selectedSubsceneProposals && !selectedSubsceneStates && !selectedValidatedSubscenes && !selectedInterventionPackages && !selectedSceneReaderPackage && !selectedOverlayRefinement && !selectedRenderPackage && !selectedRenderedImages && !selectedGroundedSceneModel && !selectedEntityGraph && selectedResult !== undefined && (
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
