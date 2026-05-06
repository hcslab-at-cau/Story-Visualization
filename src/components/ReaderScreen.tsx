"use client"

/**
 * FINAL.3 - Reader Screen
 * Merges FINAL.1 (SceneReaderPackageLog) + FINAL.2 (OverlayRefinementResult, optional)
 * and renders the clean reader UI.
 */

import { useEffect, useRef, useState, type ReactNode } from "react"
import type {
  CompactHint,
  OverlayCharacter,
  OverlayRefinementCharacter,
  OverlayRefinementResult,
  ReaderCharacterView,
  ReaderGlobalView,
  ReaderPairView,
  SceneReaderPackageLog,
  SceneReaderPacket,
  SupportUnit,
} from "@/types/schema"

const CONF_THRESHOLD = 0.5

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

const READER_PANEL_BUTTON_LABEL: Record<string, string> = {
  goal: "Goal",
  problem: "Problem",
  what_changed: "Change",
  why_it_matters: "Impact",
  object: "Object",
  action: "Action",
  event: "Event",
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

const SUPPORT_KIND_LABEL: Record<string, string> = {
  snapshot: "Now",
  boundary_delta: "Shift",
  causal_bridge: "Why",
  character_focus: "Cast",
  relation_delta: "Relation",
  reentry_recap: "Resume",
  reference_repair: "Names",
  spatial_continuity: "Place",
  visual_context: "Cues",
}

function SupportUnitCard({
  unit,
  compact = false,
}: {
  unit: SupportUnit
  compact?: boolean
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-semibold text-zinc-600">
          {SUPPORT_KIND_LABEL[unit.kind] ?? unit.label}
        </span>
        <span className="text-[11px] text-zinc-400">
          {Math.round(unit.priority * 100)}
        </span>
      </div>
      <h4 className={`mt-3 font-semibold text-zinc-900 ${compact ? "text-sm" : "text-base"}`}>
        {unit.title}
      </h4>
      <p className={`${compact ? "mt-1 text-sm leading-6" : "mt-2 text-[15px] leading-7"} text-zinc-600`}>
        {unit.body}
      </p>
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
}): ReaderFocusContext {
  const view = params.packet.subscene_views[params.activeSubsceneId]
  const headline = view?.headline || "Reader support"

  if (!view) {
    return {
      mode: "global",
      title: headline,
      subtitle: "Subscene",
      summary: "No subscene support available.",
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
      title: labels.join(" + ") || "Selected pair",
      subtitle: "Relation view",
      summary: "No pair-specific hint was prepared for this combination.",
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
    summary_hint: view.headline || "Subscene overview.",
    hints: [],
    buttons: view.buttons ?? [],
    panels: view.panels ?? {},
  }
  return {
    mode: "global",
    title: headline,
    subtitle: "Subscene overview",
    summary: globalView.summary_hint,
    hints: globalView.hints,
    buttons: globalView.buttons,
    panels: globalView.panels,
  }
}

interface Props {
  final1: SceneReaderPackageLog
  final2?: OverlayRefinementResult
  topControls?: ReactNode
}

export default function ReaderScreen({ final1, final2, topControls }: Props) {
  const [sceneIdx, setSceneIdx] = useState(0)
  const [subsceneIdx, setSubsceneIdx] = useState(0)
  const [activePanel, setActivePanel] = useState<string | null>(null)
  const [showSceneSummary, setShowSceneSummary] = useState(false)
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>([])
  const imageFrameRef = useRef<HTMLDivElement | null>(null)
  const preloadedImageUrlsRef = useRef<Set<string>>(new Set())
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
  const subsceneView = packet?.subscene_views[activeSubsceneId]
  const mergedOverlay = packet ? buildMergedOverlay(packet, activeSubsceneId, refinementScene) : []
  const availableCharacterIds = new Set(mergedOverlay.map(({ coarse }) => coarse.character_id))
  const resolvedSelectedCharacterIds = selectedCharacterIds.filter((id) => availableCharacterIds.has(id)).slice(0, 2)
  const focusContext = resolveFocusContext({
    packet,
    activeSubsceneId,
    selectedCharacterIds: resolvedSelectedCharacterIds,
  })
  const supportBeforeText = packet.support?.display_slots.before_text ?? []
  const supportBesideVisual = packet.support?.display_slots.beside_visual ?? []
  const supportOnDemand = packet.support?.display_slots.on_demand ?? []

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
    resetFocusState()
  }

  function selectSubscene(nextSubsceneIdx: number) {
    setSubsceneIdx(nextSubsceneIdx)
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

  if (!packet) return <div className="p-8 text-zinc-400">No scenes available.</div>

  return (
    <div className="mx-auto flex w-full max-w-[2080px] flex-col gap-5 p-6">
      <div className="flex flex-wrap items-center gap-3">
        {topControls}
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-zinc-600">Scene</label>
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
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowSceneSummary((value) => !value)}
              className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50"
            >
              {showSceneSummary ? "Hide Summary" : "Show Summary"}
            </button>
          </div>
          {showSceneSummary && (
            <div className="mt-3 max-w-3xl rounded-xl border border-zinc-200 bg-white px-4 py-3 text-[15px] leading-7 text-zinc-600 shadow-sm">
              <p>{packet.scene_summary}</p>
              {subscene?.headline && (
                <div className="mt-3 border-t border-zinc-200 pt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Subscene
                  </p>
                  <p className="mt-1 text-zinc-700">{subscene.headline}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-7 xl:grid-cols-[minmax(0,1.12fr)_minmax(740px,1.14fr)] 2xl:grid-cols-[minmax(0,1.16fr)_minmax(860px,1.18fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          {packet.subscene_nav.length > 0 && (
            <div className="flex flex-col gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                {subsceneIdx + 1} / {packet.subscene_nav.length} · {subscene?.label}
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
            <div className="grid gap-3 md:grid-cols-2">
              {supportBeforeText.map((unit) => (
                <SupportUnitCard key={unit.unit_id} unit={unit} />
              ))}
            </div>
          )}

          <div className="flex flex-col gap-5 rounded-2xl border border-zinc-200 bg-white px-7 py-6 text-[17px] leading-9 text-zinc-700 shadow-sm xl:text-[18px]">
            {(subscene?.body_paragraphs ?? packet.body_paragraphs).map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>

          {supportOnDemand.length > 0 && (
            <details className="rounded-xl border border-zinc-200 bg-white">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-zinc-700">
                More reading support ({supportOnDemand.length})
              </summary>
              <div className="grid gap-3 border-t border-zinc-200 bg-zinc-50 p-4 md:grid-cols-2">
                {supportOnDemand.map((unit) => (
                  <SupportUnitCard key={unit.unit_id} unit={unit} compact />
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
                Prev
              </button>
              <button
                onClick={goNext}
                disabled={!hasNext}
                className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm disabled:opacity-30 hover:bg-zinc-50"
              >
                Next
              </button>
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-5 xl:sticky xl:top-6 xl:max-h-[calc(100vh-9rem)] xl:self-start xl:overflow-y-auto xl:pr-2">
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
                {packet.visual.fallback_blueprint_available ? "Blueprint available" : "No image"}
              </div>
            )}
          </div>

          {subsceneView && (
            <div className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  {focusContext.mode === "global"
                    ? "Subscene View"
                    : focusContext.mode === "character"
                      ? "Character View"
                      : "Pair View"}
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
                      className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3"
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
                      <span>{READER_PANEL_BUTTON_LABEL[buttonKey] ?? button?.label ?? buttonKey}</span>
                    </button>
                  )
                })}
              </div>

              {activePanel && focusContext.panels[activePanel] && (
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm leading-7 text-zinc-600">
                  {focusContext.panels[activePanel]}
                </div>
              )}
            </div>
          )}

          {supportBesideVisual.length > 0 && (
            <div className="grid gap-3">
              {supportBesideVisual.map((unit) => (
                <SupportUnitCard key={unit.unit_id} unit={unit} compact />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
