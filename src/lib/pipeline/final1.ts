/**
 * FINAL.1 — Scene Reader Package Builder (fully rule-based)
 * Port of Story-Decomposition/src/viewer/scene_reader_package.py
 */

import type {
  GroundedSceneModel,
  RenderedImages,
  ScenePackets,
  SceneBoundaries,
  ValidatedSubscenes,
  InterventionPackages,
  RawChapter,
  SceneReaderPackageLog,
  SceneReaderPacket,
  VisualBlock,
  OverlayCharacter,
  SubsceneNavItem,
  SubsceneView,
  SubsceneButton,
} from "@/types/schema"

// ---------------------------------------------------------------------------
// Zone → anchor position table
// ---------------------------------------------------------------------------

const ZONE_ANCHOR: Record<string, [number, number]> = {
  "foreground left":   [15.0, 78.0],
  "foreground center": [50.0, 78.0],
  "foreground right":  [85.0, 78.0],
  "midground left":    [15.0, 52.0],
  "midground center":  [50.0, 52.0],
  "midground right":   [85.0, 52.0],
  "background left":   [15.0, 26.0],
  "background center": [50.0, 26.0],
  "background right":  [85.0, 26.0],
}

function resolveAnchor(compositionPosition?: string): [number, number, string] {
  if (!compositionPosition) return [50.0, 52.0, "midground center"]
  const pos = compositionPosition.toLowerCase().trim()
  const coords = ZONE_ANCHOR[pos]
  if (coords) return [coords[0], coords[1], pos]
  return [50.0, 52.0, "midground center"]
}

// ---------------------------------------------------------------------------
// Build chips
// ---------------------------------------------------------------------------

function buildChips(
  sceneId: string,
  groundedLog: GroundedSceneModel,
  // vis1Log not used in this implementation (excluded per migration scope)
): string[] {
  const entry = groundedLog.validated.find((e) => e.scene_id === sceneId)
  if (!entry) return []
  const sceneIndex = entry.validated_scene_index as Record<string, unknown>
  const chips: string[] = []

  const env = (sceneIndex.environment as Array<Record<string, unknown>>) ?? []
  for (const e of env.slice(0, 4)) {
    if (typeof e.label === "string") chips.push(e.label)
    if (chips.length >= 4) break
  }

  const scenePlace = sceneIndex.scene_place as Record<string, unknown> | undefined
  if (scenePlace?.actual_place && typeof scenePlace.actual_place === "string" && chips.length < 4) {
    chips.push(scenePlace.actual_place)
  }

  return chips.slice(0, 4)
}

// ---------------------------------------------------------------------------
// Build overlay characters
// ---------------------------------------------------------------------------

interface BlueprintLike {
  packets: Array<{
    scene_id: string
    characters: Array<{
      name: string
      composition_position?: string
    }>
  }>
}

interface RenderedImagesLike {
  results: RenderedImages["results"]
}

function buildOverlayCharacters(
  sceneId: string,
  blueprintLog: BlueprintLike | undefined,
  groundedLog: GroundedSceneModel,
  packetLog: ScenePackets,
): OverlayCharacter[] {
  const seen = new Map<string, OverlayCharacter>()

  // Priority 1: VIS.2 blueprint characters (have composition_position)
  const blueprintPacket = blueprintLog?.packets.find((p) => p.scene_id === sceneId)
  if (blueprintPacket) {
    for (const ch of blueprintPacket.characters) {
      const [x, y, zone] = resolveAnchor(ch.composition_position)
      const entityId = `char_${ch.name.toLowerCase().replace(/\s+/g, "_")}`
      seen.set(ch.name, {
        character_id: entityId,
        label: ch.name,
        anchor_zone: zone,
        anchor_x: x,
        anchor_y: y,
        anchor_method: "zone_bucket",
        panel_key: `panel_${entityId}`,
      })
    }
  }

  // Priority 2: SCENE.3 onstage_cast
  const entry = groundedLog.validated.find((e) => e.scene_id === sceneId)
  if (entry) {
    const sceneIndex = entry.validated_scene_index as Record<string, unknown>
    const onstageCast = (sceneIndex.onstage_cast as Array<{ name: string }>) ?? []
    for (const cast of onstageCast) {
      if (!seen.has(cast.name)) {
        const entityId = `char_${cast.name.toLowerCase().replace(/\s+/g, "_")}`
        seen.set(cast.name, {
          character_id: entityId,
          label: cast.name,
          anchor_zone: "midground center",
          anchor_x: 50.0,
          anchor_y: 52.0,
          anchor_method: "zone_bucket",
          panel_key: `panel_${entityId}`,
        })
      }
    }
  }

  // Priority 3: SCENE.1 scene_cast_union
  const packet = packetLog.packets.find((p) => p.scene_id === sceneId)
  if (packet) {
    for (const label of packet.scene_cast_union) {
      if (!seen.has(label)) {
        const entityId = `char_${label.toLowerCase().replace(/\s+/g, "_")}`
        seen.set(label, {
          character_id: entityId,
          label,
          anchor_zone: "midground center",
          anchor_x: 50.0,
          anchor_y: 52.0,
          anchor_method: "zone_bucket",
          panel_key: `panel_${entityId}`,
        })
      }
    }
  }

  return [...seen.values()]
}

// ---------------------------------------------------------------------------
// Build subscene nav/views
// ---------------------------------------------------------------------------

const BUTTON_DEFS: Array<[string, string, string]> = [
  ["goal",          "local_goal",           "Goal"],
  ["problem",       "problem_state",        "Problem"],
  ["what_changed",  "causal_result",        "What changed"],
  ["why_it_matters","narrative_importance", "Why it matters"],
]

function buildSubsceneBlocks(
  sceneId: string,
  sub3Log: ValidatedSubscenes,
  pidText: Map<number, string>,
  overlayChars: OverlayCharacter[],
  characterPanels: Record<string, Record<string, string>>,
): { nav: SubsceneNavItem[]; views: Record<string, SubsceneView> } {
  const item = sub3Log.packets.find((p) => p.scene_id === sceneId)
  if (!item) return { nav: [], views: {} }

  const nav: SubsceneNavItem[] = []
  const views: Record<string, SubsceneView> = {}

  for (const sub of item.validated_subscenes) {
    const bodyParagraphs: string[] = []
    for (let pid = sub.start_pid; pid <= sub.end_pid; pid++) {
      const text = pidText.get(pid)
      if (text) bodyParagraphs.push(text)
    }

    nav.push({
      subscene_id: sub.subscene_id,
      label: sub.label,
      headline: sub.headline || sub.action_summary,
      body_paragraphs: bodyParagraphs,
    })

    const buttons: SubsceneButton[] = []
    const panels: Record<string, string> = {}

    for (const [key, fieldName, displayLabel] of BUTTON_DEFS) {
      const value = (sub as unknown as Record<string, unknown>)[fieldName] as string | undefined
      if (value?.trim()) {
        buttons.push({ key, label: displayLabel })
        panels[key] = value
      }
    }

    if (sub.key_objects.length > 0) {
      buttons.push({ key: "object", label: sub.key_objects[0].slice(0, 24) })
      panels["object"] = sub.key_objects.join(", ")
    }

    views[sub.subscene_id] = {
      headline: sub.headline,
      overlay_characters: overlayChars.filter((character) =>
        Boolean(characterPanels[character.panel_key]?.[sub.subscene_id]),
      ),
      buttons,
      panels,
    }
  }

  return { nav, views }
}

// ---------------------------------------------------------------------------
// Build character panels
// ---------------------------------------------------------------------------

function buildCharacterPanels(
  sceneId: string,
  overlayChars: OverlayCharacter[],
  interventionLog: InterventionPackages | undefined,
  sub3Log: ValidatedSubscenes,
): Record<string, Record<string, string>> {
  const panelParts = new Map<string, Map<string, string[]>>()

  for (const ch of overlayChars) {
    panelParts.set(ch.panel_key, new Map())
  }

  const labelToPanel = new Map(overlayChars.map((ch) => [ch.label.toLowerCase(), ch.panel_key]))

  // Priority 1: SUB.4 intervention packages
  if (interventionLog) {
    const interventionItem = interventionLog.packets.find((p) => p.scene_id === sceneId)
    if (interventionItem) {
      for (const unit of interventionItem.subscene_ui_units) {
        for (const castButton of unit.cast_buttons) {
          const panelKey = labelToPanel.get(castButton.name.toLowerCase())
          if (panelKey) {
            const map = panelParts.get(panelKey) ?? new Map()
            const existing = map.get(unit.subscene_id) ?? []
            existing.push(`[${unit.title}] ${castButton.role}: ${castButton.reveal}`)
            map.set(unit.subscene_id, existing)
            panelParts.set(panelKey, map)
          }
        }
      }
    }
  }

  // Priority 2: SUB.3 fallback
  const sub3Item = sub3Log.packets.find((p) => p.scene_id === sceneId)
  if (sub3Item) {
    for (const sub of sub3Item.validated_subscenes) {
      for (const castName of sub.active_cast) {
        const panelKey = labelToPanel.get(castName.toLowerCase())
        if (!panelKey) continue
        const map = panelParts.get(panelKey) ?? new Map()
        if (!map.has(sub.subscene_id)) {
          const bits = [
            `[${sub.label}]`,
            sub.action_summary,
            sub.local_goal ? `Goal: ${sub.local_goal}` : "",
            sub.problem_state ? `Problem: ${sub.problem_state}` : "",
          ].filter(Boolean)
          map.set(sub.subscene_id, [bits.join(" ")])
          panelParts.set(panelKey, map)
        }
      }
    }
  }

  // Convert to final shape
  const result: Record<string, Record<string, string>> = {}
  for (const [panelKey, subMap] of panelParts) {
    result[panelKey] = {}
    for (const [subsceneId, parts] of subMap) {
      result[panelKey][subsceneId] = parts.join("\n\n")
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function runSceneReaderPackage(
  groundedLog: GroundedSceneModel,
  sub3Log: ValidatedSubscenes,
  packetLog: ScenePackets,
  boundaryLog: SceneBoundaries,
  chapter: RawChapter,
  docId: string,
  chapterId: string,
  parents: Record<string, string> = {},
  blueprintLog?: BlueprintLike,
  interventionLog?: InterventionPackages,
  renderedImagesLog?: RenderedImagesLike,
): SceneReaderPackageLog {
  const pidText = new Map(chapter.paragraphs.map((p) => [p.pid, p.text]))
  const scenePidRange = new Map(
    boundaryLog.scenes.map((s) => [s.scene_id, [s.start_pid, s.end_pid] as [number, number]]),
  )

  const packets: SceneReaderPacket[] = []

  for (const entry of groundedLog.validated) {
    const sceneId = entry.scene_id
    const sceneIndex = entry.validated_scene_index as Record<string, unknown>

    const chips = buildChips(sceneId, groundedLog)
    const overlayCharacters = buildOverlayCharacters(sceneId, blueprintLog, groundedLog, packetLog)
    const characterPanels = buildCharacterPanels(sceneId, overlayCharacters, interventionLog, sub3Log)
    const renderedImage = renderedImagesLog?.results.find(
      (result) => result.scene_id === sceneId && result.success && typeof result.image_path === "string",
    )

    const visual: VisualBlock = {
      mode: renderedImage?.image_path ? "image" : "blueprint",
      image_path: renderedImage?.image_path,
      fallback_blueprint_available: blueprintLog !== undefined,
      chips,
      overlay_characters: overlayCharacters,
    }

    const { nav: subsceneNav, views: subsceneViews } = buildSubsceneBlocks(
      sceneId,
      sub3Log,
      pidText,
      overlayCharacters,
      characterPanels,
    )

    const [startPid, endPid] = scenePidRange.get(sceneId) ?? [0, 0]
    const bodyParagraphs: string[] = []
    for (let pid = startPid; pid <= endPid; pid++) {
      const text = pidText.get(pid)
      if (text) bodyParagraphs.push(text)
    }

    packets.push({
      scene_id: sceneId,
      scene_title: boundaryLog.scene_titles[sceneId] ?? "",
      scene_summary: (sceneIndex.scene_summary as string) ?? "",
      body_paragraphs: bodyParagraphs,
      visual,
      subscene_nav: subsceneNav,
      subscene_views: subsceneViews,
      character_panels: characterPanels,
      default_active_subscene_id: subsceneNav[0]?.subscene_id ?? "",
    })
  }

  const runId = `scene_reader_package__${docId}__${chapterId}`
  return {
    run_id: runId,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: "FINAL.1",
    method: "rule",
    parents,
    packets,
  }
}
