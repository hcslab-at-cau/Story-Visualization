"use client"

/**
 * FINAL.3 - Reader Screen
 * Merges FINAL.1 (SceneReaderPackageLog) + FINAL.2 (OverlayRefinementResult, optional)
 * and renders the clean reader UI.
 */

import { useEffect, useRef, useState, type ReactNode } from "react"
import { useUiStrings } from "@/components/LanguageProvider"
import { governReaderSupport } from "@/lib/support-governor"
import type { UiStrings } from "@/lib/ui-strings"
import { scoreVisualSupport } from "@/lib/visual-support-policy"
import type {
  BookEntityThread,
  BookMemoryEdge,
  BookMemoryEdgeType,
  BookMemorySceneRef,
  BookMemorySnapshot,
} from "@/types/book-memory"
import type {
  CompactHint,
  OverlayCharacter,
  OverlayRefinementCharacter,
  OverlayRefinementResult,
  ReaderCharacterView,
  ReaderGlobalView,
  ReaderPairView,
  ReaderSupportEvent,
  SceneReaderPackageLog,
  SceneReaderPacket,
  SupportUnit,
} from "@/types/schema"

const CONF_THRESHOLD = 0.5
const READER_REENTRY_GAP_MS = 10 * 60 * 1000
export type ReaderScreenMode = "reader" | "researcher"

function readResumeGapMs(docId: string): number {
  if (typeof window === "undefined") return 0
  const previous = Number(window.localStorage.getItem(`story-reader:last-active:${docId}`))
  if (!Number.isFinite(previous) || previous <= 0) return 0
  return Math.max(0, Date.now() - previous)
}

function createReaderSessionId(docId: string): string {
  if (typeof window === "undefined") return `reader-session-${docId}`
  const storageKey = `story-reader:session:${docId}`
  const existing = window.localStorage.getItem(storageKey)
  if (existing) return existing
  const randomSuffix = Math.random().toString(36).slice(2, 10)
  const sessionId = `reader_${Date.now().toString(36)}_${randomSuffix}`
  window.localStorage.setItem(storageKey, sessionId)
  return sessionId
}

function postReaderSupportEvent(params: {
  docId: string
  chapterId: string
  sceneId: string
  readerRunId: string
  sessionId: string
  unit: SupportUnit
  action: ReaderSupportEvent["action"]
  reason?: string
}) {
  const createdAt = new Date().toISOString()
  void fetch("/api/support-events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      doc_id: params.docId,
      session_id: params.sessionId,
      scene_key: `${params.chapterId}:${params.sceneId}`,
      chapter_id: params.chapterId,
      scene_id: params.sceneId,
      reader_run_id: params.readerRunId,
      unit_id: params.unit.unit_id,
      unit_kind: params.unit.kind,
      reader_problem: params.unit.reader_problem,
      action: params.action,
      reason: params.reason,
      created_at: createdAt,
    }),
  }).catch(() => undefined)
}

const READER_PANEL_BUTTON_META: Record<
  string,
  { idle: string; active: string; icon: string }
> = {
  goal: {
    idle: "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100",
    active: "border-amber-500 bg-amber-500 text-white shadow-sm",
    icon: "G",
  },
  problem: {
    idle: "border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100",
    active: "border-rose-500 bg-rose-500 text-white shadow-sm",
    icon: "P",
  },
  what_changed: {
    idle: "border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100",
    active: "border-sky-500 bg-sky-500 text-white shadow-sm",
    icon: "C",
  },
  why_it_matters: {
    idle: "border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100",
    active: "border-violet-500 bg-violet-500 text-white shadow-sm",
    icon: "I",
  },
  object: {
    idle: "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100",
    active: "border-emerald-500 bg-emerald-500 text-white shadow-sm",
    icon: "O",
  },
  action: {
    idle: "border-zinc-200 bg-zinc-50 text-zinc-800 hover:bg-zinc-100",
    active: "border-zinc-800 bg-zinc-800 text-white shadow-sm",
    icon: "A",
  },
  event: {
    idle: "border-cyan-200 bg-cyan-50 text-cyan-800 hover:bg-cyan-100",
    active: "border-cyan-500 bg-cyan-500 text-white shadow-sm",
    icon: "E",
  },
}

const READER_PANEL_BUTTON_ORDER = [
  "goal",
  "problem",
  "what_changed",
  "why_it_matters",
  "object",
  "action",
  "event",
] as const

function getContainedImageRect(params: {
  naturalWidth: number
  naturalHeight: number
  containerWidth: number
  containerHeight: number
}) {
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

  const imageRatio = naturalWidth / naturalHeight
  const containerRatio = containerWidth / containerHeight

  if (imageRatio > containerRatio) {
    const width = containerWidth
    const height = width / imageRatio
    return {
      left: 0,
      top: (containerHeight - height) / 2,
      width,
      height,
    }
  }

  const height = containerHeight
  const width = height * imageRatio
  return {
    left: (containerWidth - width) / 2,
    top: 0,
    width,
    height,
  }
}

function pairKeyFromIds(characterIds: string[]): string {
  return [...characterIds].sort().join("__")
}

function buildMergedOverlay(
  packet: SceneReaderPacket,
  activeSubsceneId: string,
  refinementScene?: OverlayRefinementResult["scenes"][0],
): Array<{ coarse: OverlayCharacter; refined?: OverlayRefinementCharacter }> {
  const coarseCharacters = packet.subscene_views[activeSubsceneId]?.overlay_characters ?? []
  const refinementSubscene = refinementScene?.subscenes.find((item) => item.subscene_id === activeSubsceneId)
  const refinementMap = new Map(
    refinementSubscene?.characters.map((character) => [character.character_id, character]) ?? [],
  )

  const result: Array<{ coarse: OverlayCharacter; refined?: OverlayRefinementCharacter }> = []
  for (const coarse of coarseCharacters) {
    const refined = refinementMap.get(coarse.character_id)
    if (refined?.visibility === "not_visible" && refined.confidence >= CONF_THRESHOLD) {
      continue
    }
    result.push({ coarse, refined })
  }

  return result
}

function CharacterGlyph({ label }: { label: string }) {
  const isRabbit = /rabbit/i.test(label)

  if (isRabbit) {
    return (
      <svg viewBox="0 0 64 64" className="h-7 w-7 fill-current" aria-hidden="true">
        <path d="M24 10c0-5 3-8 7-8s7 3 7 8v10c0 3-2 5-4 5h-6c-2 0-4-2-4-5z" />
        <path d="M12 14c0-4 3-7 7-7 3 0 5 2 5 5v9c0 3-2 5-4 5h-4c-2 0-4-2-4-5z" />
        <circle cx="32" cy="31" r="12" />
        <path d="M16 54c2-10 9-15 16-15s14 5 16 15H16z" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 64 64" className="h-7 w-7 fill-current" aria-hidden="true">
      <circle cx="32" cy="20" r="10" />
      <path d="M14 56c2-14 10-22 18-22s16 8 18 22H14z" />
    </svg>
  )
}

function CharacterButton({
  coarse,
  left,
  top,
  selected,
  onToggle,
}: {
  coarse: OverlayCharacter
  left: number
  top: number
  selected: boolean
  onToggle: () => void
}) {
  return (
    <div
      className="absolute"
      style={{ left, top, transform: "translate(-50%, -94%)" }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={coarse.label}
        title={coarse.label}
        className={`flex flex-col items-center gap-1.5 rounded-2xl px-2.5 py-2 shadow-md ring-2 backdrop-blur-sm transition-all hover:-translate-y-0.5 ${
          selected
            ? "bg-zinc-900 text-white ring-zinc-900"
            : "bg-white/92 text-sky-700 ring-white/85 hover:bg-white"
        }`}
      >
        <span
          className={`flex h-10 w-10 items-center justify-center rounded-full ${
            selected
              ? "bg-white/15 text-white"
              : "bg-gradient-to-b from-sky-500 to-blue-700 text-white"
          }`}
        >
          <CharacterGlyph label={coarse.label} />
        </span>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium leading-none ${
            selected ? "bg-white/15 text-white" : "bg-zinc-900 text-white"
          }`}
        >
          {coarse.label}
        </span>
      </button>
    </div>
  )
}

const MEMORY_EDGE_STYLE: Record<BookMemoryEdgeType, string> = {
  chapter_sequence: "border-zinc-200 bg-zinc-50 text-zinc-700",
  cross_chapter_character_thread: "border-amber-200 bg-amber-50 text-amber-800",
  cross_chapter_same_place: "border-emerald-200 bg-emerald-50 text-emerald-800",
  cross_chapter_place_shift: "border-cyan-200 bg-cyan-50 text-cyan-800",
  cross_chapter_causal_bridge: "border-rose-200 bg-rose-50 text-rose-800",
  entity_reappearance: "border-sky-200 bg-sky-50 text-sky-800",
}

type MemoryTab = "bridges" | "threads" | "path"

interface ReaderMemoryContext {
  sceneKey: string
  sceneRef?: BookMemorySceneRef
  chapterRunId?: string
  runMatchesBookMemory: boolean
  incomingEdges: BookMemoryEdge[]
  outgoingEdges: BookMemoryEdge[]
  threads: Array<{
    thread: BookEntityThread
    currentOccurrence?: BookEntityThread["occurrences"][number]
    firstSceneMatch: boolean
  }>
  nearbyScenes: BookMemorySceneRef[]
}

function sceneKeyFor(chapterId: string, sceneId: string): string {
  return `${chapterId}:${sceneId}`
}

function sortBookScenes(scenes: BookMemorySceneRef[]): BookMemorySceneRef[] {
  return [...scenes].sort((a, b) => {
    if (a.chapterIndex !== b.chapterIndex) return a.chapterIndex - b.chapterIndex
    if (a.startPid !== b.startPid) return a.startPid - b.startPid
    return a.sceneId.localeCompare(b.sceneId)
  })
}

function sortMemoryEdges(edges: BookMemoryEdge[]): BookMemoryEdge[] {
  const priority: Record<BookMemoryEdgeType, number> = {
    cross_chapter_causal_bridge: 0,
    cross_chapter_place_shift: 1,
    cross_chapter_same_place: 2,
    cross_chapter_character_thread: 3,
    entity_reappearance: 4,
    chapter_sequence: 5,
  }
  return [...edges].sort((a, b) => {
    const priorityDelta = priority[a.type] - priority[b.type]
    if (priorityDelta !== 0) return priorityDelta
    return b.weight - a.weight
  })
}

function buildReaderMemoryContext(
  bookMemory: BookMemorySnapshot | undefined,
  final1: SceneReaderPackageLog,
  packet: SceneReaderPacket,
  readerRunId: string,
): ReaderMemoryContext | null {
  if (!bookMemory) return null

  const sceneKey = sceneKeyFor(final1.chapter_id, packet.scene_id)
  const sceneMap = new Map(bookMemory.sceneRefs.map((scene) => [scene.sceneKey, scene]))
  const orderedScenes = sortBookScenes(bookMemory.sceneRefs)
  const sceneIndex = orderedScenes.findIndex((scene) => scene.sceneKey === sceneKey)
  const nearbyScenes = sceneIndex >= 0
    ? orderedScenes.slice(Math.max(0, sceneIndex - 1), Math.min(orderedScenes.length, sceneIndex + 2))
    : []
  const chapterRunId = bookMemory.chapterRunIds[final1.chapter_id]

  const threads = bookMemory.entityThreads
    .map((thread) => {
      const currentOccurrence = thread.occurrences.find(
        (occurrence) => occurrence.chapterId === final1.chapter_id,
      )
      if (!currentOccurrence) return null
      return {
        thread,
        currentOccurrence,
        firstSceneMatch: currentOccurrence.firstSceneKey === sceneKey,
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => {
      if (a.firstSceneMatch !== b.firstSceneMatch) return a.firstSceneMatch ? -1 : 1
      return b.thread.totalMentions - a.thread.totalMentions
    })

  return {
    sceneKey,
    sceneRef: sceneMap.get(sceneKey),
    chapterRunId,
    runMatchesBookMemory: !chapterRunId || chapterRunId === readerRunId,
    incomingEdges: sortMemoryEdges(bookMemory.edges.filter((edge) => edge.toSceneKey === sceneKey)),
    outgoingEdges: sortMemoryEdges(bookMemory.edges.filter((edge) => edge.fromSceneKey === sceneKey)),
    threads,
    nearbyScenes,
  }
}

function compactSceneLabel(scene: BookMemorySceneRef | undefined, fallbackKey: string): string {
  if (!scene) return fallbackKey
  return `${scene.chapterTitle} / ${scene.sceneTitle || scene.sceneId}`
}

function MemoryEdgeCard({
  edge,
  direction,
  sceneMap,
}: {
  edge: BookMemoryEdge
  direction: "incoming" | "outgoing"
  sceneMap: Map<string, BookMemorySceneRef>
}) {
  const { t } = useUiStrings()
  const otherSceneKey = direction === "incoming" ? edge.fromSceneKey : edge.toSceneKey
  const otherScene = sceneMap.get(otherSceneKey)
  const localizedDirectionLabel =
    direction === "incoming" ? t.reader.memory.incoming : t.reader.memory.outgoing
  const directionLabel = direction === "incoming" ? "이전 연결" : "다음 연결"

  return (
    <article className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${MEMORY_EDGE_STYLE[edge.type]}`}>
          {t.reader.memory.edgeLabel[edge.type]}
        </span>
        <span className="text-[11px] font-medium text-zinc-400">{localizedDirectionLabel || directionLabel}</span>
      </div>
      <p className="mt-2 text-sm leading-6 text-zinc-700">{edge.label}</p>
      <p className="mt-2 truncate text-xs text-zinc-400">
        {direction === "incoming" ? `${t.reader.memory.from} ` : `${t.reader.memory.to} `}
        {compactSceneLabel(otherScene, otherSceneKey)}
      </p>
      {edge.evidence.length > 0 && (
        <p className="mt-1 text-[11px] text-zinc-400">{t.common.evidence} {edge.evidence.length}</p>
      )}
    </article>
  )
}

function ThreadChip({
  item,
}: {
  item: ReaderMemoryContext["threads"][number]
}) {
  const { t } = useUiStrings()
  return (
    <div className={`rounded-xl border px-3 py-2 ${
      item.firstSceneMatch
        ? "border-sky-200 bg-sky-50"
        : "border-zinc-200 bg-white"
    }`}>
      <div className="flex items-center justify-between gap-3">
        <p className="truncate text-sm font-semibold text-zinc-800">{item.thread.canonicalName}</p>
        <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-500">
          {item.thread.chapters.length} {t.reader.memory.chaptersShort}
        </span>
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        {item.thread.mentionType} / {t.reader.memory.mentions} {item.thread.totalMentions}
      </p>
      {item.firstSceneMatch && (
        <p className="mt-1 text-[11px] font-medium text-sky-700">{t.reader.memory.reappearsHere}</p>
      )}
      {false && item.firstSceneMatch && (
        <p className="mt-1 text-[11px] font-medium text-sky-700">이 장면에서 다시 등장</p>
      )}
    </div>
  )
}

function CrossChapterMemoryPanel({
  bookMemory,
  context,
  activeTab,
  onTabChange,
}: {
  bookMemory?: BookMemorySnapshot
  context: ReaderMemoryContext | null
  activeTab: MemoryTab
  onTabChange: (tab: MemoryTab) => void
}) {
  const { t } = useUiStrings()
  if (!bookMemory) {
    return (
      <>
      <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-4 py-4 text-sm text-zinc-500">
        {t.reader.memory.missing}
      </div>
      </>
    )
  }

  if (!context) return null

  const sceneMap = new Map(bookMemory.sceneRefs.map((scene) => [scene.sceneKey, scene]))
  const bridgeEdges = [...context.incomingEdges, ...context.outgoingEdges]
  const tabs: Array<{ key: MemoryTab; label: string; count: number }> = [
    { key: "bridges", label: t.reader.memory.bridges, count: bridgeEdges.length },
    { key: "threads", label: t.reader.memory.threads, count: context.threads.length },
    { key: "path", label: t.reader.memory.path, count: context.nearbyScenes.length },
  ]

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-gradient-to-br from-stone-50 via-white to-sky-50 shadow-sm">
      <div className="border-b border-zinc-200 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              연구자용 BOOK.0 연결 결과
            </p>
            <h3 className="mt-1 text-base font-semibold text-zinc-900">
              {context.sceneRef?.sceneTitle ?? context.sceneKey}
            </h3>
          </div>
          <span className="rounded-full bg-white px-2.5 py-1 text-[11px] text-zinc-500 shadow-sm">
            BOOK.0
          </span>
        </div>
        {!context.runMatchesBookMemory && context.chapterRunId && (
          <>
          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {t.reader.memory.runMismatch.replace("{runId}", context.chapterRunId)}
          </p>
          {false && context && (
          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            현재 Reader run과 BOOK.0에 사용된 run이 다릅니다. BOOK.0 run: {context?.chapterRunId}
          </p>
          )}
          </>
        )}
        <p className="mt-2 text-xs leading-5 text-zinc-500">
          이 패널은 독자에게 바로 보여줄 문장이 아니라, 현재 scene이 cross-chapter memory의 어떤
          edge/thread/path와 연결되는지 확인하는 디버그 뷰입니다.
        </p>
      </div>

      <div className="flex gap-1 border-b border-zinc-200 bg-white/70 px-3 py-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => onTabChange(tab.key)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === tab.key
                ? "bg-zinc-900 text-white"
                : "text-zinc-500 hover:bg-white hover:text-zinc-800"
            }`}
          >
            {tab.label} {tab.count}
          </button>
        ))}
      </div>

      <div className="max-h-[360px] overflow-y-auto p-4">
        {activeTab === "bridges" && (
          <div className="grid gap-3">
            {context.incomingEdges.map((edge) => (
              <MemoryEdgeCard
                key={edge.edgeId}
                edge={edge}
                direction="incoming"
                sceneMap={sceneMap}
              />
            ))}
            {context.outgoingEdges.map((edge) => (
              <MemoryEdgeCard
                key={edge.edgeId}
                edge={edge}
                direction="outgoing"
                sceneMap={sceneMap}
              />
            ))}
            {bridgeEdges.length === 0 && (
              <>
              <p className="rounded-xl border border-dashed border-zinc-300 bg-white px-4 py-5 text-sm text-zinc-500">
                {t.reader.memory.noBridge}
              </p>
              {false && (
              <p className="rounded-xl border border-dashed border-zinc-300 bg-white px-4 py-5 text-sm text-zinc-500">
                이 scene에 직접 연결된 cross-chapter edge는 아직 없습니다.
              </p>
              )}
              </>
            )}
          </div>
        )}

        {activeTab === "threads" && (
          <div className="grid gap-2 sm:grid-cols-2">
            {context.threads.slice(0, 10).map((item) => (
              <ThreadChip key={item.thread.threadId} item={item} />
            ))}
            {context.threads.length === 0 && (
              <>
              <p className="rounded-xl border border-dashed border-zinc-300 bg-white px-4 py-5 text-sm text-zinc-500 sm:col-span-2">
                {t.reader.memory.noThread}
              </p>
              {false && (
              <p className="rounded-xl border border-dashed border-zinc-300 bg-white px-4 py-5 text-sm text-zinc-500 sm:col-span-2">
                현재 챕터와 연결된 반복 entity thread가 없습니다.
              </p>
              )}
              </>
            )}
          </div>
        )}

        {activeTab === "path" && (
          <div className="grid gap-2">
            {context.nearbyScenes.map((scene) => {
              const active = scene.sceneKey === context.sceneKey
              return (
                <div
                  key={scene.sceneKey}
                  className={`rounded-xl border px-4 py-3 ${
                    active
                      ? "border-zinc-900 bg-zinc-900 text-white"
                      : "border-zinc-200 bg-white text-zinc-700"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-sm font-semibold">{scene.sceneTitle || scene.sceneId}</p>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
                      active ? "bg-white/15 text-white" : "bg-zinc-100 text-zinc-500"
                    }`}>
                      {active ? t.common.current : scene.chapterTitle}
                    </span>
                  </div>
                  <p className={`mt-1 line-clamp-2 text-xs leading-5 ${
                    active ? "text-zinc-200" : "text-zinc-500"
                  }`}>
                    {scene.summary}
                  </p>
                </div>
              )
            })}
            {context.nearbyScenes.length === 0 && (
              <>
              <p className="rounded-xl border border-dashed border-zinc-300 bg-white px-4 py-5 text-sm text-zinc-500">
                {t.reader.memory.noPath}
              </p>
              {false && (
              <p className="rounded-xl border border-dashed border-zinc-300 bg-white px-4 py-5 text-sm text-zinc-500">
                현재 scene을 BOOK.0 scene path에서 찾지 못했습니다.
              </p>
              )}
              </>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function getReaderProblemLabel(problem?: string): string {
  switch (problem) {
    case "boundary_update":
      return "달라진 점"
    case "state_recovery":
      return "현재 상황"
    case "causal_gap":
      return "왜 이어지나요?"
    case "reference_ambiguity":
      return "지시어 단서"
    case "character_reentry":
      return "인물 기억"
    case "relation_delta":
      return "관계 변화"
    case "spatial_disorientation":
      return "장소 단서"
    case "session_reentry":
      return "다시 읽기"
    default:
      return "읽기 단서"
  }
}

function getReaderSupportTitle(unit: SupportUnit, technical: boolean): string {
  if (technical) return unit.title
  if (unit.kind === "causal_bridge") return "이전 사건이 왜 지금 이어지는지"
  if (unit.kind === "reentry_recap") return "다시 읽기 전 확인할 점"
  if (unit.kind === "snapshot") return "지금 장면의 핵심 상태"
  if (unit.kind === "boundary_delta") return "방금 바뀐 흐름"
  if (unit.kind === "reference_repair") return "헷갈릴 수 있는 지시어"
  if (unit.kind === "spatial_continuity") return "장소와 이동 흐름"
  if (unit.kind === "character_focus") return "다시 떠올릴 인물 단서"
  if (unit.kind === "relation_delta") return "관계가 달라진 부분"
  return getReaderProblemLabel(unit.reader_problem)
}

function getReaderSupportBody(unit: SupportUnit, technical: boolean): string {
  if (technical) return unit.body
  if (unit.source_stage_ids.includes("BOOK.0")) {
    if (unit.reader_problem === "causal_gap") {
      return `이전 장면에서 이어진 연결만 짧게 확인하세요. ${unit.body}`
    }
    if (unit.reader_problem === "spatial_disorientation") {
      return `장소나 이동이 이어지는 부분입니다. ${unit.body}`
    }
    if (unit.reader_problem === "character_reentry" || unit.reader_problem === "relation_delta") {
      return `앞에서 나온 인물/관계가 현재 장면과 연결되는 지점입니다. ${unit.body}`
    }
  }
  return unit.body
}

function splitCausalBridgeBody(body: string): { previous: string; current: string } | null {
  const parts = body
    .split(/\s*(?:->|→|=>)\s*/)
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.length < 2) return null

  return {
    previous: parts.slice(0, -1).join(" -> "),
    current: parts[parts.length - 1],
  }
}

function compactSupportText(text: string, maxLength = 110): string {
  const normalized = text.replace(/\s+/g, " ").trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1).trim()}…`
}

function getReaderLeadClueText(unit: SupportUnit): string {
  const bridgeParts = unit.reader_problem === "causal_gap"
    ? splitCausalBridgeBody(unit.body)
    : null

  if (bridgeParts) {
    return `${compactSupportText(bridgeParts.previous, 58)} → ${compactSupportText(bridgeParts.current, 58)}`
  }

  return compactSupportText(unit.body)
}

function ReaderLeadClueStrip({ units }: { units: SupportUnit[] }) {
  return (
    <section className="rounded-3xl border border-amber-200 bg-amber-50/70 p-4 shadow-sm">
      <div className="mb-4 flex flex-col gap-1 border-b border-amber-200 pb-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">
          읽기 전 짧은 단서
        </p>
        <p className="text-sm leading-6 text-zinc-600">
          아래 단서는 본문을 대신하는 요약이 아니라, 현재 장면에 들어가기 전에 확인할 최소 단서입니다.
        </p>
      </div>
      <div className="grid gap-2">
        {units.slice(0, 2).map((unit) => (
          <div
            key={unit.unit_id}
            className="flex flex-col gap-2 rounded-2xl border border-amber-200 bg-white px-4 py-3 sm:flex-row sm:items-start"
          >
            <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-900">
              {getReaderProblemLabel(unit.reader_problem)}
            </span>
            <p className="text-sm leading-6 text-zinc-800">{getReaderLeadClueText(unit)}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

interface InlineSupportPlan {
  groups: Map<number, SupportUnit[]>
  fallbackUnits: SupportUnit[]
  placementByUnitId: Map<string, string>
}

function normalizeSupportMatchText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase()
}

function textMatchesParagraph(candidate: string | undefined, paragraph: string): boolean {
  if (!candidate) return false
  const normalizedCandidate = normalizeSupportMatchText(candidate)
  const normalizedParagraph = normalizeSupportMatchText(paragraph)
  if (normalizedCandidate.length < 18 || normalizedParagraph.length < 18) return false
  if (normalizedParagraph.includes(normalizedCandidate)) return true
  if (normalizedCandidate.includes(normalizedParagraph)) return true
  const compactCandidate = normalizedCandidate.slice(0, Math.min(80, normalizedCandidate.length))
  return compactCandidate.length >= 24 && normalizedParagraph.includes(compactCandidate)
}

function findInlineSupportParagraphIndex(
  unit: SupportUnit,
  paragraphs: string[],
  activeSubsceneId: string,
): number | null {
  const evidenceTexts = unit.evidence
    .filter((ref) => !ref.subscene_id || ref.subscene_id === activeSubsceneId)
    .map((ref) => ref.text)
    .filter(Boolean)

  const bridgeParts = unit.reader_problem === "causal_gap"
    ? splitCausalBridgeBody(unit.body)
    : null
  const candidates = [
    ...evidenceTexts,
    bridgeParts?.current,
  ].filter(Boolean)

  for (const candidate of candidates) {
    const index = paragraphs.findIndex((paragraph) => textMatchesParagraph(candidate, paragraph))
    if (index >= 0) return index
  }

  return null
}

function buildInlineSupportPlan(
  units: SupportUnit[],
  paragraphs: string[],
  activeSubsceneId: string,
): InlineSupportPlan {
  const groups = new Map<number, SupportUnit[]>()
  const fallbackUnits: SupportUnit[] = []
  const placementByUnitId = new Map<string, string>()

  for (const unit of units) {
    const index = findInlineSupportParagraphIndex(unit, paragraphs, activeSubsceneId)
    if (index === null) {
      fallbackUnits.push(unit)
      placementByUnitId.set(unit.unit_id, "헷갈릴 때만 보기")
      continue
    }

    const existing = groups.get(index) ?? []
    groups.set(index, [...existing, unit])
    placementByUnitId.set(unit.unit_id, `본문 ${index + 1}번째 문단`)
  }

  return { groups, fallbackUnits, placementByUnitId }
}

function InlineSupportAnchor({
  units,
  onOpen,
}: {
  units: SupportUnit[]
  onOpen: (units: SupportUnit[]) => void
}) {
  return (
    <details
      className="mt-4 overflow-hidden rounded-2xl border border-sky-200 bg-sky-50/70"
      onToggle={(event) => {
        if (event.currentTarget.open) onOpen(units)
      }}
    >
      <summary className="cursor-pointer list-none px-4 py-3 [&::-webkit-details-marker]:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-semibold text-sky-800">
              문단 도움
            </span>
            <span className="text-sm font-semibold text-zinc-800">
              이 부분에서 헷갈릴 때 보기
            </span>
          </div>
          <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-zinc-500">
            {units.length}
          </span>
        </div>
      </summary>
      <div className="grid gap-3 border-t border-sky-100 bg-white/70 p-4 md:grid-cols-2">
        {units.map((unit) => (
          <SupportUnitCard key={unit.unit_id} unit={unit} compact />
        ))}
      </div>
    </details>
  )
}

function ReaderSupportBody({
  unit,
  compact,
  technical,
}: {
  unit: SupportUnit
  compact: boolean
  technical: boolean
}) {
  const paragraphClass = `${compact ? "mt-1 text-sm leading-6" : "mt-2 text-[15px] leading-7"} text-zinc-600`
  const bridgeParts = !technical && unit.reader_problem === "causal_gap"
    ? splitCausalBridgeBody(unit.body)
    : null

  if (!technical && bridgeParts) {
    return (
      <div className="mt-3 space-y-3">
        <p className="text-sm leading-6 text-zinc-600">
          이전 장면과 현재 장면의 연결만 분리해서 보여줍니다.
        </p>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-stretch">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-900">
              이전 사건
            </p>
            <p className="mt-2 text-sm leading-6 text-zinc-800">{bridgeParts.previous}</p>
          </div>
          <div className="hidden items-center justify-center text-xs font-semibold text-zinc-400 md:flex">
            이어짐
          </div>
          <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-900">
              현재 장면
            </p>
            <p className="mt-2 text-sm leading-6 text-zinc-800">{bridgeParts.current}</p>
          </div>
        </div>
      </div>
    )
  }

  const body = !technical && unit.reader_problem === "causal_gap"
    ? unit.body
    : getReaderSupportBody(unit, technical)

  return <p className={paragraphClass}>{body}</p>
}

function uniqueSupportUnits(units: SupportUnit[]): SupportUnit[] {
  const seen = new Set<string>()
  const unique: SupportUnit[] = []
  for (const unit of units) {
    const key = unit.unit_id || `${unit.kind}:${unit.title}:${unit.body}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(unit)
  }
  return unique
}

function SupportUnitCard({
  unit,
  compact = false,
  technical = false,
}: {
  unit: SupportUnit
  compact?: boolean
  technical?: boolean
}) {
  const { t } = useUiStrings()
  const evidencePreview = unit.evidence.find((ref) => ref.text?.trim())?.text
  const scoreParts = [
    typeof unit.usefulness_score === "number" ? `use ${unit.usefulness_score.toFixed(2)}` : "",
    typeof unit.grounding_score === "number" ? `ground ${unit.grounding_score.toFixed(2)}` : "",
    typeof unit.intrusion_cost === "number" ? `intrude ${unit.intrusion_cost.toFixed(2)}` : "",
    typeof unit.confidence === "number" ? `conf ${unit.confidence.toFixed(2)}` : "",
  ].filter(Boolean)
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
          technical ? "bg-zinc-100 text-zinc-600" : "bg-amber-100 text-amber-900"
        }`}>
          {technical
            ? (t.reader.supportKind[unit.kind as keyof typeof t.reader.supportKind] ?? unit.label)
            : getReaderProblemLabel(unit.reader_problem)}
        </span>
        {technical && (
          <span className="text-[11px] text-zinc-400">
            {Math.round(unit.priority * 100)}
          </span>
        )}
      </div>
      <h4 className={`mt-3 font-semibold text-zinc-900 ${compact ? "text-sm" : "text-base"}`}>
        {getReaderSupportTitle(unit, technical)}
      </h4>
      <ReaderSupportBody unit={unit} compact={compact} technical={technical} />
      {technical ? (
      <details className="mt-3 rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2">
        <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          provenance / scores
        </summary>
        <div className="mt-2 space-y-2 text-xs leading-5 text-zinc-500">
          <p>problem: {unit.reader_problem ?? "-"} · display: {unit.default_display ?? "-"} · spoiler: {unit.spoiler_risk ?? "none"}</p>
          {scoreParts.length > 0 && <p>{scoreParts.join(" · ")}</p>}
          {unit.source_stage_ids.length > 0 && <p>source: {unit.source_stage_ids.join(", ")}</p>}
          {unit.claims && unit.claims.length > 0 && (
            <p>claims: {unit.claims.map((claim) => `${claim.claim_type}:${claim.support_level}`).join(", ")}</p>
          )}
          <p>{t.common.evidence}: {unit.evidence.length}</p>
          {evidencePreview && <p className="rounded-md bg-white px-2 py-1 text-zinc-600">{evidencePreview}</p>}
          {unit.score_notes && unit.score_notes.length > 0 && (
            <p>notes: {unit.score_notes.slice(0, 4).join(" · ")}</p>
          )}
        </div>
      </details>
      ) : evidencePreview ? (
        <details className="mt-3 rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-2">
          <summary className="cursor-pointer text-[11px] font-semibold text-amber-800">
            근거 문장 보기
          </summary>
          <p className="mt-2 text-xs leading-5 text-zinc-600">{evidencePreview}</p>
        </details>
      ) : null}
    </div>
  )
}

type ReaderFocusContext =
  | {
      mode: "global"
      title: string
      subtitle: string
      summary: string
      hints: CompactHint[]
      buttons: SceneReaderPacket["subscene_views"][string]["buttons"]
      panels: Record<string, string>
    }
  | {
      mode: "character"
      title: string
      subtitle: string
      summary: string
      hints: CompactHint[]
      buttons: ReaderCharacterView["buttons"]
      panels: Record<string, string>
    }
  | {
      mode: "pair"
      title: string
      subtitle: string
      summary: string
      hints: CompactHint[]
      buttons: ReaderPairView["buttons"]
      panels: Record<string, string>
    }

function resolveFocusContext(params: {
  packet: SceneReaderPacket
  activeSubsceneId: string
  selectedCharacterIds: string[]
  t: UiStrings
}): ReaderFocusContext {
  const view = params.packet.subscene_views[params.activeSubsceneId]
  const headline = view?.headline || params.t.reader.fallback.readerSupport

  if (!view) {
    return {
      mode: "global",
      title: headline,
      subtitle: params.t.reader.subscene,
      summary: params.t.reader.fallback.noSubscene,
      hints: [],
      buttons: [],
      panels: {},
    }
  }

  if (params.selectedCharacterIds.length >= 2) {
    const pairKey = pairKeyFromIds(params.selectedCharacterIds.slice(0, 2))
    const pairView = view.pair_views[pairKey]
    if (pairView) {
      return {
        mode: "pair",
        title: pairView.labels.join(" + "),
        subtitle: pairView.relation_label,
        summary: pairView.micro_summary,
        hints: pairView.hints,
        buttons: pairView.buttons,
        panels: pairView.panels,
      }
    }

    const labels = params.selectedCharacterIds
      .map((characterId) => view.character_views[characterId]?.label)
      .filter((label): label is string => Boolean(label))

    return {
      mode: "pair",
      title: labels.join(" + ") || params.t.reader.fallback.selectedPair,
      subtitle: params.t.reader.fallback.relationView,
      summary: params.t.reader.fallback.noPairHint,
      hints: [],
      buttons: [],
      panels: {},
    }
  }

  if (params.selectedCharacterIds.length === 1) {
    const characterView = view.character_views[params.selectedCharacterIds[0]]
    if (characterView) {
      return {
        mode: "character",
        title: characterView.label,
        subtitle: characterView.role,
        summary: characterView.micro_summary,
        hints: characterView.hints,
        buttons: characterView.buttons,
        panels: characterView.panels,
      }
    }
  }

  const globalView: ReaderGlobalView = view.global_view ?? {
    summary_hint: view.headline || params.t.reader.fallback.subsceneOverview,
    hints: [],
    buttons: view.buttons ?? [],
    panels: view.panels ?? {},
  }
  return {
    mode: "global",
    title: headline,
    subtitle: params.t.reader.fallback.subsceneOverview,
    summary: globalView.summary_hint,
    hints: globalView.hints,
    buttons: globalView.buttons,
    panels: globalView.panels,
  }
}

function ResearcherMetricCard({
  label,
  value,
  note,
}: {
  label: string
  value: string | number
  note?: string
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-zinc-900">{value}</p>
      {note && <p className="mt-1 text-xs leading-5 text-zinc-500">{note}</p>}
    </div>
  )
}

type SupportDecisionRow = {
  unit: SupportUnit
  proposalSlot: string
  readerStatus: "on" | "off"
  readerPlacement: string
  reason: string
}

function unitIdSet(units: SupportUnit[]): Set<string> {
  return new Set(units.map((unit) => unit.unit_id))
}

function getProposalSlot(unit: SupportUnit, support: SceneReaderPacket["support"]): string {
  const plan = support?.display_plan
  if (plan?.default_visible.some((item) => item.unit_id === unit.unit_id)) return "SUP.7 default_visible"
  if (plan?.expandable.some((item) => item.unit_id === unit.unit_id)) return "SUP.7 expandable"
  if (plan?.trigger_only.some((item) => item.unit_id === unit.unit_id)) return "SUP.7 trigger_only"
  if (plan?.suppressed.some((item) => item.unit_id === unit.unit_id)) return "SUP.7 suppressed"
  if (support?.display_slots.before_text.some((item) => item.unit_id === unit.unit_id)) return "legacy before_text"
  if (support?.display_slots.on_demand.some((item) => item.unit_id === unit.unit_id)) return "legacy on_demand"
  if (support?.display_slots.beside_visual.some((item) => item.unit_id === unit.unit_id)) return "legacy beside_visual"
  return "candidate"
}

function buildSupportDecisionRows(params: {
  packet: SceneReaderPacket
  supportBeforeText: SupportUnit[]
  readerExpandableSupport: SupportUnit[]
  inlinePlacementByUnitId: Map<string, string>
  governedSupport: ReturnType<typeof governReaderSupport>
}): SupportDecisionRow[] {
  const support = params.packet.support
  if (!support) return []

  const candidateUnits = uniqueSupportUnits(
    support.display_plan?.candidate_units ?? [
      ...support.display_slots.before_text,
      ...support.display_slots.on_demand,
      ...support.display_slots.beside_visual,
    ],
  )
  const beforeIds = unitIdSet(params.supportBeforeText)
  const expandableIds = unitIdSet(params.readerExpandableSupport)
  const triggerIds = unitIdSet(support.display_plan?.trigger_only ?? [])
  const suppressed = new Map(
    (support.display_plan?.suppressed ?? []).map((item) => [item.unit_id, item]),
  )

  return candidateUnits.map((unit) => {
    if (beforeIds.has(unit.unit_id)) {
      return {
        unit,
        proposalSlot: getProposalSlot(unit, support),
        readerStatus: "on",
        readerPlacement: "읽기 전 짧은 단서",
        reason: "Support Governor가 본문 위 lead clue로 선택했습니다.",
      }
    }
    if (expandableIds.has(unit.unit_id)) {
      return {
        unit,
        proposalSlot: getProposalSlot(unit, support),
        readerStatus: "on",
        readerPlacement: params.inlinePlacementByUnitId.get(unit.unit_id) ?? "헷갈릴 때만 보기",
        reason: params.inlinePlacementByUnitId.has(unit.unit_id)
          ? "본문 문단과 evidence가 매칭되어 문단 근처의 inline chip으로 표시됩니다."
          : "문단 anchor를 찾지 못해 아래쪽 fallback 도움으로 묶입니다.",
      }
    }

    const suppressedItem = suppressed.get(unit.unit_id)
    if (suppressedItem) {
      return {
        unit,
        proposalSlot: getProposalSlot(unit, support),
        readerStatus: "off",
        readerPlacement: "숨김",
        reason: `SUP.6/SUP.7에서 ${suppressedItem.reason} 이유로 제외했습니다.${suppressedItem.note ? ` ${suppressedItem.note}` : ""}`,
      }
    }

    if (triggerIds.has(unit.unit_id)) {
      return {
        unit,
        proposalSlot: getProposalSlot(unit, support),
        readerStatus: "off",
        readerPlacement: "조건 대기",
        reason: "session re-entry, visual usefulness, reader request 같은 trigger가 아직 켜지지 않았습니다.",
      }
    }

    return {
      unit,
      proposalSlot: getProposalSlot(unit, support),
      readerStatus: "off",
      readerPlacement: "숨김",
      reason: params.governedSupport.diagnostics.includes("support_fatigue_high")
        ? "support fatigue가 높아 기본 노출을 줄였습니다."
        : "중복, 낮은 우선순위, 또는 현재 독자 화면 slot 제한 때문에 노출하지 않았습니다.",
    }
  })
}

function SupportDecisionSwitch({ status }: { status: "on" | "off" }) {
  return (
    <div className="inline-grid w-[112px] grid-cols-2 rounded-full border border-zinc-200 bg-zinc-100 p-0.5 text-[11px] font-semibold">
      <span className={`rounded-full px-2 py-1 text-center ${
        status === "off" ? "bg-zinc-700 text-white shadow-sm" : "text-zinc-400"
      }`}>
        OFF
      </span>
      <span className={`rounded-full px-2 py-1 text-center ${
        status === "on" ? "bg-emerald-500 text-white shadow-sm" : "text-zinc-400"
      }`}>
        ON
      </span>
    </div>
  )
}

function ResearcherSupportDecisionBoard({
  rows,
}: {
  rows: SupportDecisionRow[]
}) {
  const onCount = rows.filter((row) => row.readerStatus === "on").length
  const offCount = rows.length - onCount

  return (
    <section className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            독자 화면 ON/OFF 결정표
          </p>
          <h4 className="mt-1 text-base font-semibold text-zinc-950">
            제안된 전체 도움 중 실제 독자 화면에 켜지는 것
          </h4>
          <p className="mt-1 text-sm leading-6 text-zinc-500">
            SUP.7이 제안한 후보를 Support Governor가 독자 화면 기준으로 다시 선별한 결과입니다.
          </p>
        </div>
        <div className="flex gap-2 text-xs font-semibold">
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">ON {onCount}</span>
          <span className="rounded-full bg-zinc-100 px-3 py-1 text-zinc-600">OFF {offCount}</span>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200">
        <div className="grid grid-cols-[128px_minmax(180px,1.1fr)_minmax(150px,0.8fr)_minmax(170px,0.8fr)_minmax(220px,1.3fr)] gap-0 bg-zinc-100 px-3 py-2 text-xs font-semibold text-zinc-500">
          <span>상태</span>
          <span>도움 후보</span>
          <span>제안 위치</span>
          <span>독자 화면 위치</span>
          <span>이유</span>
        </div>
        <div className="max-h-[420px] divide-y divide-zinc-200 overflow-auto bg-white">
          {rows.length === 0 ? (
            <div className="px-3 py-6 text-sm text-zinc-500">현재 scene에 support 후보가 없습니다.</div>
          ) : (
            rows.map((row) => (
              <div
                key={row.unit.unit_id}
                className="grid grid-cols-[128px_minmax(180px,1.1fr)_minmax(150px,0.8fr)_minmax(170px,0.8fr)_minmax(220px,1.3fr)] gap-0 px-3 py-3 text-sm"
              >
                <SupportDecisionSwitch status={row.readerStatus} />
                <div>
                  <p className="font-semibold text-zinc-900">{getReaderSupportTitle(row.unit, false)}</p>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500">{row.unit.body}</p>
                </div>
                <span className="text-xs leading-5 text-zinc-500">{row.proposalSlot}</span>
                <span className="text-xs font-semibold leading-5 text-zinc-700">{row.readerPlacement}</span>
                <span className="text-xs leading-5 text-zinc-500">{row.reason}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  )
}

function ResearcherArtifactPanel({
  final1,
  packet,
  activeSubsceneId,
  readerRunId,
  supportBeforeText,
  supportOnDemand,
  supportBesideVisual,
  readerExpandableSupport,
  inlinePlacementByUnitId,
  readerMemoryContext,
  governedSupport,
  visualPolicy,
}: {
  final1: SceneReaderPackageLog
  packet: SceneReaderPacket
  activeSubsceneId: string
  readerRunId: string
  supportBeforeText: SupportUnit[]
  supportOnDemand: SupportUnit[]
  supportBesideVisual: SupportUnit[]
  readerExpandableSupport: SupportUnit[]
  inlinePlacementByUnitId: Map<string, string>
  readerMemoryContext: ReaderMemoryContext | null
  governedSupport: ReturnType<typeof governReaderSupport>
  visualPolicy: ReturnType<typeof scoreVisualSupport>
}) {
  const candidateCount = packet.support?.display_plan?.candidate_units?.length
    ?? [
      ...(packet.support?.display_slots.before_text ?? []),
      ...(packet.support?.display_slots.beside_visual ?? []),
      ...(packet.support?.display_slots.on_demand ?? []),
    ].length
  const bookBridgeCount = (readerMemoryContext?.incomingEdges.length ?? 0)
    + (readerMemoryContext?.outgoingEdges.length ?? 0)
  const visibleCount = supportBeforeText.length + readerExpandableSupport.length
  const decisionRows = buildSupportDecisionRows({
    packet,
    supportBeforeText,
    readerExpandableSupport,
    inlinePlacementByUnitId,
    governedSupport,
  })
  const subsceneView = packet.subscene_views[activeSubsceneId]
  const rawArtifacts = [
    {
      label: "FINAL.1 current packet",
      value: {
        doc_id: final1.doc_id,
        chapter_id: final1.chapter_id,
        run_id: final1.run_id,
        reader_run_id: readerRunId,
        scene_id: packet.scene_id,
        active_subscene_id: activeSubsceneId,
        packet,
      },
    },
    {
      label: "SUP.7 support plan",
      value: packet.support ?? null,
    },
    {
      label: "BOOK.0 reader memory context",
      value: readerMemoryContext,
    },
    {
      label: "Runtime governor and visual policy",
      value: {
        governedSupport,
        visualPolicy,
      },
    },
    {
      label: "Active subscene view",
      value: subsceneView ?? null,
    },
  ]

  return (
    <section className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            연구자 화면 해석 패널
          </p>
          <h3 className="mt-1 text-lg font-semibold text-zinc-900">
            현재 Reader가 어떤 산출물을 사용하고 있는지 요약
          </h3>
          <p className="mt-1 max-w-4xl text-sm leading-6 text-zinc-500">
            독자 화면에는 보이지 않는 SUP.7, BOOK.0, Support Governor, Visual Policy 결과를 한 곳에서
            확인합니다. 아래 수치는 실제 화면 노출과 raw artifact 사이의 차이를 점검하기 위한 것입니다.
          </p>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-zinc-500 shadow-sm">
          {final1.chapter_id} / {packet.scene_id}
        </span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <ResearcherMetricCard
          label="candidate units"
          value={candidateCount}
          note="SUP.7 display plan 또는 display slots에 남아 있는 전체 후보"
        />
        <ResearcherMetricCard
          label="visible after governor"
          value={visibleCount}
          note={`reader lead ${supportBeforeText.length} / reader more ${readerExpandableSupport.length}`}
        />
        <ResearcherMetricCard
          label="hidden or suppressed"
          value={governedSupport.hiddenTriggerCount + governedSupport.suppressedCount}
          note={`trigger ${governedSupport.hiddenTriggerCount} / suppressed ${governedSupport.suppressedCount}`}
        />
        <ResearcherMetricCard
          label="BOOK.0 links"
          value={bookBridgeCount}
          note={`threads ${readerMemoryContext?.threads.length ?? 0} / nearby path ${readerMemoryContext?.nearbyScenes.length ?? 0}`}
        />
      </div>

      <ResearcherSupportDecisionBoard rows={decisionRows} />

      <div className="mt-4 grid gap-3 xl:grid-cols-3">
        <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">화면 표시 결정</p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold text-zinc-600">
            <span className="rounded-full bg-zinc-100 px-2.5 py-1">visual score {visualPolicy.usefulnessScore.toFixed(2)}</span>
            <span className="rounded-full bg-zinc-100 px-2.5 py-1">
              visual {visualPolicy.showImageByDefault || visualPolicy.showBlueprintByDefault ? "default" : "collapsed"}
            </span>
            {governedSupport.diagnostics.map((item) => (
              <span key={item} className="rounded-full bg-zinc-100 px-2.5 py-1">{item}</span>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 xl:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">독자 화면에 남는 도움말</p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-600">
            {[...supportBeforeText, ...supportOnDemand, ...supportBesideVisual].length === 0 ? (
              <span className="rounded-full bg-zinc-100 px-2.5 py-1">현재 scene에서 노출되는 support 없음</span>
            ) : (
              [...supportBeforeText, ...supportOnDemand, ...supportBesideVisual].map((unit) => (
                <span key={unit.unit_id} className="rounded-full bg-zinc-100 px-2.5 py-1">
                  {getReaderProblemLabel(unit.reader_problem)} · {unit.default_display}
                </span>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        {rawArtifacts.map((artifact) => (
          <details key={artifact.label} className="rounded-xl border border-zinc-200 bg-white">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-zinc-700">
              Raw artifact: {artifact.label}
            </summary>
            <pre className="max-h-96 overflow-auto border-t border-zinc-200 bg-zinc-950 p-4 text-xs leading-5 text-zinc-100">
              {JSON.stringify(artifact.value, null, 2)}
            </pre>
          </details>
        ))}
      </div>
    </section>
  )
}

function ReaderModeNotice({
  hasLeadClues,
  hasExpandableSupport,
}: {
  hasLeadClues: boolean
  hasExpandableSupport: boolean
}) {
  const leadLabel = hasLeadClues ? "1. 짧은 단서 먼저 보기" : "1. 본문 먼저 읽기"
  const leadDescription = hasLeadClues
    ? "아래 노란 영역은 읽기 보조 단서이고, 실제 소설 본문은 별도의 흰색 본문 박스에서 시작됩니다."
    : "이 장면은 먼저 띄울 만큼 확실한 짧은 단서가 없어서, 실제 소설 본문을 먼저 보여줍니다."
  return (
    <section className="rounded-3xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-stone-50 p-5 shadow-sm">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <span className="rounded-full bg-amber-200 px-3 py-1 text-xs font-semibold text-amber-950">
            독자 화면
          </span>
          <h3 className="mt-3 text-lg font-semibold text-zinc-950">
            본문과 도움말을 분리해서 보여줍니다
          </h3>
          <p className="mt-2 max-w-none break-keep text-sm leading-6 text-zinc-600">
            {leadDescription}
            {hasExpandableSupport ? " 추가 설명은 본문을 읽은 뒤 필요할 때만 펼쳐볼 수 있습니다." : ""}
          </p>
        </div>
        <div className="grid gap-2 text-xs font-semibold text-zinc-600 sm:grid-cols-3 xl:min-w-[620px] xl:shrink-0">
          <span className="rounded-2xl border border-amber-200 bg-white px-3 py-2">{leadLabel}</span>
          <span className="rounded-2xl border border-zinc-200 bg-white px-3 py-2">2. 흰색 박스가 실제 본문</span>
          <span className="rounded-2xl border border-sky-200 bg-white px-3 py-2">
            3. {hasExpandableSupport ? "추가 도움은 접어서 보관" : "추가 도움 없음"}
          </span>
        </div>
      </div>
    </section>
  )
}

interface Props {
  mode?: ReaderScreenMode
  final1: SceneReaderPackageLog
  final2?: OverlayRefinementResult
  bookMemory?: BookMemorySnapshot
  readerRunId: string
  topControls?: ReactNode
}

export default function ReaderScreen({
  mode = "reader",
  final1,
  final2,
  bookMemory,
  readerRunId,
  topControls,
}: Props) {
  const { t } = useUiStrings()
  const isResearcherMode = mode === "researcher"
  const [sceneIdx, setSceneIdx] = useState(0)
  const [subsceneIdx, setSubsceneIdx] = useState(0)
  const [activePanel, setActivePanel] = useState<string | null>(null)
  const [activeMemoryTab, setActiveMemoryTab] = useState<MemoryTab>("bridges")
  const [showSceneSummary, setShowSceneSummary] = useState(false)
  const [resumeGapMs] = useState(() => readResumeGapMs(final1.doc_id))
  const [readerSessionId] = useState(() => createReaderSessionId(final1.doc_id))
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>([])
  const [longPauseActive, setLongPauseActive] = useState(false)
  const [backscrollActive, setBackscrollActive] = useState(false)
  const [supportOpenCount, setSupportOpenCount] = useState(0)
  const imageFrameRef = useRef<HTMLDivElement | null>(null)
  const preloadedImageUrlsRef = useRef<Set<string>>(new Set())
  const loggedSupportEventsRef = useRef<Set<string>>(new Set())
  const [imageMetrics, setImageMetrics] = useState({
    imageKey: "",
    naturalWidth: 0,
    naturalHeight: 0,
    containerWidth: 0,
    containerHeight: 0,
  })

  const packet = final1.packets[sceneIdx]

  const refinementScene = final2?.scenes.find((scene) => scene.scene_id === packet.scene_id)
  const subscene = packet?.subscene_nav[subsceneIdx]
  const activeSubsceneId = subscene?.subscene_id ?? packet?.default_active_subscene_id ?? ""
  const bodyParagraphs = subscene?.body_paragraphs ?? packet.body_paragraphs
  const subsceneView = packet?.subscene_views[activeSubsceneId]
  const mergedOverlay = packet ? buildMergedOverlay(packet, activeSubsceneId, refinementScene) : []
  const availableCharacterIds = new Set(mergedOverlay.map(({ coarse }) => coarse.character_id))
  const resolvedSelectedCharacterIds = selectedCharacterIds.filter((id) => availableCharacterIds.has(id)).slice(0, 2)
  const focusContext = resolveFocusContext({
    packet,
    activeSubsceneId,
    selectedCharacterIds: resolvedSelectedCharacterIds,
    t,
  })
  const visualSupportUnits = packet.support?.display_plan?.candidate_units ?? [
    ...(packet.support?.display_slots.before_text ?? []),
    ...(packet.support?.display_slots.beside_visual ?? []),
    ...(packet.support?.display_slots.on_demand ?? []),
  ]
  const visualPolicy = scoreVisualSupport(packet, visualSupportUnits)
  const governedSupport = governReaderSupport(packet.support, {
    resumeGapMs,
    reentryGapMs: READER_REENTRY_GAP_MS,
    visualUseful: visualPolicy.usefulnessScore >= 0.48 || visualPolicy.showBlueprintByDefault,
    sceneBoundaryActive: subsceneIdx === 0,
    longPauseActive,
    backscrollActive,
    supportFatigueScore: Math.min(1, supportOpenCount / 8),
  })
  const supportBeforeText = governedSupport.beforeText
  const supportBesideVisual = governedSupport.besideVisual
  const supportOnDemand = governedSupport.onDemand
  const readerExpandableSupport = uniqueSupportUnits([...supportOnDemand, ...supportBesideVisual])
  const inlineSupportPlan = buildInlineSupportPlan(readerExpandableSupport, bodyParagraphs, activeSubsceneId)
  const renderedExpandableSupport = isResearcherMode ? supportOnDemand : inlineSupportPlan.fallbackUnits
  const readerMemoryContext = packet
    ? buildReaderMemoryContext(bookMemory, final1, packet, readerRunId)
    : null

  function logSupportUnits(
    action: ReaderSupportEvent["action"],
    units: SupportUnit[],
    reason?: string,
  ) {
    if (isResearcherMode) return
    if (!packet || units.length === 0) return
    if (action === "opened") {
      setSupportOpenCount((value) => Math.min(20, value + units.length))
    }
    const sceneKey = `${final1.chapter_id}:${packet.scene_id}`
    for (const unit of units) {
      const logKey = `${action}:${sceneKey}:${unit.unit_id}:${reason ?? ""}`
      if (loggedSupportEventsRef.current.has(logKey)) continue
      loggedSupportEventsRef.current.add(logKey)
      postReaderSupportEvent({
        docId: final1.doc_id,
        chapterId: final1.chapter_id,
        sceneId: packet.scene_id,
        readerRunId,
        sessionId: readerSessionId,
        unit,
        action,
        reason,
      })
    }
  }

  const activeImageKey = packet?.visual.image_path ? `${packet.scene_id}:${packet.visual.image_path}` : ""
  const metricsForActiveImage =
    imageMetrics.imageKey === activeImageKey
      ? imageMetrics
      : {
          ...imageMetrics,
          naturalWidth: 0,
          naturalHeight: 0,
        }
  const imageAspectRatio =
    metricsForActiveImage.naturalWidth > 0 && metricsForActiveImage.naturalHeight > 0
      ? metricsForActiveImage.naturalWidth / metricsForActiveImage.naturalHeight
      : 4 / 3
  const containedRect = getContainedImageRect(metricsForActiveImage)

  const hasPrev = sceneIdx > 0 || subsceneIdx > 0
  const hasNext =
    sceneIdx < final1.packets.length - 1 || subsceneIdx < (packet?.subscene_nav.length ?? 0) - 1

  function resetFocusState() {
    setActivePanel(null)
    setSelectedCharacterIds([])
  }

  function selectScene(nextSceneIdx: number, nextSubsceneIdx = 0) {
    setSceneIdx(nextSceneIdx)
    setSubsceneIdx(nextSubsceneIdx)
    setLongPauseActive(false)
    setBackscrollActive(false)
    resetFocusState()
  }

  function selectSubscene(nextSubsceneIdx: number) {
    setSubsceneIdx(nextSubsceneIdx)
    setLongPauseActive(false)
    setBackscrollActive(false)
    resetFocusState()
  }

  function goPrev() {
    if (subsceneIdx > 0) {
      selectSubscene(subsceneIdx - 1)
      return
    }

    if (sceneIdx > 0) {
      const prevSceneIdx = sceneIdx - 1
      const prevPacket = final1.packets[prevSceneIdx]
      selectScene(prevSceneIdx, Math.max(0, prevPacket.subscene_nav.length - 1))
    }
  }

  function goNext() {
    if (subsceneIdx < (packet?.subscene_nav.length ?? 0) - 1) {
      selectSubscene(subsceneIdx + 1)
      return
    }

    if (sceneIdx < final1.packets.length - 1) {
      selectScene(sceneIdx + 1, 0)
    }
  }

  function toggleCharacterSelection(characterId: string) {
    setActivePanel(null)
    setSelectedCharacterIds((prev) => {
      if (prev.includes(characterId)) {
        return prev.filter((id) => id !== characterId)
      }
      if (prev.length >= 2) {
        return [prev[1], characterId]
      }
      return [...prev, characterId]
    })
  }

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
  }, [packet?.scene_id])

  useEffect(() => {
    if (typeof window === "undefined") return

    const sceneIndexesToPreload = [
      sceneIdx,
      sceneIdx + 1,
      sceneIdx + 2,
      sceneIdx - 1,
    ]

    for (const index of sceneIndexesToPreload) {
      const imagePath = final1.packets[index]?.visual.image_path
      if (!imagePath || preloadedImageUrlsRef.current.has(imagePath)) continue

      preloadedImageUrlsRef.current.add(imagePath)
      const image = new window.Image()
      image.decoding = "async"
      image.src = imagePath
    }
  }, [final1.packets, sceneIdx])

  useEffect(() => {
    const storageKey = `story-reader:last-active:${final1.doc_id}`
    window.localStorage.setItem(storageKey, String(Date.now()))

    function markActive() {
      window.localStorage.setItem(storageKey, String(Date.now()))
    }

    window.addEventListener("beforeunload", markActive)
    return () => {
      markActive()
      window.removeEventListener("beforeunload", markActive)
    }
  }, [final1.doc_id])

  useEffect(() => {
    window.localStorage.setItem(`story-reader:last-active:${final1.doc_id}`, String(Date.now()))
  }, [final1.doc_id, sceneIdx, subsceneIdx])

  useEffect(() => {
    const timer = window.setTimeout(() => setLongPauseActive(true), 45_000)
    return () => window.clearTimeout(timer)
  }, [sceneIdx, subsceneIdx])

  useEffect(() => {
    if (isResearcherMode) return
    if (!packet || supportBeforeText.length === 0) return
    const sceneKey = `${final1.chapter_id}:${packet.scene_id}`
    for (const unit of supportBeforeText) {
      const logKey = `shown:${sceneKey}:${unit.unit_id}:default_visible`
      if (loggedSupportEventsRef.current.has(logKey)) continue
      loggedSupportEventsRef.current.add(logKey)
      postReaderSupportEvent({
        docId: final1.doc_id,
        chapterId: final1.chapter_id,
        sceneId: packet.scene_id,
        readerRunId,
        sessionId: readerSessionId,
        unit,
        action: "shown",
        reason: "default_visible",
      })
    }
  }, [final1.chapter_id, final1.doc_id, isResearcherMode, packet, readerRunId, readerSessionId, supportBeforeText])

  if (!packet) return <div className="p-8 text-zinc-400">{t.reader.noScenes}</div>

  const visualAvailable = Boolean(packet.visual.image_path || packet.visual.fallback_blueprint_available)
  const showVisualByDefault = visualPolicy.showImageByDefault || visualPolicy.showBlueprintByDefault

  function renderVisualFrame() {
    return (
      <div
        className={`relative w-full overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100 shadow-sm ${
          packet.visual.image_path ? "" : "min-h-[420px]"
        }`}
        style={packet.visual.image_path ? { aspectRatio: imageAspectRatio } : undefined}
      >
        {packet.visual.image_path ? (
          <div ref={imageFrameRef} className="relative h-full w-full p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={`${packet.scene_id}:${packet.visual.image_path}`}
              src={packet.visual.image_path}
              alt="scene"
              loading="eager"
              fetchPriority="high"
              decoding="async"
              className="h-full w-full object-contain"
              onLoad={(event) => {
                const target = event.currentTarget
                setImageMetrics((prev) => ({
                  ...prev,
                  imageKey: activeImageKey,
                  naturalWidth: target.naturalWidth,
                  naturalHeight: target.naturalHeight,
                  containerWidth: imageFrameRef.current?.clientWidth ?? prev.containerWidth,
                  containerHeight: imageFrameRef.current?.clientHeight ?? prev.containerHeight,
                }))
              }}
            />

            {mergedOverlay.map(({ coarse, refined }) => {
              const anchorX = refined?.anchor_x ?? coarse.anchor_x
              const anchorY = refined?.anchor_y ?? coarse.anchor_y
              const left =
                containedRect.left +
                (Math.max(0, Math.min(100, anchorX)) / 100) * containedRect.width
              const top =
                containedRect.top +
                (Math.max(0, Math.min(100, anchorY)) / 100) * containedRect.height

              return (
                <CharacterButton
                  key={coarse.character_id}
                  coarse={coarse}
                  left={left}
                  top={top}
                  selected={resolvedSelectedCharacterIds.includes(coarse.character_id)}
                  onToggle={() => toggleCharacterSelection(coarse.character_id)}
                />
              )
            })}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-zinc-400">
            {packet.visual.fallback_blueprint_available ? t.reader.blueprintAvailable : t.reader.noImage}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className="mx-auto flex w-full max-w-[2080px] flex-col gap-5 p-6"
      onWheel={(event) => {
        if (event.deltaY < -24) setBackscrollActive(true)
      }}
    >
      <div className="flex flex-wrap items-center gap-3">
        {topControls}
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-zinc-600">{t.reader.scene}</label>
          <select
            value={sceneIdx}
            onChange={(event) => selectScene(Number(event.target.value), 0)}
            className="min-w-[220px] rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm"
          >
            {final1.packets.map((scenePacket, index) => (
              <option key={scenePacket.scene_id} value={index}>
                {scenePacket.scene_title || scenePacket.scene_id}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-zinc-900">
            {packet.scene_title || packet.scene_id}
          </h2>
          {isResearcherMode && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowSceneSummary((value) => !value)}
              className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50"
            >
              {showSceneSummary ? t.reader.hideSummary : t.reader.showSummary}
            </button>
          </div>
          )}
          {isResearcherMode && showSceneSummary && (
            <div className="mt-3 max-w-3xl rounded-xl border border-zinc-200 bg-white px-4 py-3 text-[15px] leading-7 text-zinc-600 shadow-sm">
              <p>{packet.scene_summary}</p>
              {subscene?.headline && (
                <div className="mt-3 border-t border-zinc-200 pt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    {t.reader.subscene}
                  </p>
                  <p className="mt-1 text-zinc-700">{subscene.headline}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {isResearcherMode && (
        <ResearcherArtifactPanel
          final1={final1}
          packet={packet}
          activeSubsceneId={activeSubsceneId}
          readerRunId={readerRunId}
          supportBeforeText={supportBeforeText}
          supportOnDemand={supportOnDemand}
          supportBesideVisual={supportBesideVisual}
          readerExpandableSupport={readerExpandableSupport}
          inlinePlacementByUnitId={inlineSupportPlan.placementByUnitId}
          readerMemoryContext={readerMemoryContext}
          governedSupport={governedSupport}
          visualPolicy={visualPolicy}
        />
      )}

      {!isResearcherMode && (supportBeforeText.length > 0 || readerExpandableSupport.length > 0) && (
        <ReaderModeNotice
          hasLeadClues={supportBeforeText.length > 0}
          hasExpandableSupport={readerExpandableSupport.length > 0}
        />
      )}

      <div className="grid gap-7 xl:grid-cols-[minmax(0,1fr)_minmax(360px,560px)] 2xl:grid-cols-[minmax(0,1fr)_minmax(420px,640px)]">
        <div className="flex min-w-0 flex-col gap-5">
          {packet.subscene_nav.length > 0 && (
            <div className="flex flex-col gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                {subsceneIdx + 1} / {packet.subscene_nav.length} - {subscene?.label}
              </p>
              <div className="mt-1 flex gap-1.5">
                {packet.subscene_nav.map((_, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => selectSubscene(index)}
                    className={`h-2 w-2 rounded-full transition-colors ${
                      index === subsceneIdx ? "bg-zinc-700" : "bg-zinc-300"
                    }`}
                  />
                ))}
              </div>
            </div>
          )}

          {supportBeforeText.length > 0 && (
            isResearcherMode ? (
              <div className="grid gap-3 md:grid-cols-2">
                {supportBeforeText.map((unit) => (
                  <SupportUnitCard key={unit.unit_id} unit={unit} technical />
                ))}
              </div>
            ) : (
              <ReaderLeadClueStrip units={supportBeforeText} />
            )
          )}
          {isResearcherMode && (governedSupport.diagnostics.length > 0 || governedSupport.suppressedCount > 0 || governedSupport.hiddenTriggerCount > 0) && (
            <div className="flex flex-wrap gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-[11px] font-semibold text-zinc-500">
              {governedSupport.diagnostics.map((item) => (
                <span key={item} className="rounded-full bg-white px-2.5 py-1">{item}</span>
              ))}
              {governedSupport.hiddenTriggerCount > 0 && (
                <span className="rounded-full bg-white px-2.5 py-1">hidden triggers {governedSupport.hiddenTriggerCount}</span>
              )}
              {governedSupport.suppressedCount > 0 && (
                <span className="rounded-full bg-white px-2.5 py-1">suppressed {governedSupport.suppressedCount}</span>
              )}
            </div>
          )}

          {!isResearcherMode && (
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-zinc-200" />
              <span className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                본문
              </span>
              <div className="h-px flex-1 bg-zinc-200" />
            </div>
          )}

          <div className={`flex flex-col gap-5 rounded-2xl bg-white px-7 py-6 text-[17px] leading-9 text-zinc-700 shadow-sm xl:text-[18px] ${
            isResearcherMode
              ? "border border-zinc-200"
              : "border-2 border-zinc-300 ring-4 ring-zinc-50"
          }`}>
            {bodyParagraphs.map((paragraph, index) => (
              <div key={index}>
                <p>{paragraph}</p>
                {!isResearcherMode && inlineSupportPlan.groups.get(index) && (
                  <InlineSupportAnchor
                    units={inlineSupportPlan.groups.get(index) ?? []}
                    onOpen={(units) => logSupportUnits("opened", units, "inline_support_opened")}
                  />
                )}
              </div>
            ))}
          </div>

          {renderedExpandableSupport.length > 0 && (
            <details
              className={isResearcherMode
                ? "rounded-xl border border-zinc-200 bg-white"
                : "overflow-hidden rounded-3xl border border-sky-200 bg-white shadow-sm"}
              onToggle={(event) => {
                if (event.currentTarget.open) {
                  logSupportUnits("opened", renderedExpandableSupport, isResearcherMode ? "on_demand_opened" : "reader_more_opened")
                }
              }}
            >
              <summary className={isResearcherMode
                ? "cursor-pointer px-4 py-3 text-sm font-semibold text-zinc-700"
                : "cursor-pointer list-none px-5 py-4 text-zinc-800 [&::-webkit-details-marker]:hidden"}>
                {isResearcherMode ? (
                  `${t.reader.moreSupport} (${renderedExpandableSupport.length})`
                ) : (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">
                        추가 도움말
                      </p>
                      <h3 className="mt-1 text-base font-semibold text-zinc-950">
                        헷갈릴 때만 보기 ({renderedExpandableSupport.length})
                      </h3>
                      <p className="mt-1 text-sm leading-6 text-zinc-500">
                        본문을 먼저 읽고, 인물·장소·이전 사건이 헷갈릴 때만 펼쳐보는 보조 설명입니다.
                      </p>
                    </div>
                    <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-800">
                      펼치기
                    </span>
                  </div>
                )}
              </summary>
              <div className={`grid gap-3 border-t p-4 md:grid-cols-2 ${
                isResearcherMode
                  ? "border-zinc-200 bg-zinc-50"
                  : "border-sky-100 bg-sky-50/60"
              }`}>
                {renderedExpandableSupport.map((unit) => (
                  <SupportUnitCard key={unit.unit_id} unit={unit} compact technical={isResearcherMode} />
                ))}
              </div>
            </details>
          )}

          {(packet.subscene_nav.length > 1 || final1.packets.length > 1) && (
            <div className="flex gap-2">
              <button
                onClick={goPrev}
                disabled={!hasPrev}
                className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm disabled:opacity-30 hover:bg-zinc-50"
              >
                {t.common.previous}
              </button>
              <button
                onClick={goNext}
                disabled={!hasNext}
                className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm disabled:opacity-30 hover:bg-zinc-50"
              >
                {t.common.next}
              </button>
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-5 xl:self-start">
          {isResearcherMode && (
            <CrossChapterMemoryPanel
              bookMemory={bookMemory}
              context={readerMemoryContext}
              activeTab={activeMemoryTab}
              onTabChange={setActiveMemoryTab}
            />
          )}

          {showVisualByDefault ? (
            renderVisualFrame()
          ) : visualAvailable ? (
            <details className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-zinc-700">
                {isResearcherMode ? t.reader.visualMinimized : "장면 이미지 보기"}
                <span className="ml-2 font-normal text-zinc-500">
                  {isResearcherMode
                    ? `${t.reader.visualScore} ${visualPolicy.usefulnessScore.toFixed(2)}`
                    : "필요할 때만 펼쳐서 확인"}
                </span>
              </summary>
              <div className="flex flex-col gap-3 border-t border-zinc-200 bg-zinc-50/60 p-3">
                <p className="text-xs text-zinc-500">
                  {t.reader.visualMinimizedMessage}
                </p>
                {renderVisualFrame()}
              </div>
            </details>
          ) : (
            <div className="rounded-2xl border border-dashed border-zinc-300 bg-white px-4 py-6 text-sm text-zinc-500">
              {t.reader.noVisual}
            </div>
          )}

          {isResearcherMode && subsceneView && (
            <details className="rounded-xl border border-zinc-200 bg-white shadow-sm">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-zinc-700">
                {t.reader.sceneFocusDetails}
              </summary>
              <div className="flex flex-col gap-4 border-t border-zinc-200 bg-zinc-50/60 p-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    {focusContext.mode === "global"
                      ? t.reader.subsceneView
                      : focusContext.mode === "character"
                        ? t.reader.characterView
                        : t.reader.pairView}
                  </p>
                  <h3 className="mt-2 text-lg font-semibold text-zinc-900">{focusContext.title}</h3>
                  <p className="mt-1 text-sm text-zinc-500">{focusContext.subtitle}</p>
                  <p className="mt-3 text-[15px] leading-7 text-zinc-700">{focusContext.summary}</p>
                </div>

                {focusContext.hints.length > 0 && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {focusContext.hints.map((hint, index) => (
                      <div
                        key={`${focusContext.mode}:hint:${hint.label}:${index}`}
                        className="rounded-xl border border-zinc-200 bg-white px-4 py-3"
                      >
                        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                          {hint.label}
                        </p>
                        <p className="mt-2 text-sm leading-6 text-zinc-700">{hint.text}</p>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap gap-1.5">
                  {READER_PANEL_BUTTON_ORDER.map((buttonKey) => {
                    const button = focusContext.buttons.find((item) => item.key === buttonKey)
                    const enabled = Boolean(focusContext.panels[buttonKey])
                    const active = enabled && activePanel === buttonKey
                    return (
                      <button
                        key={buttonKey}
                        type="button"
                        disabled={!enabled}
                        onClick={() => {
                          if (!enabled) return
                          setActivePanel(activePanel === buttonKey ? null : buttonKey)
                        }}
                        className={`flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-medium transition-colors ${
                          !enabled
                            ? "cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-400"
                            : active
                              ? (READER_PANEL_BUTTON_META[buttonKey]?.active ?? "border-zinc-800 bg-zinc-800 text-white shadow-sm")
                              : (READER_PANEL_BUTTON_META[buttonKey]?.idle ?? "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400")
                        }`}
                      >
                        <span
                          className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${
                            enabled ? "bg-white/75 text-current" : "bg-white/60 text-zinc-400"
                          }`}
                        >
                          {READER_PANEL_BUTTON_META[buttonKey]?.icon ?? "i"}
                        </span>
                        <span>{t.reader.panelButton[buttonKey as keyof typeof t.reader.panelButton] ?? button?.label ?? buttonKey}</span>
                      </button>
                    )
                  })}
                </div>

                {activePanel && focusContext.panels[activePanel] && (
                  <div className="rounded-lg border border-zinc-200 bg-white p-3 text-sm leading-7 text-zinc-600">
                    {focusContext.panels[activePanel]}
                  </div>
                )}
              </div>
            </details>
          )}

          {isResearcherMode && supportBesideVisual.length > 0 && (
            <details
              className="rounded-xl border border-zinc-200 bg-white shadow-sm"
              onToggle={(event) => {
                if (event.currentTarget.open) {
                  logSupportUnits("opened", supportBesideVisual, "side_support_opened")
                }
              }}
            >
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-zinc-700">
                {t.reader.castPlaceVisualCues} ({supportBesideVisual.length})
              </summary>
              <div className="grid gap-3 border-t border-zinc-200 bg-zinc-50/60 p-4">
                {supportBesideVisual.map((unit) => (
                  <SupportUnitCard key={unit.unit_id} unit={unit} compact technical />
                ))}
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  )
}
