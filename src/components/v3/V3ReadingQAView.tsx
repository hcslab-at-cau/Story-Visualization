"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  answerV3BookQuestion,
  answerV3Question,
  buildV3BookQACorpus,
  deleteV3BookQAHistory,
  deleteV3QAHistory,
  listV3BookQAHistory,
  listV3QAHistory,
  loadV3BookQACorpus,
  saveV3BookQAHistory,
  saveV3QAHistory,
  type DataSource,
} from "@/lib/client-data"
import type { V3BookQAAnswerResult } from "@/lib/pipeline/v3-book-qa-answer-types"
import type { V3BookReaderPosition } from "@/lib/pipeline/v3-book-qa-types"
import { filterV3QAProgressSafeHits } from "@/lib/pipeline/v3-qa-answer"
import type { V3QAAnswerResult } from "@/lib/pipeline/v3-qa-answer-types"
import type { V3RetrievalIndexArtifact } from "@/lib/pipeline/v3-narrative-memory-types"
import type { V3SemanticIndexArtifact } from "@/lib/pipeline/v3-semantic-index-types"
import {
  createV3BookQAHistoryAnswerSnapshot,
  type V3BookQAHistoryAnswerSnapshot,
  type V3BookQAHistoryEntry,
} from "@/lib/v3-book-qa-history-types"
import type { StoredV3BookQACorpus } from "@/lib/server/v3-book-qa-corpus-store"
import {
  createV3QAHistoryAnswerSnapshot,
  type V3QAHistoryAnswerSnapshot,
  type V3QAHistoryEntry,
} from "@/lib/v3-qa-history-types"
import type { ContentUnits, Paragraph, PreparedChapter } from "@/types/schema"
import V3BookQAHistoryPanel from "./V3BookQAHistoryPanel"
import V3QAHistoryPanel from "./V3QAHistoryPanel"
import {
  createV3BookCitationAction,
  createV3BookQACorpusBuildRunIds,
  createV3BookParagraphDomId,
  createV3BookQAReadinessViewModel,
  filterV3BookReadableParagraphs,
} from "./v3-book-qa-view-model"
import { createV3WorkbenchHref } from "./v3-navigation"

interface Props {
  docId: string
  chapterId: string
  chapterTitle?: string
  runId: string
  source: DataSource
  preparedChapter?: PreparedChapter
  contentUnits?: ContentUnits
  retrievalIndex?: V3RetrievalIndexArtifact
  semanticIndex?: V3SemanticIndexArtifact
  qaCorpusId?: string
  readerPosition?: V3BookReaderPosition
}

function storyParagraphs(preparedChapter?: PreparedChapter, contentUnits?: ContentUnits): Paragraph[] {
  const paragraphs = preparedChapter?.raw_chapter.paragraphs ?? []
  if (!contentUnits) return paragraphs
  const storyPids = new Set(contentUnits.units.filter((unit) => unit.is_story_text).map((unit) => unit.pid))
  return paragraphs.filter((paragraph) => storyPids.has(paragraph.pid))
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-zinc-950">{value}</p>
    </div>
  )
}

function spanLabel(start?: number, end?: number): string {
  if (typeof start !== "number" || typeof end !== "number") return "progress unknown"
  return start === end ? `P${start}` : `P${start}-P${end}`
}

const EVIDENCE_PREVIEW_LENGTH = 420

function evidencePreview(text: string): string {
  if (text.length <= EVIDENCE_PREVIEW_LENGTH) return text
  return `${text.slice(0, EVIDENCE_PREVIEW_LENGTH).trimEnd()}...`
}

function mergeHistoryEntries(...groups: V3QAHistoryEntry[][]): V3QAHistoryEntry[] {
  const byId = new Map(groups.flat().map((entry) => [entry.entry_id, entry]))
  return [...byId.values()].sort((left, right) => (
    Date.parse(right.created_at) - Date.parse(left.created_at)
      || right.entry_id.localeCompare(left.entry_id)
  ))
}

function mergeBookHistoryEntries(...groups: V3BookQAHistoryEntry[][]): V3BookQAHistoryEntry[] {
  const byId = new Map(groups.flat().map((entry) => [entry.entry_id, entry]))
  return [...byId.values()].sort((left, right) => (
    Date.parse(right.created_at) - Date.parse(left.created_at)
      || right.entry_id.localeCompare(left.entry_id)
  ))
}

function LegacyV3ReadingQAView({
  docId,
  chapterId,
  chapterTitle,
  runId,
  source,
  preparedChapter,
  contentUnits,
  retrievalIndex,
  semanticIndex,
}: Props) {
  const router = useRouter()
  const paragraphs = useMemo(() => storyParagraphs(preparedChapter, contentUnits), [preparedChapter, contentUnits])
  const lastPid = paragraphs.at(-1)?.pid
  const [question, setQuestion] = useState("")
  const [progressPid, setProgressPid] = useState<number | "chapter">("chapter")
  const [answerResult, setAnswerResult] = useState<V3QAHistoryAnswerSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [historyEntries, setHistoryEntries] = useState<V3QAHistoryEntry[]>([])
  const [historyCursor, setHistoryCursor] = useState<string | null>(null)
  const [historyHasMore, setHistoryHasMore] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false)
  const [historySaving, setHistorySaving] = useState(false)
  const [historyLoadError, setHistoryLoadError] = useState<string | null>(null)
  const [historySaveError, setHistorySaveError] = useState<string | null>(null)
  const [historyDeleteError, setHistoryDeleteError] = useState<string | null>(null)
  const [deletingHistoryId, setDeletingHistoryId] = useState<string | null>(null)
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null)
  const [corpusBuilding, setCorpusBuilding] = useState(false)
  const [corpusBuildError, setCorpusBuildError] = useState<string | null>(null)
  const requestGeneration = useRef(0)
  const historyScopeGeneration = useRef(0)

  useEffect(() => {
    let cancelled = false
    const scopeGeneration = historyScopeGeneration.current + 1
    historyScopeGeneration.current = scopeGeneration
    requestGeneration.current += 1
    void listV3QAHistory({ docId, chapterId, runId, source })
      .then((page) => {
        if (cancelled || historyScopeGeneration.current !== scopeGeneration) return
        setHistoryEntries((current) => mergeHistoryEntries(current, page.entries))
        setHistoryCursor(page.next_cursor)
        setHistoryHasMore(page.has_more)
      })
      .catch((historyError) => {
        if (!cancelled && historyScopeGeneration.current === scopeGeneration) {
          setHistoryLoadError(historyError instanceof Error ? historyError.message : String(historyError))
        }
      })
      .finally(() => {
        if (!cancelled && historyScopeGeneration.current === scopeGeneration) setHistoryLoading(false)
      })
    return () => {
      cancelled = true
      if (historyScopeGeneration.current === scopeGeneration) {
        historyScopeGeneration.current = scopeGeneration + 1
      }
    }
  }, [chapterId, docId, runId, source])

  const progressEndPid = progressPid === "chapter" ? lastPid : progressPid
  const canSearch = Boolean(docId && chapterId && runId && retrievalIndex && question.trim() && typeof progressEndPid === "number")
  const result = answerResult?.retrieval ?? null
  const visibleHits = useMemo(
    () => result && typeof progressEndPid === "number"
      ? filterV3QAProgressSafeHits(result.hits, progressEndPid)
      : [],
    [progressEndPid, result],
  )

  function clearAnswer() {
    requestGeneration.current += 1
    setAnswerResult(null)
    setSelectedHistoryId(null)
    setError(null)
    setLoading(false)
  }

  async function persistHistory(
    resultToSave: V3QAAnswerResult,
    savedQuestion: string,
    savedProgressEndPid: number,
    requestId: number,
    scopeGeneration: number,
  ) {
    setHistorySaving(true)
    setHistorySaveError(null)
    try {
      const saved = await saveV3QAHistory({
        docId,
        chapterId,
        runId,
        source,
        question: savedQuestion,
        progressEndPid: savedProgressEndPid,
        answerSnapshot: createV3QAHistoryAnswerSnapshot(resultToSave),
      })
      if (historyScopeGeneration.current !== scopeGeneration) return
      setHistoryEntries((current) => mergeHistoryEntries([saved], current))
      if (requestGeneration.current === requestId) setSelectedHistoryId(saved.entry_id)
    } catch (historyError) {
      if (historyScopeGeneration.current === scopeGeneration) {
        setHistorySaveError(historyError instanceof Error ? historyError.message : String(historyError))
      }
    } finally {
      if (historyScopeGeneration.current === scopeGeneration) setHistorySaving(false)
    }
  }

  async function runAnswer() {
    if (!canSearch || typeof progressEndPid !== "number") return
    const requestId = requestGeneration.current + 1
    const scopeGeneration = historyScopeGeneration.current
    requestGeneration.current = requestId
    setLoading(true)
    setError(null)
    try {
      const next = await answerV3Question({
        docId,
        chapterId,
        runId,
        source,
        question: question.trim(),
        progressEndPid,
      })
      if (requestGeneration.current !== requestId) return
      setAnswerResult(next)
      setSelectedHistoryId(null)
      void persistHistory(next, question.trim(), progressEndPid, requestId, scopeGeneration)
    } catch (e) {
      if (requestGeneration.current !== requestId) return
      setError(e instanceof Error ? e.message : String(e))
      setAnswerResult(null)
    } finally {
      if (requestGeneration.current === requestId) setLoading(false)
    }
  }

  async function buildBookCorpus() {
    if (typeof progressEndPid !== "number" || corpusBuilding) return
    setCorpusBuilding(true)
    setCorpusBuildError(null)
    try {
      const chapterRunIds = createV3BookQACorpusBuildRunIds()
      const stored = await buildV3BookQACorpus({
        docId,
        ...(chapterRunIds ? { chapterRunIds } : {}),
      })
      const pinnedChapter = stored.manifest.chapters.find((item) => item.chapter_id === chapterId)
      if (!pinnedChapter) throw new Error("The current chapter is not pinned in the new BOOK.1 corpus.")
      const readerPosition = {
        chapter_id: chapterId,
        pid: Math.min(progressEndPid, pinnedChapter.progress_end_pid),
      }
      router.push(createV3WorkbenchHref({
        docId,
        chapterId,
        runId: pinnedChapter.run_id,
        source: "v3",
        view: "qa",
        qaCorpusId: stored.manifest.qa_corpus_id,
        readerPosition,
      }))
    } catch (buildError) {
      setCorpusBuildError(buildError instanceof Error ? buildError.message : String(buildError))
    } finally {
      setCorpusBuilding(false)
    }
  }

  async function loadMoreHistory() {
    if (!historyCursor || historyLoadingMore) return
    const scopeGeneration = historyScopeGeneration.current
    const cursor = historyCursor
    setHistoryLoadingMore(true)
    setHistoryLoadError(null)
    try {
      const page = await listV3QAHistory({
        docId,
        chapterId,
        runId,
        source,
        cursor,
      })
      if (historyScopeGeneration.current !== scopeGeneration) return
      setHistoryEntries((current) => mergeHistoryEntries(current, page.entries))
      setHistoryCursor(page.next_cursor)
      setHistoryHasMore(page.has_more)
    } catch (historyError) {
      if (historyScopeGeneration.current === scopeGeneration) {
        setHistoryLoadError(historyError instanceof Error ? historyError.message : String(historyError))
      }
    } finally {
      if (historyScopeGeneration.current === scopeGeneration) setHistoryLoadingMore(false)
    }
  }

  function selectHistoryEntry(entry: V3QAHistoryEntry) {
    requestGeneration.current += 1
    setLoading(false)
    setError(null)
    setQuestion(entry.question)
    setProgressPid(entry.progress_end_pid)
    setAnswerResult(entry.answer_snapshot)
    setSelectedHistoryId(entry.entry_id)
  }

  async function removeHistoryEntry(entry: V3QAHistoryEntry) {
    if (!window.confirm("Delete this saved question?")) return
    const scopeGeneration = historyScopeGeneration.current
    setDeletingHistoryId(entry.entry_id)
    setHistoryDeleteError(null)
    try {
      await deleteV3QAHistory({
        docId,
        chapterId,
        runId,
        source,
        entryId: entry.entry_id,
      })
      if (historyScopeGeneration.current !== scopeGeneration) return
      setHistoryEntries((current) => current.filter((item) => item.entry_id !== entry.entry_id))
      if (selectedHistoryId === entry.entry_id) {
        requestGeneration.current += 1
        setAnswerResult(null)
        setSelectedHistoryId(null)
        setLoading(false)
      }
    } catch (historyError) {
      if (historyScopeGeneration.current === scopeGeneration) {
        setHistoryDeleteError(historyError instanceof Error ? historyError.message : String(historyError))
      }
    } finally {
      if (historyScopeGeneration.current === scopeGeneration) setDeletingHistoryId(null)
    }
  }

  return (
    <section className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-h-0 min-w-0 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Reading QA</p>
            <h2 className="mt-1 text-lg font-semibold text-zinc-950">Progress-bounded story answers</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${semanticIndex ? "bg-emerald-50 text-emerald-700" : "bg-white text-zinc-600"}`}>
              {semanticIndex ? "IDX.2 hybrid" : "IDX.1 lexical"}
            </span>
            <button
              type="button"
              onClick={() => void buildBookCorpus()}
              disabled={typeof progressEndPid !== "number" || corpusBuilding}
              className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {corpusBuilding ? "Building BOOK.1..." : "Build book corpus"}
            </button>
          </div>
        </div>

        <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(320px,1fr)]">
          <div className="min-h-0 min-w-0 rounded-lg border border-zinc-200 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Reader progress</p>
                <h3 className="mt-1 text-sm font-semibold text-zinc-950">
                  {chapterTitle ?? preparedChapter?.chapter_title ?? "No chapter loaded"}
                </h3>
              </div>
              <select
                value={progressPid}
                onChange={(event) => {
                  const value = event.target.value
                  setProgressPid(value === "chapter" ? "chapter" : Number(value))
                  clearAnswer()
                }}
                disabled={paragraphs.length === 0}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs"
              >
                <option value="chapter">Read through chapter</option>
                {paragraphs.map((paragraph) => (
                  <option key={paragraph.pid} value={paragraph.pid}>
                    Through P{paragraph.pid}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-3 max-h-[58vh] space-y-2 overflow-y-auto pr-1">
              {paragraphs.length === 0 ? (
                <div className="rounded-lg border border-dashed border-zinc-200 px-4 py-10 text-center text-sm text-zinc-500">
                  Run PRE.1 and PRE.2 before using the reading view.
                </div>
              ) : (
                paragraphs.map((paragraph) => {
                  const isRead = typeof progressEndPid === "number" && paragraph.pid <= progressEndPid
                  return (
                    <button
                      key={paragraph.pid}
                      id={createV3BookParagraphDomId(chapterId, paragraph.pid)}
                      type="button"
                      onClick={() => {
                        setProgressPid(paragraph.pid)
                        clearAnswer()
                      }}
                      className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                        isRead
                          ? "border-zinc-200 bg-white text-zinc-900 hover:border-zinc-300"
                          : "border-zinc-100 bg-zinc-50 text-zinc-400"
                      }`}
                    >
                      <span className="font-mono text-[11px] font-semibold text-zinc-500">P{paragraph.pid}</span>
                      <span className="mt-1 line-clamp-3 block text-sm leading-6">{paragraph.text}</span>
                    </button>
                  )
                })
              )}
            </div>
          </div>

          <div className="min-w-0 space-y-3">
            <div className="rounded-lg border border-zinc-200 bg-white p-3">
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Question</span>
                <textarea
                  value={question}
                  onChange={(event) => {
                    setQuestion(event.target.value)
                    clearAnswer()
                  }}
                  placeholder="Ask about what you have read so far..."
                  rows={4}
                  className="mt-2 w-full resize-none rounded-lg border border-zinc-200 px-3 py-2 text-sm leading-6 outline-none focus:border-zinc-400"
                />
              </label>
              <button
                type="button"
                onClick={() => void runAnswer()}
                disabled={!canSearch || loading}
                className="mt-3 h-9 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {loading ? "Answering" : "Ask"}
              </button>
              {!retrievalIndex && (
                <p className="mt-2 text-xs leading-5 text-zinc-500">Run IDX.1 before using QA retrieval.</p>
              )}
              {retrievalIndex && !semanticIndex && (
                <p className="mt-2 text-xs leading-5 text-zinc-500">Run IDX.2 to add semantic similarity. Lexical search remains available.</p>
              )}
              {corpusBuildError && <p className="mt-2 text-sm leading-5 text-red-600">{corpusBuildError}</p>}
              {error && <p className="mt-2 text-sm leading-5 text-red-600">{error}</p>}
            </div>

            {answerResult && (
              <section aria-live="polite" className="rounded-lg border border-zinc-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Answer</p>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    answerResult.answer.status === "answered"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-amber-50 text-amber-700"
                  }`}>
                    {answerResult.answer.status === "answered" ? "Grounded" : "Insufficient evidence"}
                  </span>
                </div>
                <p className="mt-3 text-sm font-medium leading-6 text-zinc-900">
                  {answerResult.answer.text || "The current reading evidence is not sufficient to answer without guessing."}
                </p>
                {answerResult.answer.citations.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-zinc-500">Source paragraphs</span>
                    {answerResult.answer.citations.map((citation) => (
                      <button
                        key={citation.pid}
                        type="button"
                        onClick={() => document.getElementById(createV3BookParagraphDomId(chapterId, citation.pid))?.scrollIntoView({ behavior: "smooth", block: "center" })}
                        className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 font-mono text-xs font-semibold text-zinc-700 hover:border-zinc-400"
                        title={citation.paragraph_text}
                      >
                        P{citation.pid}
                      </button>
                    ))}
                  </div>
                )}
                {answerResult.answer.used_evidence.length > 0 && (
                  <p className="mt-2 text-xs text-zinc-500">
                    Grounded in {answerResult.answer.used_evidence.length} retrieved record{answerResult.answer.used_evidence.length === 1 ? "" : "s"}.
                  </p>
                )}
              </section>
            )}

            {result && (
              <div className="grid min-w-0 grid-cols-2 gap-2 xl:grid-cols-4">
                <Stat label="Searched" value={result.stats.searched_records} />
                <Stat label="Blocked" value={result.stats.blocked_ahead_records} />
                <Stat label="Semantic" value={result.stats.semantic_hits} />
                <Stat label="Returned" value={visibleHits.length} />
              </div>
            )}

            <div className="min-w-0 max-h-[50vh] space-y-2 overflow-y-auto pr-1">
              {visibleHits.map((hit) => (
                <article key={`${hit.match_kind}-${hit.record_id}`} className="min-w-0 rounded-lg border border-zinc-200 bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="rounded-md bg-zinc-100 px-2 py-1 font-mono text-[11px] font-semibold text-zinc-600">
                        {hit.record_type}
                      </span>
                      <h3 className="truncate text-sm font-semibold text-zinc-950">{hit.label}</h3>
                    </div>
                    <span className="text-xs text-zinc-500">
                      {hit.match_kind}
                      {typeof hit.semantic_similarity === "number" ? ` / sim ${hit.semantic_similarity.toFixed(3)}` : ""}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-zinc-700">{evidencePreview(hit.text)}</p>
                  {hit.text.length > EVIDENCE_PREVIEW_LENGTH && (
                    <details className="mt-2 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                      <summary className="cursor-pointer font-medium text-zinc-700">Show full evidence text</summary>
                      <p className="mt-2 whitespace-pre-wrap leading-5">{hit.text}</p>
                    </details>
                  )}
                  <p className="mt-2 text-xs text-zinc-500">
                    {spanLabel(hit.text_span?.start_pid, hit.text_span?.end_pid)}
                  </p>
                  {hit.evidence_refs.length > 0 && (
                    <details className="mt-2 text-xs text-zinc-500">
                      <summary className="cursor-pointer font-medium">
                        Debug evidence IDs ({hit.evidence_refs.length})
                      </summary>
                      <p className="mt-1 break-all font-mono text-[11px] leading-5 text-zinc-400">
                        {hit.evidence_refs.join(", ")}
                      </p>
                    </details>
                  )}
                  {hit.matched_terms.length > 0 && (
                    <p className="mt-1 text-xs text-zinc-500">Lexical: {hit.matched_terms.join(", ")}</p>
                  )}
                </article>
              ))}
              {result && visibleHits.length === 0 && (
                <div className="rounded-lg border border-dashed border-zinc-200 bg-white px-4 py-10 text-center text-sm text-zinc-500">
                  No evidence matched within the selected reading progress.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <V3QAHistoryPanel
        entries={historyEntries}
        selectedEntryId={selectedHistoryId}
        loading={historyLoading}
        loadingMore={historyLoadingMore}
        saving={historySaving}
        deletingEntryId={deletingHistoryId}
        hasMore={historyHasMore}
        loadError={historyLoadError}
        saveError={historySaveError}
        deleteError={historyDeleteError}
        onSelect={selectHistoryEntry}
        onDelete={(entry) => void removeHistoryEntry(entry)}
        onLoadMore={() => void loadMoreHistory()}
      />
    </section>
  )
}

function V3BookReadingQAView({
  docId,
  chapterId,
  chapterTitle,
  runId,
  preparedChapter,
  contentUnits,
  qaCorpusId,
  readerPosition,
}: Props & { qaCorpusId: string }) {
  const router = useRouter()
  const paragraphs = useMemo(() => storyParagraphs(preparedChapter, contentUnits), [preparedChapter, contentUnits])
  const lastPid = paragraphs.at(-1)?.pid
  const [corpus, setCorpus] = useState<StoredV3BookQACorpus | null>(null)
  const [corpusLoading, setCorpusLoading] = useState(true)
  const [corpusBuilding, setCorpusBuilding] = useState(false)
  const [corpusError, setCorpusError] = useState<string | null>(null)
  const [question, setQuestion] = useState("")
  const [answerResult, setAnswerResult] = useState<V3BookQAHistoryAnswerSnapshot | null>(null)
  const [answerReaderPosition, setAnswerReaderPosition] = useState<V3BookReaderPosition | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [historyEntries, setHistoryEntries] = useState<V3BookQAHistoryEntry[]>([])
  const [historyCursor, setHistoryCursor] = useState<string | null>(null)
  const [historyHasMore, setHistoryHasMore] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false)
  const [historySaving, setHistorySaving] = useState(false)
  const [historyLoadError, setHistoryLoadError] = useState<string | null>(null)
  const [historySaveError, setHistorySaveError] = useState<string | null>(null)
  const [historyDeleteError, setHistoryDeleteError] = useState<string | null>(null)
  const [deletingHistoryId, setDeletingHistoryId] = useState<string | null>(null)
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null)
  const requestGeneration = useRef(0)
  const historyScopeGeneration = useRef(0)

  useEffect(() => {
    let cancelled = false
    void loadV3BookQACorpus(docId, qaCorpusId)
      .then((stored) => {
        if (!cancelled) setCorpus(stored)
      })
      .catch((loadError) => {
        if (!cancelled) setCorpusError(loadError instanceof Error ? loadError.message : String(loadError))
      })
      .finally(() => {
        if (!cancelled) setCorpusLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [docId, qaCorpusId])

  useEffect(() => {
    let cancelled = false
    const scopeGeneration = historyScopeGeneration.current + 1
    historyScopeGeneration.current = scopeGeneration
    requestGeneration.current += 1
    void listV3BookQAHistory({ docId, qaCorpusId })
      .then((page) => {
        if (cancelled || historyScopeGeneration.current !== scopeGeneration) return
        setHistoryEntries((current) => mergeBookHistoryEntries(current, page.entries))
        setHistoryCursor(page.next_cursor)
        setHistoryHasMore(page.has_more)
      })
      .catch((historyError) => {
        if (!cancelled && historyScopeGeneration.current === scopeGeneration) {
          setHistoryLoadError(historyError instanceof Error ? historyError.message : String(historyError))
        }
      })
      .finally(() => {
        if (!cancelled && historyScopeGeneration.current === scopeGeneration) setHistoryLoading(false)
      })
    return () => {
      cancelled = true
      if (historyScopeGeneration.current === scopeGeneration) {
        historyScopeGeneration.current = scopeGeneration + 1
      }
    }
  }, [docId, qaCorpusId])

  const readiness = useMemo(
    () => corpus && readerPosition
      ? createV3BookQAReadinessViewModel(corpus.manifest, readerPosition)
      : null,
    [corpus, readerPosition],
  )
  const chapterTitles = useMemo(
    () => Object.fromEntries(corpus?.manifest.chapters.map((chapter) => [chapter.chapter_id, chapter.chapter_title]) ?? []),
    [corpus],
  )
  const readableParagraphs = useMemo(
    () => corpus && readerPosition
      ? filterV3BookReadableParagraphs(corpus.manifest, readerPosition, chapterId, paragraphs)
      : [],
    [chapterId, corpus, paragraphs, readerPosition],
  )
  const hiddenParagraphCount = paragraphs.length - readableParagraphs.length
  const readerChapterTitle = readerPosition
    ? chapterTitles[readerPosition.chapter_id] ?? readerPosition.chapter_id
    : "Reader position missing"
  const canSearch = Boolean(
    corpus
    && readerPosition
    && readiness?.status === "ready"
    && question.trim(),
  )
  const result = answerResult?.retrieval ?? null
  const visibleHits = result?.hits ?? []

  function clearAnswer() {
    requestGeneration.current += 1
    setAnswerResult(null)
    setAnswerReaderPosition(null)
    setSelectedHistoryId(null)
    setError(null)
    setLoading(false)
  }

  async function rebuildBookCorpus() {
    if (corpusBuilding) return
    setCorpusBuilding(true)
    setCorpusError(null)
    try {
      const chapterRunIds = createV3BookQACorpusBuildRunIds(corpus?.manifest)
      const stored = await buildV3BookQACorpus({
        docId,
        ...(chapterRunIds ? { chapterRunIds } : {}),
      })
      const displayedChapter = stored.manifest.chapters.find((item) => item.chapter_id === chapterId)
      if (!displayedChapter) throw new Error("The displayed chapter is not pinned in the rebuilt BOOK.1 corpus.")
      const requestedReaderChapterId = readerPosition?.chapter_id ?? chapterId
      const readerChapter = stored.manifest.chapters.find((item) => item.chapter_id === requestedReaderChapterId)
        ?? displayedChapter
      const requestedPid = readerPosition?.pid ?? lastPid ?? readerChapter.progress_end_pid
      const nextReaderPosition = {
        chapter_id: readerChapter.chapter_id,
        pid: Math.min(requestedPid, readerChapter.progress_end_pid),
      }
      setCorpus(stored)
      router.replace(createV3WorkbenchHref({
        docId,
        chapterId: displayedChapter.chapter_id,
        runId: displayedChapter.run_id,
        source: "v3",
        view: "qa",
        qaCorpusId: stored.manifest.qa_corpus_id,
        readerPosition: nextReaderPosition,
      }), { scroll: false })
    } catch (buildError) {
      setCorpusError(buildError instanceof Error ? buildError.message : String(buildError))
    } finally {
      setCorpusBuilding(false)
    }
  }

  async function persistHistory(
    resultToSave: V3BookQAAnswerResult,
    savedQuestion: string,
    savedReaderPosition: V3BookReaderPosition,
    requestId: number,
    scopeGeneration: number,
  ) {
    setHistorySaving(true)
    setHistorySaveError(null)
    try {
      const saved = await saveV3BookQAHistory({
        docId,
        qaCorpusId,
        question: savedQuestion,
        readerPosition: savedReaderPosition,
        answerSnapshot: createV3BookQAHistoryAnswerSnapshot(resultToSave),
      })
      if (historyScopeGeneration.current !== scopeGeneration) return
      setHistoryEntries((current) => mergeBookHistoryEntries([saved], current))
      if (requestGeneration.current === requestId) setSelectedHistoryId(saved.entry_id)
    } catch (historyError) {
      if (historyScopeGeneration.current === scopeGeneration) {
        setHistorySaveError(historyError instanceof Error ? historyError.message : String(historyError))
      }
    } finally {
      if (historyScopeGeneration.current === scopeGeneration) setHistorySaving(false)
    }
  }

  async function runAnswer() {
    if (!canSearch || !readerPosition) return
    const requestId = requestGeneration.current + 1
    const scopeGeneration = historyScopeGeneration.current
    const savedQuestion = question.trim()
    const savedReaderPosition = { ...readerPosition }
    requestGeneration.current = requestId
    setLoading(true)
    setError(null)
    try {
      const next = await answerV3BookQuestion({
        docId,
        qaCorpusId,
        question: savedQuestion,
        readerPosition: savedReaderPosition,
      })
      if (requestGeneration.current !== requestId) return
      setAnswerResult(next)
      setAnswerReaderPosition(savedReaderPosition)
      setSelectedHistoryId(null)
      void persistHistory(next, savedQuestion, savedReaderPosition, requestId, scopeGeneration)
    } catch (answerError) {
      if (requestGeneration.current !== requestId) return
      setError(answerError instanceof Error ? answerError.message : String(answerError))
      setAnswerResult(null)
      setAnswerReaderPosition(null)
    } finally {
      if (requestGeneration.current === requestId) setLoading(false)
    }
  }

  async function loadMoreHistory() {
    if (!historyCursor || historyLoadingMore) return
    const scopeGeneration = historyScopeGeneration.current
    const cursor = historyCursor
    setHistoryLoadingMore(true)
    setHistoryLoadError(null)
    try {
      const page = await listV3BookQAHistory({ docId, qaCorpusId, cursor })
      if (historyScopeGeneration.current !== scopeGeneration) return
      setHistoryEntries((current) => mergeBookHistoryEntries(current, page.entries))
      setHistoryCursor(page.next_cursor)
      setHistoryHasMore(page.has_more)
    } catch (historyError) {
      if (historyScopeGeneration.current === scopeGeneration) {
        setHistoryLoadError(historyError instanceof Error ? historyError.message : String(historyError))
      }
    } finally {
      if (historyScopeGeneration.current === scopeGeneration) setHistoryLoadingMore(false)
    }
  }

  function selectHistoryEntry(entry: V3BookQAHistoryEntry) {
    requestGeneration.current += 1
    setLoading(false)
    setError(null)
    setQuestion(entry.question)
    setAnswerResult(entry.answer_snapshot)
    setAnswerReaderPosition({ ...entry.reader_position })
    setSelectedHistoryId(entry.entry_id)
  }

  async function removeHistoryEntry(entry: V3BookQAHistoryEntry) {
    if (!window.confirm("Delete this saved book question?")) return
    const scopeGeneration = historyScopeGeneration.current
    setDeletingHistoryId(entry.entry_id)
    setHistoryDeleteError(null)
    try {
      await deleteV3BookQAHistory({ docId, qaCorpusId, entryId: entry.entry_id })
      if (historyScopeGeneration.current !== scopeGeneration) return
      setHistoryEntries((current) => current.filter((item) => item.entry_id !== entry.entry_id))
      if (selectedHistoryId === entry.entry_id) clearAnswer()
    } catch (historyError) {
      if (historyScopeGeneration.current === scopeGeneration) {
        setHistoryDeleteError(historyError instanceof Error ? historyError.message : String(historyError))
      }
    } finally {
      if (historyScopeGeneration.current === scopeGeneration) setDeletingHistoryId(null)
    }
  }

  function followCitation(citation: V3BookQAHistoryAnswerSnapshot["answer"]["citations"][number]) {
    const citationReaderPosition = answerReaderPosition ?? readerPosition
    if (!corpus || !citationReaderPosition) return
    const action = createV3BookCitationAction({
      docId,
      displayedChapterId: chapterId,
      qaCorpusId,
      readerPosition: citationReaderPosition,
      manifest: corpus.manifest,
      citation,
    })
    if (action.kind === "scroll") {
      document.getElementById(action.targetId)?.scrollIntoView({ behavior: "smooth", block: "center" })
    } else if (action.kind === "navigate") {
      router.push(action.href)
    } else {
      setError(action.reason)
    }
  }

  return (
    <section className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-h-0 min-w-0 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Book reading QA</p>
            <h2 className="mt-1 text-lg font-semibold text-zinc-950">Reader-position-bounded answers across chapters</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              readiness?.status === "ready" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
            }`}>
              {(result?.stats.semantic_hits ?? 0) > 0 ? "BOOK.1 hybrid" : "BOOK.1"}
            </span>
            <button
              type="button"
              onClick={() => void rebuildBookCorpus()}
              disabled={corpusBuilding}
              className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {corpusBuilding ? "Rebuilding..." : "Rebuild corpus"}
            </button>
          </div>
        </div>

        <div className={`mt-4 rounded-lg border px-3 py-3 ${
          readiness?.status === "ready"
            ? "border-emerald-200 bg-emerald-50"
            : "border-amber-200 bg-amber-50"
        }`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">BOOK.1 readiness</p>
              <p className="mt-1 text-sm font-medium text-zinc-900">
                {corpusLoading
                  ? "Loading the pinned corpus..."
                  : !readerPosition
                    ? "Reader position is missing from the URL. Rebuild the corpus to restore it."
                    : readiness?.message ?? "Corpus readiness is unavailable."}
              </p>
            </div>
            <span className="max-w-full break-all font-mono text-[11px] text-zinc-500">{qaCorpusId}</span>
          </div>
          {readerPosition ? (
            <p className="mt-2 text-xs text-zinc-600">Original reader position: {readerChapterTitle} / P{readerPosition.pid}</p>
          ) : null}
          {readiness && readiness.diagnostics.length > 0 ? (
            <ul className="mt-2 space-y-1 text-xs leading-5 text-amber-900">
              {readiness.diagnostics.map((diagnostic) => (
                <li key={`${diagnostic.chapter_id}:${diagnostic.run_id}:${diagnostic.stage_id}:${diagnostic.code}`}>
                  {(chapterTitles[diagnostic.chapter_id] ?? diagnostic.chapter_id)} / {diagnostic.stage_id}: {diagnostic.message}
                </li>
              ))}
            </ul>
          ) : null}
          {corpusError ? <p className="mt-2 text-sm leading-5 text-red-600">{corpusError}</p> : null}
        </div>

        <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(320px,1fr)]">
          <div className="min-h-0 min-w-0 rounded-lg border border-zinc-200 bg-white p-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Displayed chapter</p>
              <h3 className="mt-1 text-sm font-semibold text-zinc-950">
                {chapterTitle ?? preparedChapter?.chapter_title ?? chapterTitles[chapterId] ?? "No chapter loaded"}
              </h3>
              <p className="mt-1 font-mono text-[11px] text-zinc-500">Pinned run: {runId}</p>
            </div>

            <div className="mt-3 max-h-[58vh] space-y-2 overflow-y-auto pr-1">
              {paragraphs.length === 0 ? (
                <div className="rounded-lg border border-dashed border-zinc-200 px-4 py-10 text-center text-sm text-zinc-500">
                  The pinned PRE.1/PRE.2 artifacts are not available in this displayed run.
                </div>
              ) : readableParagraphs.length === 0 ? (
                <div className="rounded-lg border border-dashed border-zinc-200 px-4 py-10 text-center text-sm text-zinc-500">
                  Paragraph text is hidden because this chapter is outside the original reader position.
                </div>
              ) : (
                <>
                  {readableParagraphs.map((paragraph) => (
                    <article
                      key={paragraph.pid}
                      id={createV3BookParagraphDomId(chapterId, paragraph.pid)}
                      className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left text-zinc-900"
                    >
                      <span className="font-mono text-[11px] font-semibold text-zinc-500">P{paragraph.pid}</span>
                      <span className="mt-1 line-clamp-3 block text-sm leading-6">{paragraph.text}</span>
                    </article>
                  ))}
                  {hiddenParagraphCount > 0 ? (
                    <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-3 py-3 text-center text-xs text-zinc-500">
                      {hiddenParagraphCount} later paragraph{hiddenParagraphCount === 1 ? "" : "s"} hidden at the original reader position.
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>

          <div className="min-w-0 space-y-3">
            <div className="rounded-lg border border-zinc-200 bg-white p-3">
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Question</span>
                <textarea
                  value={question}
                  onChange={(event) => {
                    setQuestion(event.target.value)
                    clearAnswer()
                  }}
                  placeholder="Ask about any chapter you have read so far..."
                  rows={4}
                  className="mt-2 w-full resize-none rounded-lg border border-zinc-200 px-3 py-2 text-sm leading-6 outline-none focus:border-zinc-400"
                />
              </label>
              <button
                type="button"
                onClick={() => void runAnswer()}
                disabled={!canSearch || loading}
                className="mt-3 h-9 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {loading ? "Answering" : "Ask across readable chapters"}
              </button>
              {readiness?.status === "blocked" ? (
                <p className="mt-2 text-xs leading-5 text-zinc-500">Rebuild missing or stale pinned artifacts before asking a book-scoped question.</p>
              ) : null}
              {error ? <p className="mt-2 text-sm leading-5 text-red-600">{error}</p> : null}
            </div>

            {answerResult ? (
              <section aria-live="polite" className="rounded-lg border border-zinc-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Answer</p>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    answerResult.answer.status === "answered"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-amber-50 text-amber-700"
                  }`}>
                    {answerResult.answer.status === "answered" ? "Grounded" : "Insufficient evidence"}
                  </span>
                </div>
                <p className="mt-3 text-sm font-medium leading-6 text-zinc-900">
                  {answerResult.answer.text || "The readable book evidence is not sufficient to answer without guessing."}
                </p>
                {answerResult.answer.citations.length > 0 ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-zinc-500">Source paragraphs</span>
                    {answerResult.answer.citations.map((citation) => (
                      <button
                        key={`${citation.chapter_id}:${citation.pid}`}
                        type="button"
                        onClick={() => followCitation(citation)}
                        className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 font-mono text-xs font-semibold text-zinc-700 hover:border-zinc-400"
                        title={citation.paragraph_text}
                      >
                        {citation.chapter_title} / P{citation.pid}
                      </button>
                    ))}
                  </div>
                ) : null}
                {answerResult.answer.used_evidence.length > 0 ? (
                  <p className="mt-2 text-xs text-zinc-500">
                    Grounded in {answerResult.answer.used_evidence.length} retrieved record{answerResult.answer.used_evidence.length === 1 ? "" : "s"}.
                  </p>
                ) : null}
              </section>
            ) : null}

            {result ? (
              <div className="grid min-w-0 grid-cols-2 gap-2 xl:grid-cols-4">
                <Stat label="Chapters" value={result.stats.readable_chapters} />
                <Stat label="Searched" value={result.stats.searched_records} />
                <Stat label="Blocked" value={result.stats.blocked_ahead_records} />
                <Stat label="Returned" value={visibleHits.length} />
              </div>
            ) : null}

            <div className="min-w-0 max-h-[50vh] space-y-2 overflow-y-auto pr-1">
              {visibleHits.map((hit) => (
                <article key={`${hit.chapter_id}:${hit.match_kind}:${hit.record_id}`} className="min-w-0 rounded-lg border border-zinc-200 bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="rounded-md bg-zinc-100 px-2 py-1 font-mono text-[11px] font-semibold text-zinc-600">
                        {hit.record_type}
                      </span>
                      <h3 className="truncate text-sm font-semibold text-zinc-950">{hit.label}</h3>
                    </div>
                    <span className="text-xs text-zinc-500">
                      {hit.match_kind}
                      {typeof hit.semantic_similarity === "number" ? ` / sim ${hit.semantic_similarity.toFixed(3)}` : ""}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-zinc-700">{evidencePreview(hit.text)}</p>
                  {hit.text.length > EVIDENCE_PREVIEW_LENGTH ? (
                    <details className="mt-2 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                      <summary className="cursor-pointer font-medium text-zinc-700">Show full evidence text</summary>
                      <p className="mt-2 whitespace-pre-wrap leading-5">{hit.text}</p>
                    </details>
                  ) : null}
                  <p className="mt-2 text-xs text-zinc-500">
                    {hit.chapter_title} / {spanLabel(hit.text_span?.start_pid, hit.text_span?.end_pid)}
                  </p>
                  {hit.evidence_refs.length > 0 ? (
                    <details className="mt-2 text-xs text-zinc-500">
                      <summary className="cursor-pointer font-medium">Debug evidence IDs ({hit.evidence_refs.length})</summary>
                      <p className="mt-1 break-all font-mono text-[11px] leading-5 text-zinc-400">{hit.evidence_refs.join(", ")}</p>
                    </details>
                  ) : null}
                  {hit.matched_terms.length > 0 ? (
                    <p className="mt-1 text-xs text-zinc-500">Lexical: {hit.matched_terms.join(", ")}</p>
                  ) : null}
                </article>
              ))}
              {result && visibleHits.length === 0 ? (
                <div className="rounded-lg border border-dashed border-zinc-200 bg-white px-4 py-10 text-center text-sm text-zinc-500">
                  No evidence matched within the original reader position.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      <V3BookQAHistoryPanel
        entries={historyEntries}
        chapterTitles={chapterTitles}
        selectedEntryId={selectedHistoryId}
        loading={historyLoading}
        loadingMore={historyLoadingMore}
        saving={historySaving}
        deletingEntryId={deletingHistoryId}
        hasMore={historyHasMore}
        loadError={historyLoadError}
        saveError={historySaveError}
        deleteError={historyDeleteError}
        onSelect={selectHistoryEntry}
        onDelete={(entry) => void removeHistoryEntry(entry)}
        onLoadMore={() => void loadMoreHistory()}
      />
    </section>
  )
}

export default function V3ReadingQAView(props: Props) {
  return props.qaCorpusId
    ? <V3BookReadingQAView key={`book:${props.docId}:${props.qaCorpusId}`} {...props} qaCorpusId={props.qaCorpusId} />
    : <LegacyV3ReadingQAView key={`legacy:${props.docId}:${props.chapterId}:${props.runId}`} {...props} />
}
