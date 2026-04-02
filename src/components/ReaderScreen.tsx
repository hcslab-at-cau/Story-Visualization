"use client"

/**
 * FINAL.3 — Reader Screen
 * Merges FINAL.1 (SceneReaderPackageLog) + FINAL.2 (OverlayRefinementResult, optional)
 * and renders the clean reader UI.
 */

import { useState } from "react"
import type {
  SceneReaderPackageLog,
  OverlayRefinementResult,
  SceneReaderPacket,
  OverlayCharacter,
  OverlayRefinementCharacter,
} from "@/types/schema"

const CONF_THRESHOLD = 0.5

// ---------------------------------------------------------------------------
// Merged overlay character
// ---------------------------------------------------------------------------

function buildMergedOverlay(
  packet: SceneReaderPacket,
  refinementScene?: OverlayRefinementResult["scenes"][0],
): Array<{ coarse: OverlayCharacter; refined?: OverlayRefinementCharacter }> {
  const refinementMap = new Map(
    refinementScene?.characters.map((c) => [c.character_id, c]) ?? [],
  )
  const result: Array<{ coarse: OverlayCharacter; refined?: OverlayRefinementCharacter }> = []

  for (const char of packet.visual.overlay_characters) {
    const refined = refinementMap.get(char.character_id)
    if (refined?.visibility === "not_visible" && refined.confidence >= CONF_THRESHOLD) {
      continue // removed by FINAL.2
    }
    result.push({ coarse: char, refined })
  }

  return result
}

// ---------------------------------------------------------------------------
// Character Popover
// ---------------------------------------------------------------------------

function CharacterButton({
  coarse,
  refined,
  activeSubsceneId,
  characterPanels,
}: {
  coarse: OverlayCharacter
  refined?: OverlayRefinementCharacter
  activeSubsceneId: string
  characterPanels: Record<string, Record<string, string>>
}) {
  const [open, setOpen] = useState(false)
  const ax = refined?.anchor_x ?? coarse.anchor_x
  const ay = refined?.anchor_y ?? coarse.anchor_y

  const panelText = characterPanels[coarse.panel_key]?.[activeSubsceneId]

  return (
    <div
      className="absolute"
      style={{ left: `${ax}%`, top: `${ay}%`, transform: "translate(-50%, -100%)" }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="px-2 py-0.5 bg-black/60 text-white text-xs rounded-full hover:bg-black/80 transition-colors"
      >
        {coarse.label}
      </button>
      {open && (
        <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 w-56 bg-white rounded-lg shadow-lg border border-zinc-200 p-3 text-xs text-zinc-700 z-10">
          {panelText ?? "(현재 서브씬에 대한 정보 없음)"}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface Props {
  final1: SceneReaderPackageLog
  final2?: OverlayRefinementResult
}

export default function ReaderScreen({ final1, final2 }: Props) {
  const [sceneIdx, setSceneIdx] = useState(0)
  const [subsceneIdx, setSubsceneIdx] = useState(0)
  const [activePanel, setActivePanel] = useState<string | null>(null)

  const packet = final1.packets[sceneIdx]
  if (!packet) return <div className="p-8 text-zinc-400">No scenes available.</div>

  const refinementScene = final2?.scenes.find((s) => s.scene_id === packet.scene_id)
  const mergedOverlay = buildMergedOverlay(packet, refinementScene)

  const subscene = packet.subscene_nav[subsceneIdx]
  const activeSubsceneId = subscene?.subscene_id ?? packet.default_active_subscene_id
  const subsceneView = packet.subscene_views[activeSubsceneId]

  return (
    <div className="flex flex-col gap-4 p-6 max-w-6xl mx-auto">
      {/* Scene selector */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-zinc-600">Scene</label>
        <select
          value={sceneIdx}
          onChange={(e) => { setSceneIdx(Number(e.target.value)); setSubsceneIdx(0) }}
          className="border border-zinc-200 rounded-lg px-3 py-1.5 text-sm bg-white"
        >
          {final1.packets.map((p, i) => (
            <option key={p.scene_id} value={i}>
              {p.scene_title || p.scene_id}
            </option>
          ))}
        </select>
      </div>

      {/* Scene title + summary */}
      <div>
        <h2 className="text-xl font-semibold text-zinc-900">{packet.scene_title || packet.scene_id}</h2>
        <p className="text-sm text-zinc-500 mt-1">{packet.scene_summary}</p>
      </div>

      {/* Main 2-column layout */}
      <div className="flex gap-6">
        {/* Left: subscene navigation + body text */}
        <div className="flex-[1.2] flex flex-col gap-4">
          {/* Subscene nav */}
          {packet.subscene_nav.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-xs text-zinc-400 font-medium uppercase tracking-wide">
                {subsceneIdx + 1} / {packet.subscene_nav.length} · {subscene?.label}
              </p>
              <p className="text-sm font-medium text-zinc-700">{subscene?.headline}</p>

              {/* Dot indicators */}
              <div className="flex gap-1.5 mt-1">
                {packet.subscene_nav.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setSubsceneIdx(i)}
                    className={`w-2 h-2 rounded-full transition-colors ${i === subsceneIdx ? "bg-zinc-700" : "bg-zinc-300"}`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Body paragraphs */}
          <div className="flex flex-col gap-3 text-sm leading-7 text-zinc-700">
            {(subscene?.body_paragraphs ?? packet.body_paragraphs).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>

          {/* Prev / Next buttons */}
          {packet.subscene_nav.length > 1 && (
            <div className="flex gap-2">
              <button
                onClick={() => setSubsceneIdx((i) => Math.max(0, i - 1))}
                disabled={subsceneIdx === 0}
                className="px-3 py-1.5 text-sm border border-zinc-200 rounded-lg disabled:opacity-30 hover:bg-zinc-50"
              >
                ←
              </button>
              <button
                onClick={() => setSubsceneIdx((i) => Math.min(packet.subscene_nav.length - 1, i + 1))}
                disabled={subsceneIdx === packet.subscene_nav.length - 1}
                className="px-3 py-1.5 text-sm border border-zinc-200 rounded-lg disabled:opacity-30 hover:bg-zinc-50"
              >
                →
              </button>
            </div>
          )}
        </div>

        {/* Right: visual block + subscene detail */}
        <div className="flex-1 flex flex-col gap-4">
          {/* Chips */}
          {packet.visual.chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {packet.visual.chips.map((chip, i) => (
                <span key={i} className="px-2 py-0.5 bg-zinc-100 text-zinc-600 text-xs rounded-full">
                  {chip}
                </span>
              ))}
            </div>
          )}

          {/* Visual block placeholder + character overlays */}
          <div className="relative bg-zinc-200 rounded-xl overflow-hidden aspect-video">
            {packet.visual.image_path ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={packet.visual.image_path} alt="scene" className="w-full h-full object-cover" />
            ) : (
              <div className="flex items-center justify-center h-full text-zinc-400 text-sm">
                {packet.visual.fallback_blueprint_available ? "Blueprint available" : "No image"}
              </div>
            )}

            {/* Character overlay buttons */}
            {mergedOverlay.map(({ coarse, refined }) => (
              <CharacterButton
                key={coarse.character_id}
                coarse={coarse}
                refined={refined}
                activeSubsceneId={activeSubsceneId}
                characterPanels={packet.character_panels}
              />
            ))}
          </div>

          {/* Subscene headline + buttons */}
          {subsceneView && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-zinc-700">{subsceneView.headline}</p>
              <div className="flex flex-wrap gap-1.5">
                {subsceneView.buttons.map((btn) => (
                  <button
                    key={btn.key}
                    onClick={() => setActivePanel(activePanel === btn.key ? null : btn.key)}
                    className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                      activePanel === btn.key
                        ? "bg-zinc-800 text-white border-zinc-800"
                        : "border-zinc-300 text-zinc-600 hover:border-zinc-500"
                    }`}
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
              {activePanel && subsceneView.panels[activePanel] && (
                <div className="text-xs text-zinc-600 leading-6 bg-zinc-50 rounded-lg p-3 border border-zinc-200">
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
