"use client"

/**
 * FINAL.3 - Reader Screen
 * Merges FINAL.1 (SceneReaderPackageLog) + FINAL.2 (OverlayRefinementResult, optional)
 * and renders the clean reader UI.
 */

import { useEffect, useRef, useState } from "react"
import type {
  SceneReaderPackageLog,
  OverlayRefinementResult,
  SceneReaderPacket,
  OverlayCharacter,
  OverlayRefinementCharacter,
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
}

const READER_PANEL_BUTTON_LABEL: Record<string, string> = {
  goal: "Goal",
  problem: "Problem",
  what_changed: "Change",
  why_it_matters: "Impact",
  object: "Object",
}

const READER_PANEL_BUTTON_ORDER = [
  "goal",
  "problem",
  "what_changed",
  "why_it_matters",
  "object",
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

function CharacterButton({
  coarse,
  activeSubsceneId,
  characterPanels,
  left,
  top,
}: {
  coarse: OverlayCharacter
  activeSubsceneId: string
  characterPanels: Record<string, Record<string, string>>
  left: number
  top: number
}) {
  const [open, setOpen] = useState(false)
  const panelText = characterPanels[coarse.panel_key]?.[activeSubsceneId]
  const initial = coarse.label.trim().charAt(0).toUpperCase() || "C"

  return (
    <div
      className="absolute"
      style={{ left, top, transform: "translate(-50%, -94%)" }}
    >
      <button
        onClick={() => setOpen((value) => !value)}
        className="flex flex-col items-center gap-1.5 rounded-2xl bg-white/88 px-2.5 py-2 shadow-md ring-1 ring-zinc-200 backdrop-blur-sm transition-transform hover:-translate-y-0.5 hover:bg-white"
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-b from-sky-500 to-blue-700 text-sm font-semibold text-white shadow-sm ring-2 ring-white">
          {initial}
        </span>
        <span className="rounded-full bg-zinc-900 px-2.5 py-0.5 text-[11px] font-medium leading-none text-white">
          {coarse.label}
        </span>
      </button>
      {open && (
        <div className="absolute bottom-full left-1/2 z-10 mb-2 w-64 -translate-x-1/2 rounded-xl border border-zinc-200 bg-white p-3 text-sm leading-6 text-zinc-700 shadow-xl">
          {panelText ?? "(No subscene note available.)"}
        </div>
      )}
    </div>
  )
}

interface Props {
  final1: SceneReaderPackageLog
  final2?: OverlayRefinementResult
}

export default function ReaderScreen({ final1, final2 }: Props) {
  const [sceneIdx, setSceneIdx] = useState(0)
  const [subsceneIdx, setSubsceneIdx] = useState(0)
  const [activePanel, setActivePanel] = useState<string | null>(null)
  const imageFrameRef = useRef<HTMLDivElement | null>(null)
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
  const activeImageKey = packet?.visual.image_path ? `${packet.scene_id}:${packet.visual.image_path}` : ""
  const metricsForActiveImage =
    imageMetrics.imageKey === activeImageKey
      ? imageMetrics
      : {
          ...imageMetrics,
          naturalWidth: 0,
          naturalHeight: 0,
        }
  const containedRect = getContainedImageRect(metricsForActiveImage)

  const hasPrev = sceneIdx > 0 || subsceneIdx > 0
  const hasNext =
    sceneIdx < final1.packets.length - 1 || subsceneIdx < (packet?.subscene_nav.length ?? 0) - 1

  function selectScene(nextSceneIdx: number, nextSubsceneIdx = 0) {
    setSceneIdx(nextSceneIdx)
    setSubsceneIdx(nextSubsceneIdx)
    setActivePanel(null)
  }

  function goPrev() {
    if (subsceneIdx > 0) {
      setSubsceneIdx((index) => index - 1)
      setActivePanel(null)
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
      setSubsceneIdx((index) => index + 1)
      setActivePanel(null)
      return
    }

    if (sceneIdx < final1.packets.length - 1) {
      selectScene(sceneIdx + 1, 0)
    }
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

  if (!packet) return <div className="p-8 text-zinc-400">No scenes available.</div>

  return (
    <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-5 p-6">
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-zinc-600">Scene</label>
        <select
          value={sceneIdx}
          onChange={(event) => selectScene(Number(event.target.value), 0)}
          className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm"
        >
          {final1.packets.map((scenePacket, index) => (
            <option key={scenePacket.scene_id} value={index}>
              {scenePacket.scene_title || scenePacket.scene_id}
            </option>
          ))}
        </select>
      </div>

      <div>
        <h2 className="text-2xl font-semibold text-zinc-900">{packet.scene_title || packet.scene_id}</h2>
        <p className="mt-1 text-[15px] leading-7 text-zinc-500">{packet.scene_summary}</p>
      </div>

      <div className="grid gap-7 xl:grid-cols-[minmax(0,1.18fr)_minmax(720px,1.08fr)] 2xl:grid-cols-[minmax(0,1.24fr)_minmax(820px,1.14fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          {packet.subscene_nav.length > 0 && (
            <div className="flex flex-col gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                {subsceneIdx + 1} / {packet.subscene_nav.length} · {subscene?.label}
              </p>
              <p className="text-base font-medium text-zinc-700">{subscene?.headline}</p>

              <div className="mt-1 flex gap-1.5">
                {packet.subscene_nav.map((_, index) => (
                  <button
                    key={index}
                    onClick={() => {
                      setSubsceneIdx(index)
                      setActivePanel(null)
                    }}
                    className={`h-2 w-2 rounded-full transition-colors ${
                      index === subsceneIdx ? "bg-zinc-700" : "bg-zinc-300"
                    }`}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white px-6 py-5 text-[16px] leading-8 text-zinc-700 shadow-sm">
            {(subscene?.body_paragraphs ?? packet.body_paragraphs).map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>

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

        <div className="flex min-w-0 flex-col gap-5">
          <div className="relative min-h-[700px] overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100 shadow-sm 2xl:min-h-[820px]">
            {packet.visual.image_path ? (
              <div ref={imageFrameRef} className="relative h-full w-full p-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  key={`${packet.scene_id}:${packet.visual.image_path}`}
                  src={packet.visual.image_path}
                  alt="scene"
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
                      activeSubsceneId={activeSubsceneId}
                      characterPanels={packet.character_panels}
                      left={left}
                      top={top}
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
            <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
              <p className="text-base font-medium text-zinc-700">{subsceneView.headline}</p>
              <div className="flex flex-wrap gap-1.5">
                {READER_PANEL_BUTTON_ORDER.map((buttonKey) => {
                  const button = subsceneView.buttons.find((item) => item.key === buttonKey)
                  const enabled = Boolean(subsceneView.panels[buttonKey])
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
              {activePanel && subsceneView.panels[activePanel] && (
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm leading-7 text-zinc-600">
                  {subsceneView.panels[activePanel]}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
