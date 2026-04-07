/**
 * FINAL.1 - Scene Reader Package Builder (fully rule-based)
 * Port of Story-Decomposition/src/viewer/scene_reader_package.py
 */

import type {
  CompactHint,
  GroundedSceneModel,
  InterventionPackages,
  OverlayCharacter,
  RawChapter,
  ReaderCharacterView,
  ReaderGlobalView,
  ReaderPairView,
  RenderedImages,
  SceneBoundaries,
  ScenePackets,
  SceneReaderPackageLog,
  SceneReaderPacket,
  SubsceneButton,
  SubsceneNavItem,
  SubsceneView,
  ValidatedSubscene,
  ValidatedSubscenes,
  VisualBlock,
} from "@/types/schema"

const ZONE_ANCHOR: Record<string, [number, number]> = {
  "foreground left": [15.0, 78.0],
  "foreground center": [50.0, 78.0],
  "foreground right": [85.0, 78.0],
  "midground left": [15.0, 52.0],
  "midground center": [50.0, 52.0],
  "midground right": [85.0, 52.0],
  "background left": [15.0, 26.0],
  "background center": [50.0, 26.0],
  "background right": [85.0, 26.0],
}

const BUTTON_LABELS: Record<string, string> = {
  goal: "Goal",
  problem: "Problem",
  what_changed: "Change",
  why_it_matters: "Impact",
  object: "Object",
  action: "Action",
  event: "Event",
}

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

function normalizeKey(buttonType: string): string {
  const raw = buttonType.trim()
  if (raw === "why_matters") return "why_it_matters"
  return raw
}

function resolveAnchor(compositionPosition?: string): [number, number, string] {
  if (!compositionPosition) return [50.0, 52.0, "midground center"]
  const pos = compositionPosition.toLowerCase().trim()
  const coords = ZONE_ANCHOR[pos]
  if (coords) return [coords[0], coords[1], pos]
  return [50.0, 52.0, "midground center"]
}

function pairKeyFromCharacterIds(characterIds: string[]): string {
  return [...characterIds].sort().join("__")
}

function findOverlayCharacterByName(
  sceneOverlayCharacters: OverlayCharacter[],
  name: string,
): OverlayCharacter | undefined {
  const normalized = name.toLowerCase()
  return sceneOverlayCharacters.find((character) => {
    const label = character.label.toLowerCase()
    return (
      label === normalized ||
      label.includes(normalized) ||
      normalized.includes(label)
    )
  })
}

function buildChips(sceneId: string, groundedLog: GroundedSceneModel): string[] {
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

function buildOverlayCharacters(
  sceneId: string,
  blueprintLog: BlueprintLike | undefined,
  groundedLog: GroundedSceneModel,
  packetLog: ScenePackets,
): OverlayCharacter[] {
  const seen = new Map<string, OverlayCharacter>()

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

function buildButtonBundle(
  infoButtons: Array<{ label: string; button_type: string; reveal: string }>,
): { buttons: SubsceneButton[]; panels: Record<string, string> } {
  const buttons: SubsceneButton[] = []
  const panels: Record<string, string> = {}

  for (const item of infoButtons) {
    const key = normalizeKey(item.button_type)
    if (!key || !item.reveal?.trim()) continue
    if (!panels[key]) {
      panels[key] = item.reveal.trim()
      buttons.push({
        key,
        label: item.label?.trim() || BUTTON_LABELS[key] || key,
      })
    }
  }

  return { buttons, panels }
}

function deriveHintsFromPanels(
  panels: Record<string, string>,
  fallbackLabel: string,
): CompactHint[] {
  const entries = Object.entries(panels).slice(0, 3)
  if (entries.length === 0) {
    return fallbackLabel
      ? [{ label: fallbackLabel, text: fallbackLabel }]
      : []
  }

  return entries.map(([key, text]) => ({
    label: BUTTON_LABELS[key] || key,
    text,
  }))
}

function buildGlobalView(
  unit: InterventionPackages["packets"][number]["subscene_ui_units"][number] | undefined,
  subscene: ValidatedSubscene,
): ReaderGlobalView {
  const infoButtons = unit?.global_view?.buttons?.length
    ? unit.global_view.buttons
    : (unit?.info_buttons ?? [])
  const { buttons, panels } = buildButtonBundle(infoButtons)
  const summaryHint =
    unit?.global_view?.summary_hint?.trim() ||
    unit?.one_line_summary?.trim() ||
    subscene.action_summary
  const hints =
    unit?.global_view?.hints?.length
      ? unit.global_view.hints
      : deriveHintsFromPanels(panels, summaryHint)

  return {
    summary_hint: summaryHint,
    hints,
    buttons,
    panels,
  }
}

function buildCharacterViews(
  unit: InterventionPackages["packets"][number]["subscene_ui_units"][number] | undefined,
  subscene: ValidatedSubscene,
  sceneOverlayCharacters: OverlayCharacter[],
): {
  overlayCharacters: OverlayCharacter[]
  characterViews: Record<string, ReaderCharacterView>
} {
  const characterViews: Record<string, ReaderCharacterView> = {}

  for (const characterUnit of unit?.character_units ?? []) {
    const overlay = findOverlayCharacterByName(sceneOverlayCharacters, characterUnit.name)
    if (!overlay) continue
    const { buttons, panels } = buildButtonBundle(characterUnit.buttons)

    characterViews[overlay.character_id] = {
      character_id: overlay.character_id,
      label: overlay.label,
      role: characterUnit.role,
      micro_summary: characterUnit.micro_summary,
      hints: characterUnit.hints.length > 0
        ? characterUnit.hints
        : deriveHintsFromPanels(panels, characterUnit.micro_summary),
      buttons,
      panels,
    }
  }

  for (const castName of subscene.active_cast) {
    const overlay = findOverlayCharacterByName(sceneOverlayCharacters, castName)
    if (!overlay || characterViews[overlay.character_id]) continue

    characterViews[overlay.character_id] = {
      character_id: overlay.character_id,
      label: overlay.label,
      role: "present in moment",
      micro_summary: `${overlay.label} is active in this subscene.`,
      hints: [
        {
          label: "Present",
          text: `${overlay.label} matters in this local beat.`,
        },
      ],
      buttons: [],
      panels: {},
    }
  }

  const overlayCharacters = sceneOverlayCharacters.filter(
    (character) => characterViews[character.character_id] !== undefined,
  )

  return { overlayCharacters, characterViews }
}

function buildPairViews(
  unit: InterventionPackages["packets"][number]["subscene_ui_units"][number] | undefined,
  characterViews: Record<string, ReaderCharacterView>,
): Record<string, ReaderPairView> {
  const characterViewList = Object.values(characterViews)
  const pairViews: Record<string, ReaderPairView> = {}

  for (const pairUnit of unit?.pair_units ?? []) {
    const characterIds = pairUnit.names
      .map((name) => {
        const normalized = name.toLowerCase()
        return (
          characterViewList.find((view) => {
            const label = view.label.toLowerCase()
            return (
              label === normalized ||
              label.includes(normalized) ||
              normalized.includes(label)
            )
          })?.character_id ?? null
        )
      })
      .filter((value): value is string => Boolean(value))

    if (characterIds.length !== 2) continue
    const { buttons, panels } = buildButtonBundle(pairUnit.buttons)
    const pairKey = pairKeyFromCharacterIds(characterIds)

    pairViews[pairKey] = {
      pair_key: pairKey,
      character_ids: [...characterIds].sort(),
      labels: pairUnit.names,
      relation_label: pairUnit.relation_label,
      micro_summary: pairUnit.micro_summary,
      hints: pairUnit.hints.length > 0
        ? pairUnit.hints
        : deriveHintsFromPanels(panels, pairUnit.micro_summary),
      buttons,
      panels,
    }
  }

  return pairViews
}

function buildCharacterPanels(
  subsceneViews: Record<string, SubsceneView>,
  sceneOverlayCharacters: OverlayCharacter[],
): Record<string, Record<string, string>> {
  const panelMap = new Map<string, Record<string, string>>()

  for (const character of sceneOverlayCharacters) {
    panelMap.set(character.panel_key, {})
  }

  for (const [subsceneId, view] of Object.entries(subsceneViews)) {
    for (const character of view.overlay_characters) {
      const characterView = view.character_views[character.character_id]
      if (!characterView) continue
      const panelEntry = panelMap.get(character.panel_key) ?? {}
      const hintText = characterView.hints[0]?.text
      panelEntry[subsceneId] = [characterView.role, characterView.micro_summary, hintText]
        .filter(Boolean)
        .join(" · ")
      panelMap.set(character.panel_key, panelEntry)
    }
  }

  return Object.fromEntries(panelMap.entries())
}

function buildSubsceneBlocks(
  sceneId: string,
  sub3Log: ValidatedSubscenes,
  pidText: Map<number, string>,
  sceneNarrativePids: number[],
  sceneOverlayCharacters: OverlayCharacter[],
  interventionLog?: InterventionPackages,
): {
  nav: SubsceneNavItem[]
  views: Record<string, SubsceneView>
  characterPanels: Record<string, Record<string, string>>
} {
  const item = sub3Log.packets.find((p) => p.scene_id === sceneId)
  const interventionItem = interventionLog?.packets.find((p) => p.scene_id === sceneId)
  if (!item) return { nav: [], views: {}, characterPanels: {} }

  const unitMap = new Map(
    (interventionItem?.subscene_ui_units ?? []).map((unit) => [unit.subscene_id, unit]),
  )
  const nav: SubsceneNavItem[] = []
  const views: Record<string, SubsceneView> = {}

  for (const sub of item.validated_subscenes) {
    const bodyParagraphs = sceneNarrativePids
      .filter((pid) => pid >= sub.start_pid && pid <= sub.end_pid)
      .map((pid) => pidText.get(pid))
      .filter((text): text is string => Boolean(text))

    nav.push({
      subscene_id: sub.subscene_id,
      label: sub.label,
      headline: sub.headline || sub.action_summary,
      body_paragraphs: bodyParagraphs,
    })

    const unit = unitMap.get(sub.subscene_id)
    const globalView = buildGlobalView(unit, sub)
    const { overlayCharacters, characterViews } = buildCharacterViews(unit, sub, sceneOverlayCharacters)
    const pairViews = buildPairViews(unit, characterViews)

    views[sub.subscene_id] = {
      headline: sub.headline,
      overlay_characters: overlayCharacters,
      global_view: globalView,
      character_views: characterViews,
      pair_views: pairViews,
      buttons: globalView.buttons,
      panels: globalView.panels,
    }
  }

  const characterPanels = buildCharacterPanels(views, sceneOverlayCharacters)
  return { nav, views, characterPanels }
}

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
    const scenePacket = packetLog.packets.find((packet) => packet.scene_id === sceneId)

    const chips = buildChips(sceneId, groundedLog)
    const overlayCharacters = buildOverlayCharacters(sceneId, blueprintLog, groundedLog, packetLog)
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

    const { nav: subsceneNav, views: subsceneViews, characterPanels } = buildSubsceneBlocks(
      sceneId,
      sub3Log,
      pidText,
      scenePacket?.pids ?? [],
      overlayCharacters,
      interventionLog,
    )

    const [startPid, endPid] = scenePidRange.get(sceneId) ?? [0, 0]
    const bodyParagraphs = (scenePacket?.pids ?? [])
      .filter((pid) => pid >= startPid && pid <= endPid)
      .map((pid) => pidText.get(pid))
      .filter((text): text is string => Boolean(text))

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
