"use client"

import { useEffect, useState, type ReactNode } from "react"
import AppVersionSwitcher from "@/components/AppVersionSwitcher"
import BookMemoryPanel from "@/components/BookMemoryPanel"
import EpubUploader from "@/components/EpubUploader"
import ExistingDocumentsPicker from "@/components/ExistingDocumentsPicker"
import KnowledgeGraphExplorer from "@/components/KnowledgeGraphExplorer"
import { LanguageProvider, LanguageSwitcher, ThemeSwitcher, useUiStrings } from "@/components/LanguageProvider"
import NarrativeGraphInspector from "@/components/NarrativeGraphInspector"
import PipelineRunner from "@/components/PipelineRunner"
import ReaderScreen from "@/components/ReaderScreen"
import RunReadinessPanel from "@/components/RunReadinessPanel"
import SupportSystemShowcase from "@/components/SupportSystemShowcase"
import { DEFAULT_STAGE_MODELS } from "@/config/pipeline-models"
import {
  cleanupDocumentStorage,
  deleteRun,
  listRuns,
  loadBookMemory,
  loadStageResult,
  saveRunStageModels,
  setRunFavorite,
  stageKey,
  type DataSource,
  type RunMeta,
} from "@/lib/client-data"
import { createTimestampRunId } from "@/lib/run-id"
import type { BookMemorySnapshot } from "@/types/book-memory"
import type { OverlayRefinementResult, SceneReaderPackageLog, StageId } from "@/types/schema"
import { PIPELINE_STAGES, type ChapterMeta, type PipelineStageDef } from "@/types/ui"

type View = "upload" | "pipeline" | "graph" | "reader" | "legacy"
type ReaderMode = "reader" | "researcher"
type State3ExportUnit = "sentence" | "paragraph"

function getPreferredRunId(runs: RunMeta[]): string {
  return runs.find((item) => item.favorite)?.runId ?? runs[0]?.runId ?? ""
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatChapterLabel(chapter: ChapterMeta, visibleIndex: number): string {
  return `${visibleIndex + 1}. ${chapter.title}`
}

const BOOK_STATE_STAGE_IDS: StageId[] = [
  "PRE.1",
  "PRE.2",
  "ENT.1",
  "ENT.2",
  "ENT.3",
  "STATE.1",
  "STATE.2",
  "STATE.3",
]
const BOOK_STATE_STAGE_ID_SET = new Set<StageId>(BOOK_STATE_STAGE_IDS)
const BOOK_STATE_STAGES = PIPELINE_STAGES.filter((stage) =>
  BOOK_STATE_STAGE_ID_SET.has(stage.id),
)
const BOOK_STATE3_ONLY_STAGE_IDS: StageId[] = ["STATE.3"]
const BOOK_STATE3_ONLY_STAGE_ID_SET = new Set<StageId>(BOOK_STATE3_ONLY_STAGE_IDS)
const BOOK_STATE3_ONLY_STAGES = PIPELINE_STAGES.filter((stage) =>
  BOOK_STATE3_ONLY_STAGE_ID_SET.has(stage.id),
)

interface BookStateRunProgress {
  running: boolean
  runId: string
  completed: number
  total: number
  chapterIndex: number
  chapterTotal: number
  stageId?: StageId
  message: string
  error?: string
}

interface BookStateRunChapter {
  chapter: ChapterMeta
  visibleIndex: number
}

function createDefaultStageModelMap(): Partial<Record<StageId, string>> {
  return Object.fromEntries(
    PIPELINE_STAGES
      .filter((stage) => stage.usesModel)
      .map((stage) => [
        stage.id,
        DEFAULT_STAGE_MODELS[stage.id] ?? stage.modelPlaceholder ?? "google/gemini-3.5-flash",
      ]),
  ) as Partial<Record<StageId, string>>
}

function createStageModelMap(stages: PipelineStageDef[]): Partial<Record<StageId, string>> {
  const defaultStageModels = createDefaultStageModelMap()
  return Object.fromEntries(
    stages
      .filter((stage) => stage.usesModel)
      .map((stage) => [stage.id, defaultStageModels[stage.id] ?? ""]),
  ) as Partial<Record<StageId, string>>
}

async function runBookPipelineStage(
  docId: string,
  chapterId: string,
  runId: string,
  stage: PipelineStageDef,
  stageModels: Partial<Record<StageId, string>>,
): Promise<void> {
  const model = stage.usesModel ? stageModels[stage.id]?.trim() : undefined
  const res = await fetch(`/api/pipeline/${stage.apiPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      docId,
      chapterId,
      runId,
      parents: {},
      model,
    }),
  })
  const data = (await res.json()) as { error?: string }
  if (!res.ok) {
    throw new Error(data.error ?? `${stage.id} failed with HTTP ${res.status}`)
  }
}

function progressPercent(completed: number, total: number): number {
  if (total <= 0) return 0
  return Math.max(0, Math.min(100, (completed / total) * 100))
}

function filenameFromContentDisposition(value: string | null): string | null {
  if (!value) return null
  const utfFilename = /filename\*=UTF-8''([^;]+)/i.exec(value)
  if (utfFilename?.[1]) return decodeURIComponent(utfFilename[1])
  const quotedFilename = /filename="([^"]+)"/i.exec(value)
  return quotedFilename?.[1] ?? null
}

function parseExportError(bodyText: string, fallback: string): string {
  try {
    const data = JSON.parse(bodyText) as { error?: string }
    return data.error ?? fallback
  } catch {
    return fallback
  }
}

function downloadJsonText(bodyText: string, filename: string) {
  const blob = new Blob([bodyText], { type: "application/json;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export default function Home() {
  return (
    <LanguageProvider>
      <HomeShell />
    </LanguageProvider>
  )
}

function HomeShell() {
  const { t } = useUiStrings()
  const [view, setView] = useState<View>("upload")
  const [docId, setDocId] = useState("")
  const [chapters, setChapters] = useState<ChapterMeta[]>([])
  const [selectedChapterId, setSelectedChapterId] = useState("")
  const [availableRuns, setAvailableRuns] = useState<RunMeta[]>([])
  const [loadingRuns, setLoadingRuns] = useState(false)
  const [deletingRun, setDeletingRun] = useState(false)
  const [togglingFavorite, setTogglingFavorite] = useState(false)
  const [runId, setRunId] = useState(() => createTimestampRunId())
  const [bookStateRun, setBookStateRun] = useState<BookStateRunProgress | null>(null)
  const [pipelineRefreshNonce, setPipelineRefreshNonce] = useState(0)
  const [exportingState3Unit, setExportingState3Unit] = useState<State3ExportUnit | null>(null)
  const [cleaningStorage, setCleaningStorage] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadRuns() {
      if (!docId || !selectedChapterId) {
        setAvailableRuns([])
        return
      }

      setLoadingRuns(true)
      try {
        const runs = await listRuns(docId, selectedChapterId)
        if (cancelled) return
        setAvailableRuns(runs)
      } finally {
        if (!cancelled) {
          setLoadingRuns(false)
        }
      }
    }

    void loadRuns()
    return () => {
      cancelled = true
    }
  }, [docId, selectedChapterId])

  function createFreshRunId(existing: string[] = []): string {
    return createTimestampRunId([runId, ...existing])
  }

  function handleUploaded(newDocId: string, newChapters: ChapterMeta[]) {
    setDocId(newDocId)
    setChapters(newChapters)
    setSelectedChapterId(newChapters[0]?.chapterId ?? "")
    setRunId(createTimestampRunId())
    setView("pipeline")
  }

  function handleSelectedExisting(newDocId: string, newChapters: ChapterMeta[]) {
    setDocId(newDocId)
    setChapters(newChapters)
    setSelectedChapterId(newChapters[0]?.chapterId ?? "")
    setRunId(createTimestampRunId())
    setView("pipeline")
  }

  const selectedChapterIndex = chapters.findIndex((chapter) => chapter.chapterId === selectedChapterId)

  function handlePipelineChapterChange(chapterId: string) {
    setSelectedChapterId(chapterId)
    setRunId(createFreshRunId())
  }

  function handleReaderChapterChange(chapterId: string) {
    setSelectedChapterId(chapterId)
    setAvailableRuns([])
    setRunId("")
  }

  const currentRunMeta = availableRuns.find((item) => item.runId === runId)
  const currentRunIsSaved = Boolean(currentRunMeta)
  const currentRunFavorite = currentRunMeta?.favorite === true
  const preferredReaderRunId = getPreferredRunId(availableRuns)

  useEffect(() => {
    if (view !== "reader" || loadingRuns) return
    if (runId === preferredReaderRunId) return
    const timeoutId = window.setTimeout(() => {
      setRunId(preferredReaderRunId)
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [view, loadingRuns, preferredReaderRunId, runId])

  async function handleDeleteRun() {
    if (!docId || !selectedChapterId || deletingRun) return
    const confirmed = window.confirm(t.pipeline.deleteConfirm.replace("{runId}", runId))
    if (!confirmed) return

    setDeletingRun(true)
    try {
      await deleteRun(docId, selectedChapterId, runId)
      const remainingRuns = await listRuns(docId, selectedChapterId)
      setAvailableRuns(remainingRuns)
      setRunId(remainingRuns[0]?.runId ?? createTimestampRunId([runId]))
    } finally {
      setDeletingRun(false)
    }
  }

  async function handleToggleFavorite() {
    if (!docId || !selectedChapterId || !runId || !currentRunIsSaved || togglingFavorite) return
    setTogglingFavorite(true)
    try {
      await setRunFavorite(docId, selectedChapterId, runId, !currentRunFavorite)
      const runs = await listRuns(docId, selectedChapterId)
      setAvailableRuns(runs)
    } finally {
      setTogglingFavorite(false)
    }
  }

  async function handleExportState3Json(unit: State3ExportUnit) {
    if (!docId || !selectedChapterId || !runId || exportingState3Unit) return

    setExportingState3Unit(unit)
    try {
      const query = new URLSearchParams({
        docId,
        chapterId: selectedChapterId,
        runId,
        unit,
      })
      const res = await fetch(`/api/export/state3?${query.toString()}`)
      const bodyText = await res.text()
      if (!res.ok) {
        throw new Error(parseExportError(bodyText, `Export failed with HTTP ${res.status}`))
      }

      downloadJsonText(
        bodyText,
        filenameFromContentDisposition(res.headers.get("Content-Disposition")) ??
          `${docId}_${selectedChapterId}_state3.json`,
      )
    } catch (error) {
      window.alert(getErrorMessage(error))
    } finally {
      setExportingState3Unit(null)
    }
  }

  async function handleCleanupStorage() {
    if (!docId || cleaningStorage) return
    const confirmed = window.confirm(t.pipeline.cleanupStorageConfirm)
    if (!confirmed) return

    setCleaningStorage(true)
    try {
      const result = await cleanupDocumentStorage(docId)
      const runs = selectedChapterId ? await listRuns(docId, selectedChapterId) : []
      setAvailableRuns(runs)
      if (selectedChapterId && !runs.some((item) => item.runId === runId)) {
        setRunId(runs[0]?.runId ?? createTimestampRunId([runId]))
      }
      setPipelineRefreshNonce((value) => value + 1)
      window.alert(
        t.pipeline.cleanupStorageComplete
          .replace("{chapters}", String(result.chaptersScanned))
          .replace("{runs}", String(result.invalidRunsDeleted))
          .replace("{artifacts}", String(result.orphanSharedArtifactsDeleted)),
      )
    } catch (error) {
      window.alert(getErrorMessage(error))
    } finally {
      setCleaningStorage(false)
    }
  }

  async function runChapterRangeStages(
    targetChapters: BookStateRunChapter[],
    targetStages: PipelineStageDef[],
    targetRunId: string,
    confirmTemplate: string,
    completeMessage: string,
  ) {
    if (!docId || !targetRunId || targetChapters.length === 0 || targetStages.length === 0 || bookStateRun?.running) return

    const confirmed = window.confirm(
      confirmTemplate
        .replace("{count}", String(targetChapters.length))
        .replace("{runId}", targetRunId),
    )
    if (!confirmed) return

    const stageModels = createStageModelMap(targetStages)
    const total = targetChapters.length * targetStages.length
    let completed = 0
    let activeChapterId = selectedChapterId

    setRunId(targetRunId)
    setBookStateRun({
      running: true,
      runId: targetRunId,
      completed: 0,
      total,
      chapterIndex: 0,
      chapterTotal: targetChapters.length,
      message: t.pipeline.bookRunProgress,
    })

    try {
      for (let chapterIndex = 0; chapterIndex < targetChapters.length; chapterIndex++) {
        const { chapter, visibleIndex } = targetChapters[chapterIndex]
        activeChapterId = chapter.chapterId
        await saveRunStageModels(docId, chapter.chapterId, targetRunId, stageModels)

        for (let stageIndex = 0; stageIndex < targetStages.length; stageIndex++) {
          const stage = targetStages[stageIndex]
          setBookStateRun({
            running: true,
            runId: targetRunId,
            completed,
            total,
            chapterIndex,
            chapterTotal: targetChapters.length,
            stageId: stage.id,
            message: `${formatChapterLabel(chapter, visibleIndex)} - ${stage.id}`,
          })

          await runBookPipelineStage(docId, chapter.chapterId, targetRunId, stage, stageModels)
          completed += 1
        }
      }

      setBookStateRun({
        running: false,
        runId: targetRunId,
        completed,
        total,
        chapterIndex: targetChapters.length - 1,
        chapterTotal: targetChapters.length,
        message: completeMessage,
      })
      setAvailableRuns(await listRuns(docId, selectedChapterId))
    } catch (error) {
      setSelectedChapterId(activeChapterId)
      const failedChapterIndex = Math.max(
        0,
        targetChapters.findIndex((item) => item.chapter.chapterId === activeChapterId),
      )
      setBookStateRun({
        running: false,
        runId: targetRunId,
        completed,
        total,
        chapterIndex: Math.min(failedChapterIndex, targetChapters.length - 1),
        chapterTotal: targetChapters.length,
        message: t.pipeline.bookRunFailed,
        error: getErrorMessage(error),
      })
      setAvailableRuns(await listRuns(docId, activeChapterId))
    } finally {
      setRunId(targetRunId)
      setPipelineRefreshNonce((value) => value + 1)
    }
  }

  async function handleRunBookThroughState3() {
    const bookRunId = createTimestampRunId([runId])
    await runChapterRangeStages(
      chapters.map((chapter, visibleIndex) => ({ chapter, visibleIndex })),
      BOOK_STATE_STAGES,
      bookRunId,
      t.pipeline.runBookThroughState3Confirm,
      t.pipeline.bookRunComplete,
    )
  }

  async function handleRerunBookState3Only() {
    if (!docId || !runId || selectedChapterIndex < 0 || !currentRunIsSaved) return

    const startIndex = selectedChapterIndex >= 0 ? selectedChapterIndex : 0
    const targetChapters = chapters.slice(startIndex).map((chapter, offset) => ({
      chapter,
      visibleIndex: startIndex + offset,
    }))
    const missingRunChapters: string[] = []

    for (const target of targetChapters) {
      const runs = target.chapter.chapterId === selectedChapterId
        ? availableRuns
        : await listRuns(docId, target.chapter.chapterId)
      if (!runs.some((item) => item.runId === runId)) {
        missingRunChapters.push(formatChapterLabel(target.chapter, target.visibleIndex))
      }
    }

    if (missingRunChapters.length > 0) {
      const shownChapters = missingRunChapters.slice(0, 5).join(", ")
      const moreCount = missingRunChapters.length - 5
      window.alert(
        t.pipeline.rerunBookState3OnlyMissingRun
          .replace("{runId}", runId)
          .replace("{chapters}", `${shownChapters}${moreCount > 0 ? `, ... (+${moreCount})` : ""}`),
      )
      return
    }

    await runChapterRangeStages(
      targetChapters,
      BOOK_STATE3_ONLY_STAGES,
      runId,
      t.pipeline.rerunBookState3OnlyConfirm,
      t.pipeline.bookState3OnlyComplete,
    )
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-50">
      <header className="flex flex-wrap items-center gap-4 border-b border-zinc-200 bg-white px-6 py-4">
        <div className="flex min-w-0 flex-wrap items-center gap-6">
          <h1 className="text-lg font-semibold text-zinc-900">{t.app.title}</h1>
          <nav className="flex gap-1">
          {(["upload", "pipeline", "graph", "reader", "legacy"] as View[]).map((currentView) => (
            <button
              key={currentView}
              type="button"
              onClick={() => setView(currentView)}
              className={`rounded-lg px-3 py-2 text-base capitalize transition-colors ${
                view === currentView
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-500 hover:text-zinc-700"
              }`}
            >
              {t.nav[currentView]}
            </button>
          ))}
          </nav>
        </div>
        <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-3">
          <AppVersionSwitcher />
          <ThemeSwitcher />
          <LanguageSwitcher />
        </div>
      </header>

      <main
        className={`min-h-0 flex-1 text-base ${
          view === "reader" || view === "legacy" || view === "graph"
            ? "overflow-y-auto p-0"
            : view === "pipeline" || view === "upload"
              ? "overflow-y-auto p-6"
              : "overflow-hidden p-6"
        }`}
      >
        {view === "upload" && (
          <div className="mx-auto mt-10 grid max-w-6xl items-start gap-6 pb-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
            <EpubUploader onUploaded={handleUploaded} />
            <ExistingDocumentsPicker onSelected={handleSelectedExisting} />
          </div>
        )}

        {view === "pipeline" && docId && (
          <div className="flex min-h-full w-full flex-col gap-5">
            <div className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5">
              <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)_minmax(0,1fr)] xl:items-end">
                <div className="min-w-[340px]">
                  <label className="mb-1 block text-sm text-zinc-500">{t.common.chapter}</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const prev = chapters[selectedChapterIndex - 1]
                        if (prev) handlePipelineChapterChange(prev.chapterId)
                      }}
                      disabled={selectedChapterIndex <= 0}
                      className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
                    >
                      {t.common.previous}
                    </button>
                    <select
                      value={selectedChapterId}
                      onChange={(event) => handlePipelineChapterChange(event.target.value)}
                      className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-base"
                    >
                      {chapters.map((chapter, index) => (
                        <option key={chapter.chapterId} value={chapter.chapterId}>
                          {formatChapterLabel(chapter, index)}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        const next = chapters[selectedChapterIndex + 1]
                        if (next) handlePipelineChapterChange(next.chapterId)
                      }}
                      disabled={selectedChapterIndex < 0 || selectedChapterIndex >= chapters.length - 1}
                      className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
                    >
                      {t.common.next}
                    </button>
                  </div>
                </div>

                <div className="min-w-[320px] min-w-0">
                  <label className="mb-1 block text-sm text-zinc-500">{t.pipeline.runId}</label>
                  <div className="flex gap-2">
                    <input
                      value={runId}
                      onChange={(event) => setRunId(event.target.value)}
                      className="flex-1 rounded-lg border border-zinc-200 px-3 py-2 font-mono text-base"
                    />
                    <button
                      type="button"
                      onClick={() => setRunId(createFreshRunId(availableRuns.map((item) => item.runId)))}
                      className="rounded-lg border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-50"
                    >
                      {t.common.new}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleToggleFavorite()}
                      disabled={!currentRunIsSaved || togglingFavorite}
                      className={`rounded-lg border px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                        currentRunFavorite
                          ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
                          : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                      }`}
                      title={currentRunIsSaved ? t.pipeline.favoriteTitle : t.pipeline.favoriteDisabledTitle}
                    >
                      {currentRunFavorite ? t.common.favoriteActive : t.common.favorite}
                    </button>
                  </div>
                </div>

                <div className="min-w-[320px] min-w-0">
                  <label className="mb-1 block text-sm text-zinc-500">{t.pipeline.savedRuns}</label>
                  <div className="flex gap-2">
                    <select
                      value={availableRuns.some((item) => item.runId === runId) ? runId : ""}
                      onChange={(event) => {
                        if (event.target.value) {
                          setRunId(event.target.value)
                        }
                      }}
                      className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-base"
                    >
                      <option value="">
                        {loadingRuns ? t.common.loading : t.pipeline.currentDraft}
                      </option>
                      {availableRuns.map((item) => (
                        <option key={item.runId} value={item.runId}>
                          {`${item.favorite ? "* " : ""}${item.runId}`}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setRunId(createFreshRunId(availableRuns.map((item) => item.runId)))}
                      className="rounded-lg border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-50"
                    >
                      {t.common.draft}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteRun()}
                      disabled={deletingRun}
                      className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-40"
                    >
                      {deletingRun ? t.common.deleting : t.common.delete}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 border-t border-zinc-100 pt-4">
                <button
                  type="button"
                  onClick={() => void handleRunBookThroughState3()}
                  disabled={!docId || chapters.length === 0 || bookStateRun?.running}
                  className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                  title={t.pipeline.runBookThroughState3Title}
                >
                  {bookStateRun?.running ? t.pipeline.bookRunProgress : t.pipeline.runBookThroughState3}
                </button>
                <button
                  type="button"
                  onClick={() => void handleRerunBookState3Only()}
                  disabled={!docId || !runId || !currentRunIsSaved || loadingRuns || selectedChapterIndex < 0 || chapters.length === 0 || bookStateRun?.running}
                  className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                  title={t.pipeline.rerunBookState3OnlyTitle}
                >
                  {t.pipeline.rerunBookState3Only}
                </button>
                <button
                  type="button"
                  onClick={() => void handleExportState3Json("sentence")}
                  disabled={!docId || !selectedChapterId || !runId || exportingState3Unit !== null}
                  className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                  title={t.pipeline.exportState3SentenceJsonTitle}
                >
                  {exportingState3Unit === "sentence"
                    ? t.pipeline.exportingState3Json
                    : t.pipeline.exportState3SentenceJson}
                </button>
                <button
                  type="button"
                  onClick={() => void handleExportState3Json("paragraph")}
                  disabled={!docId || !selectedChapterId || !runId || exportingState3Unit !== null}
                  className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-2 text-sm font-medium text-teal-700 transition-colors hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-50"
                  title={t.pipeline.exportState3ParagraphJsonTitle}
                >
                  {exportingState3Unit === "paragraph"
                    ? t.pipeline.exportingState3Json
                    : t.pipeline.exportState3ParagraphJson}
                </button>
                <button
                  type="button"
                  onClick={() => void handleCleanupStorage()}
                  disabled={!docId || cleaningStorage}
                  className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                  title={t.pipeline.cleanupStorageTitle}
                >
                  {cleaningStorage ? t.pipeline.cleanupStorageRunning : t.pipeline.cleanupStorage}
                </button>
                {bookStateRun && (
                  <div className="min-w-[280px] flex-1 rounded-lg bg-zinc-50 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-600">
                      <span className="font-medium text-zinc-800">{bookStateRun.message}</span>
                      <span>
                        {bookStateRun.completed}/{bookStateRun.total} stages
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white">
                      <div
                        className={`h-full rounded-full transition-all ${
                          bookStateRun.error ? "bg-red-500" : "bg-blue-500"
                        }`}
                        style={{ width: `${progressPercent(bookStateRun.completed, bookStateRun.total)}%` }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">
                      {t.common.chapter} {Math.min(bookStateRun.chapterIndex + 1, bookStateRun.chapterTotal)}/{bookStateRun.chapterTotal}
                      {bookStateRun.stageId ? ` - ${bookStateRun.stageId}` : ""}
                    </p>
                    {bookStateRun.error && (
                      <p className="mt-1 text-xs text-red-600">{bookStateRun.error}</p>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="min-h-[720px] min-w-0 rounded-xl border border-zinc-200 bg-white p-5">
              <PipelineRunner
                key={`${selectedChapterId}:${runId}:${pipelineRefreshNonce}`}
                docId={docId}
                chapterId={selectedChapterId}
                runId={runId}
              />
            </div>

            <button
              type="button"
              onClick={() => setView("reader")}
              className="text-base text-zinc-500 underline hover:text-zinc-800"
            >
              {t.pipeline.viewReader}
            </button>
            <button
              type="button"
              onClick={() => setView("graph")}
              className="text-base text-zinc-500 underline hover:text-zinc-800"
            >
              {t.pipeline.viewGraph}
            </button>
          </div>
        )}

        {view === "graph" && docId && (
          <GraphView
            docId={docId}
            chapterId={selectedChapterId}
            runId={runId}
            chapters={chapters}
            availableRuns={availableRuns}
            loadingRuns={loadingRuns}
            onChapterChange={handlePipelineChapterChange}
            onRunChange={setRunId}
          />
        )}

        {view === "reader" && docId && (
          <ReaderView
            docId={docId}
            chapterId={selectedChapterId}
            runId={runId}
            chapters={chapters}
            loadingRuns={loadingRuns}
            onChapterChange={handleReaderChapterChange}
          />
        )}

        {view === "legacy" && <LegacyArchiveView />}

        {view !== "upload" && view !== "legacy" && !docId && (
          <div className="mt-20 text-center text-zinc-400">
            {t.app.noDocument}
          </div>
        )}
      </main>
    </div>
  )
}

function ReaderChapterControl({
  chapterId,
  chapters,
  disabled = false,
  onChapterChange,
}: {
  chapterId: string
  chapters: ChapterMeta[]
  disabled?: boolean
  onChapterChange: (chapterId: string) => void
}) {
  const { t } = useUiStrings()
  const selectedChapterIndex = chapters.findIndex((chapter) => chapter.chapterId === chapterId)

  return (
    <div className="flex items-center gap-2">
      <label className="text-sm font-medium text-zinc-600">{t.common.chapter}</label>
      <button
        type="button"
        onClick={() => {
          const prev = chapters[selectedChapterIndex - 1]
          if (prev) onChapterChange(prev.chapterId)
        }}
        disabled={disabled || selectedChapterIndex <= 0}
        className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {t.common.previous}
      </button>
      <select
        value={chapterId}
        onChange={(event) => onChapterChange(event.target.value)}
        disabled={disabled}
        className="min-w-[260px] rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
      >
        {chapters.map((chapter, index) => (
          <option key={chapter.chapterId} value={chapter.chapterId}>
            {formatChapterLabel(chapter, index)}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => {
          const next = chapters[selectedChapterIndex + 1]
          if (next) onChapterChange(next.chapterId)
        }}
        disabled={disabled || selectedChapterIndex < 0 || selectedChapterIndex >= chapters.length - 1}
        className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {t.common.next}
      </button>
    </div>
  )
}

function GraphView({
  docId,
  chapterId,
  runId,
  chapters,
  availableRuns,
  loadingRuns,
  onChapterChange,
  onRunChange,
}: {
  docId: string
  chapterId: string
  runId: string
  chapters: ChapterMeta[]
  availableRuns: RunMeta[]
  loadingRuns: boolean
  onChapterChange: (chapterId: string) => void
  onRunChange: (runId: string) => void
}) {
  const { t } = useUiStrings()
  const selectedChapterIndex = chapters.findIndex((chapter) => chapter.chapterId === chapterId)
  const runExists = availableRuns.some((item) => item.runId === runId)

  return (
    <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-5 p-6">
      <section className="rounded-2xl border border-zinc-200 bg-white p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{t.graphPage.eyebrow}</p>
            <h2 className="mt-1 text-lg font-semibold text-zinc-900">{t.graphPage.title}</h2>
            <p className="mt-1 text-sm text-zinc-500">
              {t.graphPage.description}
            </p>
            <p className="hidden" aria-hidden="true">
              새 저장소 `documents_v2`의 graph projection을 조회합니다. 기존 `documents` 데이터는 legacy 탭에서 확인합니다.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const prev = chapters[selectedChapterIndex - 1]
                if (prev) onChapterChange(prev.chapterId)
              }}
              disabled={selectedChapterIndex <= 0}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
            >
              {t.common.previous}
            </button>
            <select
              value={chapterId}
              onChange={(event) => onChapterChange(event.target.value)}
              className="min-w-[300px] rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm"
            >
              {chapters.map((chapter, index) => (
                <option key={chapter.chapterId} value={chapter.chapterId}>
                  {formatChapterLabel(chapter, index)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                const next = chapters[selectedChapterIndex + 1]
                if (next) onChapterChange(next.chapterId)
              }}
              disabled={selectedChapterIndex < 0 || selectedChapterIndex >= chapters.length - 1}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
            >
              {t.common.next}
            </button>
            <select
              value={runExists ? runId : ""}
              onChange={(event) => {
                if (event.target.value) onRunChange(event.target.value)
              }}
              disabled={loadingRuns || availableRuns.length === 0}
              className="min-w-[320px] rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-sm disabled:opacity-50"
            >
              <option value="">{loadingRuns ? t.common.loading : t.pipeline.selectSavedRun}</option>
              {availableRuns.map((item) => (
                <option key={item.runId} value={item.runId}>
                  {`${item.favorite ? "* " : ""}${item.runId}`}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {runId ? (
        <>
          <RunReadinessPanel docId={docId} chapterId={chapterId} runId={runId} onRunChange={onRunChange} />
          <SupportSystemShowcase docId={docId} chapterId={chapterId} runId={runId} />
          <BookMemoryPanel
            docId={docId}
            runId={runId}
            currentChapterId={chapterId}
            chapters={chapters}
          />
          <NarrativeGraphInspector docId={docId} chapterId={chapterId} />
          <KnowledgeGraphExplorer docId={docId} chapterId={chapterId} runId={runId} />
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-4 py-8 text-center text-sm text-zinc-500">
          {t.graphPage.noRunSelected}
        </div>
      )}
    </div>
  )
}

function LegacyArchiveView() {
  const { t } = useUiStrings()
  const [docId, setDocId] = useState("")
  const [chapters, setChapters] = useState<ChapterMeta[]>([])
  const [selectedChapterId, setSelectedChapterId] = useState("")
  const [availableRuns, setAvailableRuns] = useState<RunMeta[]>([])
  const [loadingRuns, setLoadingRuns] = useState(false)
  const [runId, setRunId] = useState("")
  const selectedChapterIndex = chapters.findIndex((chapter) => chapter.chapterId === selectedChapterId)

  useEffect(() => {
    let cancelled = false

    async function loadLegacyRuns() {
      if (!docId || !selectedChapterId) {
        setAvailableRuns([])
        setRunId("")
        return
      }

      setLoadingRuns(true)
      try {
        const runs = await listRuns(docId, selectedChapterId, "legacy")
        if (cancelled) return
        setAvailableRuns(runs)
        setRunId((current) => (runs.some((item) => item.runId === current) ? current : (runs[0]?.runId ?? "")))
      } finally {
        if (!cancelled) setLoadingRuns(false)
      }
    }

    void loadLegacyRuns()
    return () => {
      cancelled = true
    }
  }, [docId, selectedChapterId])

  function handleSelectedLegacy(newDocId: string, newChapters: ChapterMeta[]) {
    setDocId(newDocId)
    setChapters(newChapters)
    setSelectedChapterId(newChapters[0]?.chapterId ?? "")
    setRunId("")
  }

  function handleChapterChange(chapterId: string) {
    setSelectedChapterId(chapterId)
    setAvailableRuns([])
    setRunId("")
  }

  const runSelector = (
    <div className="flex items-center gap-2">
      <label className="text-sm font-medium text-zinc-600">{t.legacy.runLabel}</label>
      <select
        value={runId}
        onChange={(event) => setRunId(event.target.value)}
        disabled={loadingRuns || availableRuns.length === 0}
        className="min-w-[320px] rounded-lg border border-zinc-200 bg-white px-3 py-1.5 font-mono text-sm disabled:cursor-not-allowed disabled:opacity-60"
      >
        <option value="">{loadingRuns ? t.common.loading : t.pipeline.noSavedRun}</option>
        {availableRuns.map((item) => (
          <option key={item.runId} value={item.runId}>
            {`${item.favorite ? "* " : ""}${item.runId}`}
          </option>
        ))}
      </select>
    </div>
  )

  return (
    <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-5 p-6">
      <div className="grid gap-5 xl:grid-cols-[minmax(360px,0.8fr)_minmax(0,1.2fr)]">
        <ExistingDocumentsPicker
          source="legacy"
          preset="legacy"
          title="Legacy Documents"
          description="기존 documents 컬렉션에 남아 있는 이전 실행 결과를 읽기 전용으로 엽니다."
          emptyMessage="기존 documents 컬렉션에서 문서를 찾지 못했습니다."
          onSelected={handleSelectedLegacy}
        />

        <section className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-800">{t.legacy.readerTitle}</h2>
              <p className="mt-1 text-xs text-zinc-500">
                {t.legacy.readerDescription}
              </p>
              <p className="hidden" aria-hidden="true">
                새 실행은 documents_v2에 저장되고, 이 화면은 기존 documents 컬렉션을 수정하지 않습니다.
              </p>
            </div>
            <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-500">
              {t.common.readOnly}
            </span>
          </div>

          {docId ? (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  const prev = chapters[selectedChapterIndex - 1]
                  if (prev) handleChapterChange(prev.chapterId)
                }}
                disabled={selectedChapterIndex <= 0}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
              >
                {t.common.previous}
              </button>
              <select
                value={selectedChapterId}
                onChange={(event) => handleChapterChange(event.target.value)}
                className="min-w-[320px] rounded-lg border border-zinc-200 bg-white px-3 py-2 text-base"
              >
                {chapters.map((chapter, index) => (
                  <option key={chapter.chapterId} value={chapter.chapterId}>
                    {formatChapterLabel(chapter, index)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  const next = chapters[selectedChapterIndex + 1]
                  if (next) handleChapterChange(next.chapterId)
                }}
                disabled={selectedChapterIndex < 0 || selectedChapterIndex >= chapters.length - 1}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
              >
                {t.common.next}
              </button>
              {runSelector}
            </div>
          ) : (
            <div className="mt-5 rounded-lg border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-400">
              {t.legacy.selectDocument}
            </div>
          )}
          {false && (
            <div className="mt-5 rounded-lg border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-400">
              {t.legacy.selectDocument}
              <span className="hidden" aria-hidden="true" />
              왼쪽에서 legacy 문서를 선택하세요.
            </div>
          )}
        </section>
      </div>

      {docId && selectedChapterId && (
        <ReaderView
          docId={docId}
          chapterId={selectedChapterId}
          runId={runId}
          chapters={chapters}
          loadingRuns={loadingRuns}
          source="legacy"
          onChapterChange={handleChapterChange}
        />
      )}
    </div>
  )
}

function ReaderView({
  docId,
  chapterId,
  runId,
  chapters,
  loadingRuns,
  source,
  extraControls,
  onChapterChange,
}: {
  docId: string
  chapterId: string
  runId: string
  chapters: ChapterMeta[]
  loadingRuns: boolean
  source?: DataSource
  extraControls?: ReactNode
  onChapterChange: (chapterId: string) => void
}) {
  const { t } = useUiStrings()
  const [final1, setFinal1] = useState<SceneReaderPackageLog | null>(null)
  const [final2, setFinal2] = useState<OverlayRefinementResult | null>(null)
  const [bookMemory, setBookMemory] = useState<BookMemorySnapshot | null>(null)
  const [readerRunId, setReaderRunId] = useState("")
  const [readerMode, setReaderMode] = useState<ReaderMode>("reader")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const loadedBookMemory = source === "legacy"
          ? null
          : await loadBookMemory(docId).catch(() => null)
        const memoryRunId = loadedBookMemory?.chapterRunIds[chapterId]
        const primaryRunId = memoryRunId ?? runId
        let [loadedFinal1, loadedFinal2] = await Promise.all([
          loadStageResult<SceneReaderPackageLog>(docId, chapterId, primaryRunId, stageKey("FINAL.1"), source),
          loadStageResult<OverlayRefinementResult>(docId, chapterId, primaryRunId, stageKey("FINAL.2"), source),
        ])
        let effectiveReaderRunId = primaryRunId

        if (!loadedFinal1 && primaryRunId !== runId) {
          const fallback = await Promise.all([
            loadStageResult<SceneReaderPackageLog>(docId, chapterId, runId, stageKey("FINAL.1"), source),
            loadStageResult<OverlayRefinementResult>(docId, chapterId, runId, stageKey("FINAL.2"), source),
          ])
          loadedFinal1 = fallback[0]
          loadedFinal2 = fallback[1]
          effectiveReaderRunId = runId
        }

        if (!loadedFinal1 && !loadedFinal2) {
          setFinal1(null)
          setFinal2(null)
          setBookMemory(loadedBookMemory)
          setReaderRunId(effectiveReaderRunId)
          setError(null)
          return
        }

        setFinal1(loadedFinal1)
        setFinal2(loadedFinal2)
        setBookMemory(loadedBookMemory)
        setReaderRunId(effectiveReaderRunId)
      } catch (loadError: unknown) {
        setError(getErrorMessage(loadError))
      } finally {
        setLoading(false)
      }
    }

    if (docId && chapterId && runId) {
      void load()
      return
    }

    const timeoutId = window.setTimeout(() => {
      setFinal1(null)
      setFinal2(null)
      setBookMemory(null)
      setReaderRunId("")
      setLoading(false)
      setError(null)
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [docId, chapterId, runId, source])

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-5 p-6">
        <ReaderChapterControl
          chapterId={chapterId}
          chapters={chapters}
          disabled={loadingRuns}
          onChapterChange={onChapterChange}
        />
        {extraControls}
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-500">
          {t.readerPage.loading}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-5 p-6">
        <ReaderChapterControl
          chapterId={chapterId}
          chapters={chapters}
          disabled={loadingRuns}
          onChapterChange={onChapterChange}
        />
        {extraControls}
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      </div>
    )
  }

  if (!runId) {
    return (
      <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-5 p-6">
        <ReaderChapterControl
          chapterId={chapterId}
          chapters={chapters}
          disabled={loadingRuns}
          onChapterChange={onChapterChange}
        />
        {extraControls}
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-500">
          {loadingRuns ? t.readerPage.loading : t.readerPage.noSavedRuns}
        </div>
      </div>
    )
  }

  if (!final1) {
    return (
      <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-5 p-6">
        <ReaderChapterControl
          chapterId={chapterId}
          chapters={chapters}
          disabled={loadingRuns}
          onChapterChange={onChapterChange}
        />
        {extraControls}
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-500">
          {t.readerPage.noResult}
        </div>
        {source !== "legacy" && (
          <RunReadinessPanel docId={docId} chapterId={chapterId} runId={runId} />
        )}
        {false && null}
        <div className="hidden" aria-hidden="true">
          결과가 없습니다. 실행해주세요.
        </div>
      </div>
    )
  }

  return (
    <ReaderScreen
      mode={readerMode}
      final1={final1}
      final2={final2 ?? undefined}
      bookMemory={bookMemory ?? undefined}
      readerRunId={readerRunId || runId}
      topControls={(
        <>
          <ReaderChapterControl
            chapterId={chapterId}
            chapters={chapters}
            disabled={loadingRuns}
            onChapterChange={onChapterChange}
          />
          {extraControls}
          <div className="flex rounded-xl border border-zinc-200 bg-white p-1 shadow-sm">
            {([
              { key: "reader", label: "독자 화면" },
              { key: "researcher", label: "연구자 화면" },
            ] as const).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setReaderMode(item.key)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  readerMode === item.key
                    ? "bg-zinc-900 text-white"
                    : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    />
  )
}
