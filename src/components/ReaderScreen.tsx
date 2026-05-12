"use client"

/**
 * FINAL.3 - Reader Screen
 * Merges FINAL.1 (SceneReaderPackageLog) + FINAL.2 (OverlayRefinementResult, optional)
 * and renders the clean reader UI.
 */

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { useUiStrings } from "@/components/LanguageProvider"
import {
  compactReaderText,
  realizeAnchoredSupportUnit,
  realizeSupportUnit,
  splitSupportBridgeBody,
  type AnchoredSupportContext,
} from "@/lib/support-realization"
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
  return realizeSupportUnit(unit).title
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
  return splitSupportBridgeBody(body)
}

function compactSupportText(text: string, maxLength = 110): string {
  return compactReaderText(text, maxLength)
}

function getReaderLeadClueText(unit: SupportUnit): string {
  return compactSupportText(realizeSupportUnit(unit).preview)
}

interface InlineSupportPlan {
  groups: Map<number, SupportTextAnchor[]>
  fallbackUnits: SupportUnit[]
  placementByUnitId: Map<string, string>
}

type SupportAnchorGranularity = "paragraph" | "sentence" | "phrase" | "word"

interface SupportTextAnchor {
  anchorId: string
  unit: SupportUnit
  paragraphIndex: number
  start: number | null
  end: number | null
  granularity: SupportAnchorGranularity
}

interface SupportAnchorGroup {
  anchorId: string
  units: SupportUnit[]
  start: number | null
  end: number | null
  granularity: SupportAnchorGranularity
}

interface SupportAnchorSelectionInput extends SupportAnchorGroup {
  selectedText: string
  paragraphText: string
  label: string
}

interface ActiveSupportSelection extends SupportAnchorSelectionInput {
  selectedUnitId: string | null
}

function normalizeSupportMatchText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase()
}

function buildNormalizedIndex(text: string): { normalized: string; indexMap: number[] } {
  let normalized = ""
  const indexMap: number[] = []
  let previousWasSpace = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (/\s/.test(char)) {
      if (!previousWasSpace) {
        normalized += " "
        indexMap.push(index)
        previousWasSpace = true
      }
      continue
    }

    normalized += char.toLowerCase()
    indexMap.push(index)
    previousWasSpace = false
  }

  return { normalized: normalized.trim(), indexMap }
}

function findTextRange(candidate: string, paragraph: string): { start: number; end: number } | null {
  const trimmed = candidate.trim()
  if (!trimmed) return null

  const exactIndex = paragraph.indexOf(trimmed)
  if (exactIndex >= 0) {
    return { start: exactIndex, end: exactIndex + trimmed.length }
  }

  const normalizedCandidate = normalizeSupportMatchText(trimmed)
  const { normalized, indexMap } = buildNormalizedIndex(paragraph)
  const normalizedIndex = normalized.indexOf(normalizedCandidate)
  if (normalizedIndex < 0) return null

  const start = indexMap[normalizedIndex]
  const lastMappedIndex = indexMap[normalizedIndex + normalizedCandidate.length - 1]
  if (typeof start !== "number" || typeof lastMappedIndex !== "number") return null
  return { start, end: lastMappedIndex + 1 }
}

function expandRangeToSentence(paragraph: string, range: { start: number; end: number }): { start: number; end: number } {
  const sentenceBoundary = /[.!?。！？…]/
  let start = range.start
  let end = range.end

  for (let index = range.start - 1; index >= 0; index -= 1) {
    if (sentenceBoundary.test(paragraph[index])) {
      start = index + 1
      break
    }
    if (index === 0) start = 0
  }

  for (let index = range.end; index < paragraph.length; index += 1) {
    if (sentenceBoundary.test(paragraph[index])) {
      end = index + 1
      break
    }
    if (index === paragraph.length - 1) end = paragraph.length
  }

  while (start < end && /\s/.test(paragraph[start])) start += 1
  while (end > start && /\s/.test(paragraph[end - 1])) end -= 1

  return { start, end }
}

function anchorGranularity(
  paragraph: string,
  range: { start: number; end: number } | null,
): { start: number | null; end: number | null; granularity: SupportAnchorGranularity } {
  if (!range) return { start: null, end: null, granularity: "paragraph" }

  const length = range.end - range.start
  const paragraphLength = Math.max(1, paragraph.length)
  if (length / paragraphLength > 0.65 || length > 220) {
    return { start: null, end: null, granularity: "paragraph" }
  }

  const selectedText = paragraph.slice(range.start, range.end).trim()
  if (selectedText.length <= 18 && !/\s/.test(selectedText)) {
    return { ...range, granularity: "word" }
  }

  if (length >= 45) {
    const sentenceRange = expandRangeToSentence(paragraph, range)
    const sentenceLength = sentenceRange.end - sentenceRange.start
    if (sentenceLength / paragraphLength <= 0.75 && sentenceLength <= 260) {
      return { ...sentenceRange, granularity: "sentence" }
    }
  }

  return { ...range, granularity: "phrase" }
}

function textMatchesParagraph(candidate: string | undefined, paragraph: string): boolean {
  if (!candidate) return false
  const normalizedCandidate = normalizeSupportMatchText(candidate)
  const normalizedParagraph = normalizeSupportMatchText(paragraph)
  if (normalizedParagraph.length < 2) return false
  if (normalizedCandidate.length < 18) {
    return normalizedCandidate.length >= 4 && normalizedParagraph.includes(normalizedCandidate)
  }
  if (normalizedParagraph.includes(normalizedCandidate)) return true
  if (normalizedCandidate.includes(normalizedParagraph)) return true
  const compactCandidate = normalizedCandidate.slice(0, Math.min(80, normalizedCandidate.length))
  return compactCandidate.length >= 24 && normalizedParagraph.includes(compactCandidate)
}

function firstMatchingParagraphIndex(candidates: string[], paragraphs: string[]): number | null {
  for (const candidate of candidates) {
    for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
      if (textMatchesParagraph(candidate, paragraphs[paragraphIndex])) return paragraphIndex
    }
  }
  return null
}

function splitSupportListText(text: string): string[] {
  return text
    .split(/\s*(?:,|;|\||\/|\band\b)\s*/i)
    .map((item) => item.replace(/[.:]+$/g, "").trim())
    .filter((item) => item.length >= 3)
}

function extractBodyField(body: string, labels: string[]): string[] {
  const matches: string[] = []
  for (const label of labels) {
    const pattern = new RegExp(`${label}:\\s*([^.;]+)`, "i")
    const match = body.match(pattern)
    if (match?.[1]) matches.push(...splitSupportListText(match[1]))
  }
  return matches
}

function extractCharacterCandidates(body: string): string[] {
  const activeMatch = body.match(/^(.+?)\s+(?:is|are)\s+active\b/i)
  if (activeMatch?.[1]) return splitSupportListText(activeMatch[1])
  return extractBodyField(body, ["Cast", "Active cast"])
}

function extractReferenceTargets(body: string): string[] {
  const match = body.match(/against:\s*(.+)$/i)
  return match?.[1] ? splitSupportListText(match[1]) : extractBodyField(body, ["Cast", "Active cast"])
}

function extractAnchorCandidatesFromBody(unit: SupportUnit): string[] {
  switch (unit.kind) {
    case "character_focus":
      return extractCharacterCandidates(unit.body)
    case "spatial_continuity":
      return extractBodyField(unit.body, ["Current place", "Nearby/mentioned places", "Place"])
    case "visual_context":
      return unit.body.length >= 3 && unit.body.length <= 80 ? [unit.body] : extractBodyField(unit.body, ["Environment", "Objects", "Place"])
    case "boundary_delta":
      return [
        ...extractBodyField(unit.body, ["Entered", "Exited", "Current place", "Place"]),
        ...unit.body.split(/\s*(?:->|→|=>)\s*/).flatMap(splitSupportListText),
      ]
    default:
      return []
  }
}

function findReferenceAnchor(
  unit: SupportUnit,
  paragraphs: string[],
  activeSubsceneId: string,
): SupportTextAnchor | null {
  const evidenceTexts = unit.evidence
    .filter((ref) => !ref.subscene_id || ref.subscene_id === activeSubsceneId)
    .map((ref) => ref.text)
    .filter((text): text is string => Boolean(text))
  const targetNames = extractReferenceTargets(unit.body)
  const referenceCandidates = [
    "she",
    "her",
    "hers",
    "he",
    "him",
    "his",
    "they",
    "them",
    "their",
    "it",
    "its",
    ...targetNames,
  ]

  for (const evidenceText of evidenceTexts) {
    for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
      const paragraph = paragraphs[paragraphIndex]
      if (!textMatchesParagraph(evidenceText, paragraph)) continue

      for (const candidate of referenceCandidates) {
        const range = findTextRange(candidate, paragraph)
        if (!range) continue
        const anchor = anchorGranularity(paragraph, range)
        return {
          anchorId: `${unit.unit_id}:${paragraphIndex}:${anchor.start ?? "paragraph"}:${anchor.end ?? "paragraph"}`,
          unit,
          paragraphIndex,
          start: anchor.start,
          end: anchor.end,
          granularity: anchor.granularity,
        }
      }

      return {
        anchorId: `${unit.unit_id}:${paragraphIndex}:paragraph:paragraph`,
        unit,
        paragraphIndex,
        start: null,
        end: null,
        granularity: "paragraph",
      }
    }
  }

  return null
}

function findSupportTextAnchor(
  unit: SupportUnit,
  paragraphs: string[],
  activeSubsceneId: string,
): SupportTextAnchor | null {
  if (unit.kind === "reference_repair") {
    return findReferenceAnchor(unit, paragraphs, activeSubsceneId)
  }

  const evidenceTexts = unit.evidence
    .filter((ref) => !ref.subscene_id || ref.subscene_id === activeSubsceneId)
    .map((ref) => ref.text)
    .filter((text): text is string => Boolean(text))

  const bridgeParts = unit.reader_problem === "causal_gap"
    ? splitCausalBridgeBody(unit.body)
    : null
  const bodyCandidates = extractAnchorCandidatesFromBody(unit)
  const candidates = [
    ...bodyCandidates,
    ...evidenceTexts,
    bridgeParts?.current,
  ].filter((candidate): candidate is string => Boolean(candidate))

  if (unit.kind === "snapshot" || unit.kind === "reentry_recap") {
    const paragraphIndex = firstMatchingParagraphIndex(evidenceTexts, paragraphs)
    if (paragraphIndex === null) return null
    return {
      anchorId: `${unit.unit_id}:${paragraphIndex}:paragraph:paragraph`,
      unit,
      paragraphIndex,
      start: null,
      end: null,
      granularity: "paragraph",
    }
  }

  for (const candidate of candidates) {
    for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
      const paragraph = paragraphs[paragraphIndex]
      if (!textMatchesParagraph(candidate, paragraph)) continue

      const range = findTextRange(candidate, paragraph)
      const anchor = anchorGranularity(paragraph, range)
      return {
        anchorId: `${unit.unit_id}:${paragraphIndex}:${anchor.start ?? "paragraph"}:${anchor.end ?? "paragraph"}`,
        unit,
        paragraphIndex,
        start: anchor.start,
        end: anchor.end,
        granularity: anchor.granularity,
      }
    }
  }

  return null
}

function buildInlineSupportPlan(
  units: SupportUnit[],
  paragraphs: string[],
  activeSubsceneId: string,
): InlineSupportPlan {
  const groups = new Map<number, SupportTextAnchor[]>()
  const fallbackUnits: SupportUnit[] = []
  const placementByUnitId = new Map<string, string>()

  for (const unit of units) {
    const anchor = findSupportTextAnchor(unit, paragraphs, activeSubsceneId)
    if (!anchor) {
      fallbackUnits.push(unit)
      placementByUnitId.set(unit.unit_id, "헷갈릴 때만 보기")
      continue
    }

    const existing = groups.get(anchor.paragraphIndex) ?? []
    groups.set(anchor.paragraphIndex, [...existing, anchor])
    const placementLabel = anchor.granularity === "paragraph"
      ? "문단"
      : anchor.granularity === "sentence"
        ? "문장"
        : anchor.granularity === "word"
          ? "단어"
          : "구절"
    placementByUnitId.set(unit.unit_id, `본문 ${anchor.paragraphIndex + 1}번째 ${placementLabel}`)
  }

  return { groups, fallbackUnits, placementByUnitId }
}

function paragraphAnchorId(index: number): string {
  return `paragraph:${index}`
}

function anchorGroupLabel(group: SupportAnchorGroup): string {
  if (group.granularity === "paragraph") return "문단 관련 힌트"
  if (group.granularity === "sentence") return "문장 관련 힌트"
  if (group.granularity === "word") return "단어 관련 힌트"
  return "구절 관련 힌트"
}

function supportTypeLabels(units: SupportUnit[]): string[] {
  return Array.from(new Set(units.map((unit) => realizeSupportUnit(unit).chipLabel))).slice(0, 3)
}

function SupportTypeBadgeRow({ units }: { units: SupportUnit[] }) {
  const labels = supportTypeLabels(units)
  if (labels.length === 0) return null

  return (
    <span className="ml-1.5 inline-flex translate-y-[-1px] items-center gap-1 align-baseline">
      {labels.map((label) => (
        <span
          key={label}
          className="rounded-full border border-sky-300 bg-white px-1.5 py-0.5 text-[10px] font-semibold leading-none text-sky-800"
        >
          {label}
        </span>
      ))}
    </span>
  )
}

const SUPPORT_GRANULARITY_RANK: Record<SupportAnchorGranularity, number> = {
  word: 0,
  phrase: 1,
  sentence: 2,
  paragraph: 3,
}

function smallestGranularity(granularities: SupportAnchorGranularity[]): SupportAnchorGranularity {
  return granularities.sort((a, b) => SUPPORT_GRANULARITY_RANK[a] - SUPPORT_GRANULARITY_RANK[b])[0] ?? "paragraph"
}

function sameSupportUnits(left: SupportUnit[], right: SupportUnit[]): boolean {
  if (left.length !== right.length) return false
  const leftIds = left.map((unit) => unit.unit_id).sort().join("|")
  const rightIds = right.map((unit) => unit.unit_id).sort().join("|")
  return leftIds === rightIds
}

function segmentRangeAnchors(
  anchors: SupportTextAnchor[],
  paragraphUnits: SupportUnit[],
  paragraph: string,
  paragraphIndex: number,
): SupportAnchorGroup[] {
  const rangeAnchors = anchors
    .filter((anchor) => anchor.start !== null && anchor.end !== null && anchor.end > anchor.start)
    .sort((a, b) => (a.start ?? 0) - (b.start ?? 0) || (b.end ?? 0) - (a.end ?? 0))
  if (rangeAnchors.length === 0) return []

  const boundaries = Array.from(new Set(rangeAnchors.flatMap((anchor) => [anchor.start ?? 0, anchor.end ?? 0])))
    .filter((value) => value >= 0 && value <= paragraph.length)
    .sort((a, b) => a - b)

  const groups: SupportAnchorGroup[] = []
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index]
    const end = boundaries[index + 1]
    if (end <= start || !paragraph.slice(start, end).trim()) continue

    const coveringAnchors = rangeAnchors.filter((anchor) => {
      const anchorStart = anchor.start ?? 0
      const anchorEnd = anchor.end ?? anchorStart
      return anchorStart <= start && anchorEnd >= end
    })
    if (coveringAnchors.length === 0) continue

    const units = uniqueSupportUnits([
      ...coveringAnchors.map((anchor) => anchor.unit),
      ...paragraphUnits,
    ])
    const granularity = smallestGranularity(coveringAnchors.map((anchor) => anchor.granularity))
    const previous = groups[groups.length - 1]

    if (
      previous &&
      previous.end === start &&
      previous.granularity === granularity &&
      sameSupportUnits(previous.units, units)
    ) {
      previous.end = end
      previous.anchorId = `segment:${paragraphIndex}:${previous.start}:${previous.end}`
      continue
    }

    groups.push({
      anchorId: `segment:${paragraphIndex}:${start}:${end}`,
      units,
      start,
      end,
      granularity,
    })
  }

  return groups
}

function supportSelectionContext(selection: ActiveSupportSelection, mode: ReaderScreenMode): AnchoredSupportContext {
  return {
    selectedText: selection.selectedText,
    paragraphText: selection.paragraphText,
    granularity: selection.granularity,
    mode,
  }
}

function SupportChoicePopover({
  selection,
  selectedUnitId,
  onPick,
  onClose,
  variant = "reader",
}: {
  selection: SupportAnchorSelectionInput
  selectedUnitId: string | null
  onPick: (unit: SupportUnit) => void
  onClose: () => void
  variant?: "reader" | "researcher"
}) {
  if (selection.units.length <= 1 || selectedUnitId) return null

  return (
    <>
      <button
        type="button"
        aria-label="도움 선택 닫기"
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default bg-transparent"
      />
      <div
        role="dialog"
        aria-label="도움 종류 선택"
        className={`absolute left-0 top-full z-50 mt-2 w-[min(24rem,calc(100vw-2rem))] rounded-xl border p-2.5 shadow-xl ${
          variant === "researcher"
            ? "border-sky-200 bg-white"
            : "border-zinc-200 bg-white/95"
        }`}
      >
        <div className="flex items-center justify-between gap-3 px-1 pb-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              {selection.label}
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">
              {selection.units.length}개의 도움 중 선택
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-zinc-200 px-2.5 py-1 text-xs font-semibold text-zinc-500 hover:bg-zinc-50"
          >
            닫기
          </button>
        </div>
        <div className="grid gap-1.5">
          {selection.units.map((unit) => {
            const realized = realizeAnchoredSupportUnit(unit, {
              selectedText: selection.selectedText,
              paragraphText: selection.paragraphText,
              granularity: selection.granularity,
              mode: variant,
            })
            const preview = realized.bullets[0]
              ? `${realized.bullets[0].label}: ${realized.bullets[0].text}`
              : realized.bridge
                ? `${realized.bridge.previous} -> ${realized.bridge.current}`
                : (realized.detail ?? realized.lead)
            return (
              <button
                key={unit.unit_id}
                type="button"
                onClick={() => onPick(unit)}
                className="w-full rounded-lg border border-transparent px-3 py-2 text-left transition-colors hover:border-zinc-200 hover:bg-zinc-50"
              >
                <span className="flex min-w-0 items-start gap-2">
                  <span className="mt-0.5 shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-800">
                    {realized.chipLabel}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold leading-5 text-zinc-900">
                      {realized.title}
                    </span>
                    <span className="mt-0.5 line-clamp-1 block text-xs leading-5 text-zinc-500">
                      {preview}
                    </span>
                    {variant === "researcher" && (
                      <span className="mt-1 block text-[11px] font-medium text-zinc-400">
                        {unit.kind} · {unit.reader_problem ?? "reader_problem 없음"} · priority {unit.priority.toFixed(2)}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}

function ReaderTextParagraph({
  paragraph,
  index,
  anchors,
  activeAnchorId,
  selectedUnitId,
  onSelect,
  onPickUnit,
  onCloseSelection,
  variant = "reader",
}: {
  paragraph: string
  index: number
  anchors: SupportTextAnchor[]
  activeAnchorId: string | null
  selectedUnitId: string | null
  onSelect: (selection: SupportAnchorSelectionInput) => void
  onPickUnit: (unit: SupportUnit) => void
  onCloseSelection: () => void
  variant?: "reader" | "researcher"
}) {
  const isResearcherVariant = variant === "researcher"
  const paragraphUnits = uniqueSupportUnits(
    anchors.filter((anchor) => anchor.granularity === "paragraph").map((anchor) => anchor.unit),
  )
  const paragraphGroup: SupportAnchorGroup | null = paragraphUnits.length > 0
    ? {
        anchorId: paragraphAnchorId(index),
        units: paragraphUnits,
        start: null,
        end: null,
        granularity: "paragraph",
      }
    : null
  const rangeGroups = segmentRangeAnchors(anchors, paragraphUnits, paragraph, index)
  const activeGroup = [paragraphGroup, ...rangeGroups].find((group) => group?.anchorId === activeAnchorId) ?? null
  const paragraphInteractive = Boolean(paragraphGroup)

  function buildSelection(group: SupportAnchorGroup): SupportAnchorSelectionInput {
    const selectedText = group.start === null || group.end === null
      ? compactSupportText(paragraph, 150)
      : paragraph.slice(group.start, group.end).trim()
    return {
      ...group,
      selectedText,
      paragraphText: paragraph,
      label: anchorGroupLabel(group),
    }
  }

  function handleParagraphSelect() {
    if (!paragraphGroup) return
    onSelect(buildSelection(paragraphGroup))
  }

  function handleParagraphKeyDown(event: KeyboardEvent<HTMLParagraphElement>) {
    if (!paragraphGroup) return
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    handleParagraphSelect()
  }

  let cursor = 0
  const content: ReactNode[] = []
  for (const group of rangeGroups) {
    if (group.start === null || group.end === null) continue
    if (group.start > cursor) {
      content.push(paragraph.slice(cursor, group.start))
    }
    const active = activeAnchorId === group.anchorId
    content.push(
      <button
        key={group.anchorId}
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          onSelect(buildSelection(group))
        }}
        className={`rounded-sm border-b px-0.5 text-left text-inherit [font:inherit] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${
          isResearcherVariant
            ? active
              ? "border-sky-500 bg-sky-100 text-sky-950 ring-1 ring-sky-200"
              : "border-sky-300 bg-sky-50/80 text-sky-950 hover:bg-sky-100"
            : active
              ? "border-sky-400 bg-sky-100 text-sky-950"
              : "border-transparent hover:border-sky-300 hover:bg-sky-50/80"
        }`}
        title={anchorGroupLabel(group)}
      >
        {paragraph.slice(group.start, group.end)}
        {isResearcherVariant && <SupportTypeBadgeRow units={group.units} />}
      </button>,
    )
    cursor = group.end
  }
  if (cursor < paragraph.length) {
    content.push(paragraph.slice(cursor))
  }

  const paragraphClass = isResearcherVariant
    ? paragraphInteractive
      ? activeAnchorId === paragraphGroup?.anchorId
        ? "cursor-help rounded-lg border-l-4 border-sky-400 bg-sky-50/90 px-3 py-2 outline outline-1 outline-sky-100"
        : "cursor-help rounded-lg border-l-4 border-sky-300 bg-sky-50/50 px-3 py-2 hover:bg-sky-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-200"
      : "rounded-lg px-3 py-2"
    : paragraphInteractive
      ? activeAnchorId === paragraphGroup?.anchorId
        ? "rounded-lg bg-sky-50/80"
        : "cursor-help rounded-lg transition-colors hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-200"
      : "rounded-lg transition-colors"

  return (
    <div className="relative">
      <p
        role={paragraphInteractive ? "button" : undefined}
        tabIndex={paragraphInteractive ? 0 : undefined}
        onClick={paragraphInteractive ? handleParagraphSelect : undefined}
        onKeyDown={paragraphInteractive ? handleParagraphKeyDown : undefined}
        className={paragraphClass}
      >
        {content.length > 0 ? content : paragraph}
        {isResearcherVariant && paragraphGroup && (
          <SupportTypeBadgeRow units={paragraphGroup.units} />
        )}
      </p>
      {activeGroup ? (
        <SupportChoicePopover
          selection={buildSelection(activeGroup)}
          selectedUnitId={selectedUnitId}
          onPick={onPickUnit}
          onClose={onCloseSelection}
          variant={variant}
        />
      ) : null}
    </div>
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
  const realized = realizeSupportUnit(unit)
  const bridgeParts = !technical ? realized.bridge : null

  if (!technical && bridgeParts) {
    return (
      <div className="mt-3 space-y-3">
        <p className="text-sm leading-6 text-zinc-600">
          {realized.detail}
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

  const body = technical ? getReaderSupportBody(unit, true) : realized.detail

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
  const realized = realizeSupportUnit(unit)

  if (compact && !technical) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
            {realized.chipLabel}
          </span>
          <h4 className="text-sm font-semibold text-zinc-900">
            {realized.title}
          </h4>
        </div>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500">
          {getReaderLeadClueText(unit)}
        </p>
        <details className="mt-2 rounded-lg border border-zinc-100 bg-zinc-50 px-2.5 py-1.5">
          <summary className="cursor-pointer text-[11px] font-semibold text-zinc-500">
            자세히 보기
          </summary>
          <div className="mt-2">
            <ReaderSupportBody unit={unit} compact={false} technical={false} />
            {evidencePreview && (
              <p className="mt-2 rounded-md bg-white px-2 py-1 text-xs leading-5 text-zinc-500">
                근거: {evidencePreview}
              </p>
            )}
          </div>
        </details>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
          technical ? "bg-zinc-100 text-zinc-600" : "bg-amber-100 text-amber-900"
        }`}>
          {technical
            ? (t.reader.supportKind[unit.kind as keyof typeof t.reader.supportKind] ?? unit.label)
            : realized.categoryLabel}
        </span>
        {technical && (
          <span className="text-[11px] text-zinc-400">
            {Math.round(unit.priority * 100)}
          </span>
        )}
      </div>
      <h4 className={`mt-3 font-semibold text-zinc-900 ${compact ? "text-sm" : "text-base"}`}>
        {technical ? getReaderSupportTitle(unit, true) : realized.title}
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

function AnchoredSupportSurface({
  selection,
  unit,
  mode,
  onClose,
  surface = "side",
}: {
  selection: ActiveSupportSelection
  unit: SupportUnit
  mode: ReaderScreenMode
  onClose: () => void
  surface?: "side" | "sheet"
}) {
  const technical = mode === "researcher"
  const realized = realizeAnchoredSupportUnit(unit, supportSelectionContext(selection, mode))
  const evidencePreview = unit.evidence.find((ref) => ref.text?.trim())?.text
  const scoreParts = [
    typeof unit.usefulness_score === "number" ? `use ${unit.usefulness_score.toFixed(2)}` : "",
    typeof unit.grounding_score === "number" ? `ground ${unit.grounding_score.toFixed(2)}` : "",
    typeof unit.intrusion_cost === "number" ? `intrude ${unit.intrusion_cost.toFixed(2)}` : "",
    typeof unit.confidence === "number" ? `conf ${unit.confidence.toFixed(2)}` : "",
  ].filter(Boolean)
  const shellClass = surface === "sheet"
    ? "max-h-[72vh] overflow-y-auto rounded-t-2xl border-t border-zinc-200 bg-white px-5 py-4 shadow-2xl"
    : "sticky top-5 rounded-2xl border border-sky-200 bg-white px-5 py-4 shadow-lg"

  return (
    <aside className={shellClass} aria-label="선택한 본문 도움">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-semibold text-sky-800">
              {realized.chipLabel}
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
              {selection.label}
            </span>
          </div>
          <h3 className="mt-3 text-base font-semibold leading-6 text-zinc-950">
            {realized.title}
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-full border border-zinc-200 px-2.5 py-1 text-xs font-semibold text-zinc-500 hover:bg-zinc-50"
        >
          닫기
        </button>
      </div>

      <div className="mt-4 rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2">
        <p className="text-[11px] font-semibold text-zinc-400">선택한 본문</p>
        <p className="mt-1 line-clamp-3 text-sm leading-6 text-zinc-600">
          {selection.selectedText}
        </p>
      </div>

      <p className="mt-4 text-sm leading-6 text-zinc-700">
        {realized.lead}
      </p>

      {realized.bridge ? (
        <div className="mt-4 grid gap-2">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
            <p className="text-[11px] font-semibold text-amber-900">이전에는</p>
            <p className="mt-1 text-sm leading-6 text-zinc-800">{realized.bridge.previous}</p>
          </div>
          <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5">
            <p className="text-[11px] font-semibold text-sky-900">그래서 지금</p>
            <p className="mt-1 text-sm leading-6 text-zinc-800">{realized.bridge.current}</p>
          </div>
        </div>
      ) : realized.bullets.length > 0 ? (
        <dl className="mt-4 grid gap-2">
          {realized.bullets.slice(0, 4).map((item) => (
            <div key={`${item.label}:${item.text}`} className="rounded-lg border border-zinc-100 bg-white px-3 py-2">
              <dt className="text-[11px] font-semibold text-zinc-400">{item.label}</dt>
              <dd className="mt-1 text-sm leading-6 text-zinc-700">{item.text}</dd>
            </div>
          ))}
        </dl>
      ) : realized.detail ? (
        <p className="mt-3 text-sm leading-6 text-zinc-600">{realized.detail}</p>
      ) : null}

      {!technical && realized.evidenceLabel && (
        <details className="mt-4 rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2">
          <summary className="cursor-pointer text-[11px] font-semibold text-zinc-500">
            근거 문장 보기
          </summary>
          <p className="mt-2 text-xs leading-5 text-zinc-600">{realized.evidenceLabel}</p>
        </details>
      )}

      {technical && (
        <details className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
          <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            provenance / debug
          </summary>
          <div className="mt-2 space-y-2 text-xs leading-5 text-zinc-500">
            <p>kind: {unit.kind} · problem: {unit.reader_problem ?? "-"}</p>
            <p>display: {unit.default_display ?? "-"} · spoiler: {unit.spoiler_risk ?? "none"}</p>
            {scoreParts.length > 0 && <p>{scoreParts.join(" · ")}</p>}
            {unit.source_stage_ids.length > 0 && <p>source: {unit.source_stage_ids.join(", ")}</p>}
            <p>parsed: {realized.debug?.parsedFrom ?? "fallback"}</p>
            {evidencePreview && <p className="rounded-md bg-white px-2 py-1 text-zinc-600">{evidencePreview}</p>}
            <p className="rounded-md bg-white px-2 py-1 text-zinc-600">raw title: {unit.title}</p>
            <p className="rounded-md bg-white px-2 py-1 text-zinc-600">raw body: {unit.body}</p>
          </div>
        </details>
      )}
    </aside>
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

type SupportPipelineStage = {
  key: "all" | "sup7" | "governor"
  title: string
  eyebrow: string
  description: string
  items: Array<{
    unit: SupportUnit
    meta: string
    placement?: string
  }>
}

function getSup7Slot(unit: SupportUnit, support: SceneReaderPacket["support"]): string {
  const plan = support?.display_plan
  if (plan?.default_visible?.some((item) => item.unit_id === unit.unit_id)) return "default visible"
  if (plan?.expandable?.some((item) => item.unit_id === unit.unit_id)) return "expandable"
  if (plan?.trigger_only?.some((item) => item.unit_id === unit.unit_id)) return "trigger only"
  if (plan?.suppressed?.some((item) => item.unit_id === unit.unit_id)) return "suppressed"
  if (support?.display_slots.before_text.some((item) => item.unit_id === unit.unit_id)) return "before text"
  if (support?.display_slots.on_demand.some((item) => item.unit_id === unit.unit_id)) return "on demand"
  if (support?.display_slots.beside_visual.some((item) => item.unit_id === unit.unit_id)) return "beside visual"
  return "candidate"
}

function getDisplaySlotUnits(support: SceneReaderPacket["support"]): SupportUnit[] {
  if (!support) return []
  return uniqueSupportUnits([
    ...support.display_slots.before_text,
    ...support.display_slots.on_demand,
    ...support.display_slots.beside_visual,
  ])
}

function getSupportCandidateUnits(support: SceneReaderPacket["support"]): SupportUnit[] {
  const candidateUnits = support?.display_plan?.candidate_units ?? []
  return candidateUnits.length > 0 ? candidateUnits : getDisplaySlotUnits(support)
}

function getSup7PlannedUnits(support: SceneReaderPacket["support"]): SupportUnit[] {
  if (!support) return []
  const plan = support.display_plan
  const plannedUnits = plan
    ? uniqueSupportUnits([
        ...(plan.default_visible ?? []),
        ...(plan.expandable ?? []),
        ...(plan.trigger_only ?? []),
      ])
    : []

  if (plannedUnits.length > 0) return plannedUnits
  return uniqueSupportUnits([
    ...getDisplaySlotUnits(support),
    ...(plan?.candidate_units ?? []),
  ])
}

function buildSupportPipelineStages(params: {
  packet: SceneReaderPacket
  supportBeforeText: SupportUnit[]
  readerExpandableSupport: SupportUnit[]
  inlinePlacementByUnitId: Map<string, string>
}): SupportPipelineStage[] {
  const support = params.packet.support
  if (!support) return []

  const allUnits = uniqueSupportUnits([
    ...support.primary_units,
    ...support.overflow_units,
    ...getDisplaySlotUnits(support),
    ...getSupportCandidateUnits(support),
  ])
  const sup7Units = getSup7PlannedUnits(support)
  const governorUnits = uniqueSupportUnits([
    ...params.supportBeforeText,
    ...params.readerExpandableSupport,
  ])

  return [
    {
      key: "all",
      eyebrow: "1. generated",
      title: "전체 생성 후보",
      description: "SUP.2~5와 이전 support branch에서 만들어진 후보 전체입니다.",
      items: allUnits.map((unit) => ({
        unit,
        meta: realizeSupportUnit(unit).categoryLabel,
        placement: unit.source_stage_ids.join(", ") || unit.kind,
      })),
    },
    {
      key: "sup7",
      eyebrow: "2. SUP.7 plan",
      title: "SUP.7이 남긴 후보",
      description: "SUP.7 display plan에서 독자 화면 후보로 유지한 항목입니다.",
      items: sup7Units.map((unit) => ({
        unit,
        meta: realizeSupportUnit(unit).categoryLabel,
        placement: getSup7Slot(unit, support),
      })),
    },
    {
      key: "governor",
      eyebrow: "3. reader output",
      title: "Governor 최종 표시",
      description: "현재 독자 화면에서 lead, inline, fallback으로 실제 표시되는 항목입니다.",
      items: governorUnits.map((unit) => ({
        unit,
        meta: realizeSupportUnit(unit).categoryLabel,
        placement: params.inlinePlacementByUnitId.get(unit.unit_id) ??
          (params.supportBeforeText.some((item) => item.unit_id === unit.unit_id)
            ? "읽기 전 짧은 단서"
            : "헷갈릴 때만 보기"),
      })),
    },
  ]
}

function SupportPipelineMiniCard({
  item,
}: {
  item: SupportPipelineStage["items"][number]
}) {
  return (
    <details className="rounded-xl border border-zinc-200 bg-white px-3 py-2">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-zinc-900">
              {getReaderSupportTitle(item.unit, false)}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-zinc-500">
              {item.meta} · {item.placement}
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-500">
            {item.unit.kind}
          </span>
        </div>
      </summary>
      <p className="mt-2 border-t border-zinc-100 pt-2 text-xs leading-5 text-zinc-500">
        {item.unit.body}
      </p>
    </details>
  )
}

function ResearcherSupportDecisionBoard({
  stages,
}: {
  stages: SupportPipelineStage[]
}) {
  const totalCount = stages[0]?.items.length ?? 0
  const sup7Count = stages[1]?.items.length ?? 0
  const governorCount = stages[2]?.items.length ?? 0

  return (
    <section className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Support narrowing pipeline
          </p>
          <h4 className="mt-1 text-base font-semibold text-zinc-950">
            전체 후보에서 독자 화면 표시까지 3단계로 보기
          </h4>
          <p className="mt-1 text-sm leading-6 text-zinc-500">
            리스트는 간결하게 접어 두고, 각 단계가 몇 개를 남겼는지와 어디에 표시되는지만 먼저 보여줍니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <span className="rounded-full bg-zinc-100 px-3 py-1 text-zinc-600">전체 {totalCount}</span>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">SUP.7 {sup7Count}</span>
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">Governor {governorCount}</span>
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-3">
        {stages.map((stage) => (
          <div key={stage.key} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  {stage.eyebrow}
                </p>
                <h5 className="mt-1 text-sm font-semibold text-zinc-950">{stage.title}</h5>
              </div>
              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-zinc-500">
                {stage.items.length}
              </span>
            </div>
            <p className="mt-2 text-xs leading-5 text-zinc-500">{stage.description}</p>
            <div className="mt-3 grid max-h-[360px] gap-2 overflow-auto pr-1">
              {stage.items.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-3 py-4 text-xs text-zinc-500">
                  항목 없음
                </div>
              ) : (
                stage.items.map((item) => (
                  <SupportPipelineMiniCard key={`${stage.key}:${item.unit.unit_id}`} item={item} />
                ))
              )}
            </div>
          </div>
        ))}
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
  const candidateCount = getSupportCandidateUnits(packet.support).length
  const bookBridgeCount = (readerMemoryContext?.incomingEdges.length ?? 0)
    + (readerMemoryContext?.outgoingEdges.length ?? 0)
  const visibleCount = supportBeforeText.length + readerExpandableSupport.length
  const supportPipelineStages = buildSupportPipelineStages({
    packet,
    supportBeforeText,
    readerExpandableSupport,
    inlinePlacementByUnitId,
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

      <ResearcherSupportDecisionBoard stages={supportPipelineStages} />

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
  const [activeSupportSelection, setActiveSupportSelection] = useState<ActiveSupportSelection | null>(null)
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
  const visualSupportUnits = getSupportCandidateUnits(packet.support)
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
  const readerSelectableSupport = uniqueSupportUnits([...supportBeforeText, ...supportOnDemand, ...supportBesideVisual])
  const readerExpandableSupport = uniqueSupportUnits([...supportOnDemand, ...supportBesideVisual])
  const inlineSupportPlan = buildInlineSupportPlan(readerSelectableSupport, bodyParagraphs, activeSubsceneId)
  const renderedExpandableSupport = isResearcherMode ? supportOnDemand : inlineSupportPlan.fallbackUnits
  const readerMemoryContext = packet
    ? buildReaderMemoryContext(bookMemory, final1, packet, readerRunId)
    : null
  const activeTextSupportAnchorId = activeSupportSelection?.anchorId ?? null
  const activeSupportUnit = activeSupportSelection?.selectedUnitId
    ? activeSupportSelection.units.find((unit) => unit.unit_id === activeSupportSelection.selectedUnitId) ?? null
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

  function toggleTextSupportAnchor(selection: SupportAnchorSelectionInput) {
    if (activeSupportSelection?.anchorId === selection.anchorId) {
      if (activeSupportSelection.selectedUnitId && selection.units.length > 1) {
        setActiveSupportSelection({
          ...selection,
          units: uniqueSupportUnits(selection.units),
          selectedUnitId: null,
        })
        return
      }
      setActiveSupportSelection(null)
      return
    }

    const initialUnit = selection.units.length === 1 ? selection.units[0] : null
    if (initialUnit) {
      logSupportUnits("opened", [initialUnit], `text_anchor_opened:${initialUnit.kind}`)
    }

    setActiveSupportSelection({
      ...selection,
      units: uniqueSupportUnits(selection.units),
      selectedUnitId: initialUnit?.unit_id ?? null,
    })
  }

  function selectTextSupportUnit(unit: SupportUnit) {
    if (!activeSupportSelection) return
    if (activeSupportSelection.selectedUnitId !== unit.unit_id) {
      logSupportUnits("opened", [unit], `text_anchor_opened:${unit.kind}`)
    }
    setActiveSupportSelection({
      ...activeSupportSelection,
      selectedUnitId: unit.unit_id,
    })
  }

  function closeTextSupport() {
    setActiveSupportSelection(null)
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
    setActiveSupportSelection(null)
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
    if (!activeSupportSelection || typeof window === "undefined") return
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveSupportSelection(null)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [activeSupportSelection])

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

          {isResearcherMode && supportBeforeText.length > 0 && (
            <div className="grid gap-3 md:grid-cols-2">
              {supportBeforeText.map((unit) => (
                <SupportUnitCard key={unit.unit_id} unit={unit} technical />
              ))}
            </div>
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
              <ReaderTextParagraph
                key={index}
                paragraph={paragraph}
                index={index}
                anchors={inlineSupportPlan.groups.get(index) ?? []}
                activeAnchorId={activeTextSupportAnchorId}
                selectedUnitId={activeSupportSelection?.selectedUnitId ?? null}
                onSelect={toggleTextSupportAnchor}
                onPickUnit={selectTextSupportUnit}
                onCloseSelection={closeTextSupport}
                variant={isResearcherMode ? "researcher" : "reader"}
              />
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
          {activeSupportSelection && activeSupportUnit && (
            <div className="hidden xl:block">
              <AnchoredSupportSurface
                selection={activeSupportSelection}
                unit={activeSupportUnit}
                mode={mode}
                onClose={closeTextSupport}
              />
            </div>
          )}

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

      {activeSupportSelection && activeSupportUnit && (
        <div className="xl:hidden">
          <button
            type="button"
            aria-label="도움 닫기"
            onClick={closeTextSupport}
            className="fixed inset-0 z-40 bg-zinc-950/20"
          />
          <div className="fixed inset-x-0 bottom-0 z-50">
            <AnchoredSupportSurface
              selection={activeSupportSelection}
              unit={activeSupportUnit}
              mode={mode}
              onClose={closeTextSupport}
              surface="sheet"
            />
          </div>
        </div>
      )}
    </div>
  )
}
