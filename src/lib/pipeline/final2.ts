/**
 * FINAL.2 — Overlay Refinement (Vision API)
 * Port of Story-Decomposition/src/viewer/overlay_refinement.py
 */

import type {
  SceneReaderPackageLog,
  OverlayRefinementResult,
  OverlayRefinementScene,
  OverlayRefinementCharacter,
  OverlayVisibility,
  OverlaySource,
} from "@/types/schema"
import type { LLMClient } from "@/lib/llm-client"
import { formatJsonParam } from "@/lib/prompt-loader"
import fs from "fs"

const MIN_REFINEMENT_CONFIDENCE = 0.45

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

function normalizeResult(
  packet: SceneReaderPackageLog["packets"][0],
  rawResult: Record<string, unknown> | null,
  imageAvailable: boolean,
): OverlayRefinementScene {
  const characters: OverlayRefinementCharacter[] = []
  const rawChars = (rawResult?.characters as Array<Record<string, unknown>>) ?? []

  const byId = new Map(rawChars.map((c) => [c.character_id as string, c]))
  const byLabel = new Map(rawChars.map((c) => [(c.label as string)?.toLowerCase(), c]))

  for (const coarse of packet.visual.overlay_characters) {
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
    scene_id: packet.scene_id,
    image_available: imageAvailable,
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

    const imagePath = imagePaths?.get(packet.scene_id)
    const imageAvailable = Boolean(imagePath && fs.existsSync(imagePath))

    let rawResult: Record<string, unknown> | null = null

    if (useVision && imageAvailable && packet.visual.overlay_characters.length > 0 && imagePath) {
      try {
        const imageBuffer = fs.readFileSync(imagePath)
        const dataUrl = `data:image/png;base64,${imageBuffer.toString("base64")}`

        rawResult = await llmClient!.refineOverlay({
          scene_id: packet.scene_id,
          scene_title: packet.scene_title,
          scene_summary: packet.scene_summary,
          visual_mode: packet.visual.mode,
          chips_json: formatJsonParam(packet.visual.chips),
          overlay_candidates_json: formatJsonParam(
            packet.visual.overlay_characters.map((ch) => ({
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
          imageDataUrl: dataUrl,
        })
      } catch {
        rawResult = null
      }
    }

    scenes.push(normalizeResult(packet, rawResult, imageAvailable))
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
