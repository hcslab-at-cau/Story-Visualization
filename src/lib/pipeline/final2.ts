/**
 * FINAL.2 — Overlay Refinement (Vision API)
 * Port of Story-Decomposition/src/viewer/overlay_refinement.py
 */

import type {
  SceneReaderPackageLog,
  OverlayRefinementResult,
  OverlayRefinementScene,
  OverlayRefinementSubscene,
  OverlayRefinementCharacter,
  OverlayVisibility,
  OverlaySource,
} from "@/types/schema"
import type { LLMClient } from "@/lib/llm-client"
import { formatJsonParam } from "@/lib/prompt-loader"
import fs from "fs"

const MIN_REFINEMENT_CONFIDENCE = 0.45

async function loadImageDataUrl(imageSource: string): Promise<string> {
  if (imageSource.startsWith("data:image/")) {
    return imageSource
  }

  if (/^https?:\/\//i.test(imageSource)) {
    const response = await fetch(imageSource)
    if (!response.ok) {
      throw new Error(`Failed to fetch scene image: HTTP ${response.status}`)
    }
    const contentType = response.headers.get("content-type") || "image/png"
    const buffer = Buffer.from(await response.arrayBuffer())
    return `data:${contentType};base64,${buffer.toString("base64")}`
  }

  if (!fs.existsSync(imageSource)) {
    throw new Error("Scene image path does not exist")
  }

  const imageBuffer = fs.readFileSync(imageSource)
  return `data:image/png;base64,${imageBuffer.toString("base64")}`
}

// ---------------------------------------------------------------------------
// Fallback character result
// ---------------------------------------------------------------------------

function coarseCharacterResult(
  coarse: SceneReaderPackageLog["packets"][0]["visual"]["overlay_characters"][0],
  reason: string,
  visibility: OverlayVisibility,
  confidence = 0.0,
): OverlayRefinementCharacter {
  return {
    character_id: coarse.character_id,
    label: coarse.label,
    visibility,
    anchor_x: coarse.anchor_x,
    anchor_y: coarse.anchor_y,
    confidence,
    source: "coarse_fallback",
    reason,
  }
}

// ---------------------------------------------------------------------------
// Normalize raw Vision API result
// ---------------------------------------------------------------------------

function normalizeSubsceneResult(
  subscene: SceneReaderPackageLog["packets"][0]["subscene_nav"][0],
  view: SceneReaderPackageLog["packets"][0]["subscene_views"][string] | undefined,
  rawResult: Record<string, unknown> | null,
  imageAvailable: boolean,
): OverlayRefinementSubscene {
  const characters: OverlayRefinementCharacter[] = []
  const rawChars = (rawResult?.characters as Array<Record<string, unknown>>) ?? []
  const coarseCharacters = view?.overlay_characters ?? []

  const byId = new Map(rawChars.map((c) => [c.character_id as string, c]))
  const byLabel = new Map(rawChars.map((c) => [(c.label as string)?.toLowerCase(), c]))

  for (const coarse of coarseCharacters) {
    const raw = byId.get(coarse.character_id) ?? byLabel.get(coarse.label.toLowerCase())

    if (!raw) {
      characters.push(coarseCharacterResult(coarse, "result missing", "fallback"))
      continue
    }

    const confidence = (raw.confidence as number) ?? 0.0
    const source = (raw.source as OverlaySource) ?? "coarse_fallback"
    const anchorX = raw.anchor_x as number | undefined
    const anchorY = raw.anchor_y as number | undefined

    const accepted =
      anchorX !== undefined &&
      anchorY !== undefined &&
      confidence >= MIN_REFINEMENT_CONFIDENCE &&
      source !== "coarse_fallback"

    if (accepted) {
      const bbox = raw.bbox_norm as { x: number; y: number; w: number; h: number } | undefined
      characters.push({
        character_id: coarse.character_id,
        label: coarse.label,
        visibility: (raw.visibility as OverlayVisibility) ?? "placed",
        bbox_norm: bbox,
        anchor_x: anchorX!,
        anchor_y: anchorY!,
        confidence,
        source,
        reason: (raw.reason as string) ?? "",
      })
    } else {
      const fallbackVis: OverlayVisibility =
        confidence >= 0.2 && imageAvailable ? "approximate" : "fallback"
      characters.push(coarseCharacterResult(coarse, (raw.reason as string) ?? "low confidence", fallbackVis, confidence))
    }
  }

  return {
    subscene_id: subscene.subscene_id,
    label: subscene.label,
    headline: view?.headline || subscene.headline,
    characters,
  }
}

// ---------------------------------------------------------------------------
// Blueprint summary helper
// ---------------------------------------------------------------------------

function blueprintSummary(
  sceneId: string,
  blueprintLog?: { packets: Array<{ scene_id: string; key_moment?: string; setting?: unknown }> },
): string {
  if (!blueprintLog) return ""
  const packet = blueprintLog.packets.find((p) => p.scene_id === sceneId)
  if (!packet) return ""
  return JSON.stringify({ key_moment: packet.key_moment, setting: packet.setting }, null, 2)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runOverlayRefinement(
  sceneReaderLog: SceneReaderPackageLog,
  docId: string,
  chapterId: string,
  parents: Record<string, string> = {},
  llmClient?: LLMClient,
  blueprintLog?: { packets: Array<{ scene_id: string; key_moment?: string; setting?: unknown }> },
  imagePaths?: Map<string, string>, // scene_id → absolute file path
  onProgress?: (msg: string) => void,
): Promise<OverlayRefinementResult> {
  const useVision = llmClient !== undefined
  const scenes: OverlayRefinementScene[] = []

  for (const packet of sceneReaderLog.packets) {
    onProgress?.(`FINAL.2: refining overlay for ${packet.scene_id}...`)

    const imageSource = imagePaths?.get(packet.scene_id) ?? packet.visual.image_path
    const imageAvailable = Boolean(imageSource)
    let dataUrl: string | null = null
    if (useVision && imageAvailable && imageSource) {
      try {
        dataUrl = await loadImageDataUrl(imageSource)
      } catch {
        dataUrl = null
      }
    }

    const subscenes: OverlayRefinementSubscene[] = []
    for (const subscene of packet.subscene_nav) {
      const view = packet.subscene_views[subscene.subscene_id]
      const candidates = view?.overlay_characters ?? []
      let rawResult: Record<string, unknown> | null = null

      if (useVision && imageAvailable && dataUrl && candidates.length > 0) {
        try {
          rawResult = await llmClient!.refineOverlay({
            scene_id: packet.scene_id,
            scene_title: packet.scene_title,
            scene_summary: packet.scene_summary,
            visual_mode: packet.visual.mode,
            chips_json: formatJsonParam(packet.visual.chips),
            subscene_id: subscene.subscene_id,
            subscene_label: subscene.label,
            subscene_headline: view?.headline || subscene.headline,
            overlay_candidates_json: formatJsonParam(
              candidates.map((ch) => ({
                character_id: ch.character_id,
                label: ch.label,
                anchor_zone: ch.anchor_zone,
                anchor_x: ch.anchor_x,
                anchor_y: ch.anchor_y,
                anchor_method: ch.anchor_method,
              })),
            ),
            blueprint_summary: blueprintSummary(packet.scene_id, blueprintLog),
            scene_body_text: packet.body_paragraphs.join("\n\n"),
            subscene_body_text: subscene.body_paragraphs.join("\n\n"),
            imageDataUrl: dataUrl,
          })
        } catch {
          rawResult = null
        }
      }

      subscenes.push(normalizeSubsceneResult(subscene, view, rawResult, imageAvailable))
    }

    scenes.push({
      scene_id: packet.scene_id,
      image_path: packet.visual.image_path,
      image_available: imageAvailable,
      default_active_subscene_id: packet.default_active_subscene_id,
      subscenes,
    })
  }

  const runId = `overlay_refinement__${docId}__${chapterId}`
  return {
    run_id: runId,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: "FINAL.2",
    method: useVision ? "vision+fallback" : "fallback_only",
    parents,
    scenes,
  } as OverlayRefinementResult
}
