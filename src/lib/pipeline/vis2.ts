/**
 * VIS.2 - Stage Blueprint Extraction (LLM + rule normalization)
 */

import type {
  GeometrySpec,
  GroundedSceneEntry,
  GroundedSceneModel,
  PresentationSpec,
  ScenePackets,
  SceneSetting,
  SpatialZone,
  StageBlueprint,
  StageBlueprintPacket,
  VisualGrounding,
  ZoneSpec,
} from "@/types/schema"
import type { LLMClient } from "@/lib/llm-client"
import { formatJsonParam } from "@/lib/prompt-loader"

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asObjectArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => item as Record<string, unknown>)
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => asString(item))
    .filter((item) => item.length > 0)
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)))
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

function inferEnvironmentType(
  value: unknown,
  fallbackValue: unknown,
  environment: Record<string, unknown>[],
): "indoor" | "outdoor" | "mixed" {
  const candidates = [asString(value).toLowerCase(), asString(fallbackValue).toLowerCase()]
  for (const candidate of candidates) {
    if (candidate === "indoor" || candidate === "outdoor" || candidate === "mixed") {
      return candidate
    }
  }

  const serialized = JSON.stringify(environment).toLowerCase()
  const hasIndoor = /indoor|room|hall|house|inside|interior/.test(serialized)
  const hasOutdoor = /outdoor|street|forest|field|garden|outside|exterior|bank|river|well|hole/.test(serialized)

  if (hasIndoor && hasOutdoor) return "mixed"
  if (hasOutdoor) return "outdoor"
  return "indoor"
}

function inferStageArchetype(
  value: unknown,
  fallbackValue: unknown,
  scenePlace: Record<string, unknown>,
): string {
  const direct = asString(value) || asString(fallbackValue)
  if (direct) return direct

  const placeCandidates = [
    scenePlace.actual_place,
    scenePlace.place_type,
    scenePlace.place_label,
    scenePlace.location,
  ]
    .map((item) => asString(item))
    .filter(Boolean)

  return slugify(placeCandidates[0] ?? "generic_space") || "generic_space"
}

function inferCanonicalPlaceKey(
  value: unknown,
  fallbackValue: unknown,
  scenePlace: Record<string, unknown>,
  currentPlaces: string[],
): string {
  const direct = asString(value) || asString(fallbackValue)
  if (direct) return direct

  const placeCandidates = [
    scenePlace.actual_place,
    scenePlace.place_key,
    scenePlace.location,
    ...currentPlaces,
  ]
    .map((item) => asString(item))
    .filter(Boolean)

  return placeCandidates[0] ?? "unknown_place"
}

function buildSemanticAvoids(visualPacket: VisualGrounding["packets"][number] | undefined): string[] {
  if (!visualPacket) return []

  const generated = visualPacket.ambiguity_resolutions.flatMap((item) =>
    item.avoid.map((avoid) => `Any layout based on ${avoid} instead of ${item.resolved_sense}`),
  )

  return uniqueStrings([...visualPacket.avoid, ...generated])
}

function normalizeSetting(
  value: unknown,
  currentPlaces: string[],
  environmentType: string,
): SceneSetting {
  const record = asObject(value)
  return {
    location: asString(record.location) || currentPlaces[0] || "unknown location",
    time_of_day: asString(record.time_of_day) || "unclear",
    atmosphere: asString(record.atmosphere) || (environmentType === "outdoor" ? "open and airy" : "enclosed and readable"),
    lighting: asString(record.lighting) || (environmentType === "outdoor" ? "soft daylight" : "gentle indoor light"),
  }
}

function normalizeGeometry(value: unknown, warnings: string[]): GeometrySpec | undefined {
  const record = asObject(value)
  if (Object.keys(record).length === 0) {
    warnings.push("Missing geometry block; filled with defaults.")
  }

  const geometry: GeometrySpec = {
    enclosure: asString(record.enclosure) || "partial",
    main_axis: asString(record.main_axis) || "horizontal",
    ground_profile: asString(record.ground_profile) || "flat",
    dominant_geometry: asString(record.dominant_geometry) || "patch",
    height_profile: asString(record.height_profile) || "normal",
    openness: asString(record.openness) || "wide",
  }

  return geometry
}

function normalizePresentation(value: unknown, warnings: string[]): PresentationSpec | undefined {
  const record = asObject(value)
  if (Object.keys(record).length === 0) {
    warnings.push("Missing presentation block; filled with defaults.")
  }

  return {
    perspective_mode: asString(record.perspective_mode) || "axonometric_2_5d",
    section_mode: asString(record.section_mode) || "none",
    frame_mode: asString(record.frame_mode) || "full_bleed",
    edge_treatment: asString(record.edge_treatment) || "natural_crop",
    coverage: asString(record.coverage) || "edge_to_edge",
    continuity_beyond_frame: asBoolean(record.continuity_beyond_frame, true),
    support_base_visibility: asString(record.support_base_visibility) || "hidden",
    symmetry_tolerance: asString(record.symmetry_tolerance) || "medium",
    naturalism_bias: asString(record.naturalism_bias) || "medium",
  }
}

function normalizeZones(value: unknown, warnings: string[]): ZoneSpec[] {
  const zones = Array.isArray(value) ? value : []
  const normalized = zones
    .map((item) => {
      const record = asObject(item)
      const name = asString(record.name)
      if (!name) return null
      return {
        name,
        shape: asString(record.shape) || "patch",
        position: asString(record.position) || "center",
        scale: asString(record.scale) || "secondary",
        priority: asString(record.priority) || "medium",
      } satisfies ZoneSpec
    })
    .filter((item): item is ZoneSpec => item !== null)

  if (normalized.length < 2) {
    warnings.push("Blueprint returned fewer than two readable zones.")
  }

  return normalized
}

function normalizeSpatialZones(value: unknown, zones: ZoneSpec[]): SpatialZone[] {
  const direct = asObjectArray(value)
    .map((item) => {
      const name = asString(item.name)
      if (!name) return null
      return {
        name,
        role: asString(item.role) || `${asString(item.shape) || "zone"} at ${asString(item.position) || "center"}`,
        priority: asString(item.priority) || "medium",
      } satisfies SpatialZone
    })
    .filter((item): item is SpatialZone => item !== null)

  if (direct.length > 0) return direct

  return zones.map((zone) => ({
    name: zone.name,
    role: `${zone.shape} at ${zone.position}`,
    priority: zone.priority,
  }))
}

function getValidatedSceneIndex(entry: GroundedSceneEntry | undefined): Record<string, unknown> {
  return asObject(entry?.validated_scene_index)
}

function buildCurrentPlaces(
  packet: ScenePackets["packets"][number],
  scenePlace: Record<string, unknown>,
): string[] {
  return uniqueStrings([
    ...packet.scene_current_places,
    asString(scenePlace.actual_place),
    asString(scenePlace.location),
    asString(scenePlace.place_label),
  ])
}

function buildMentionedPlaces(
  packet: ScenePackets["packets"][number],
  currentPlaces: string[],
  scenePlace: Record<string, unknown>,
): string[] {
  const currentPlaceSet = new Set(currentPlaces)
  return uniqueStrings([
    ...packet.scene_mentioned_places,
    asString(scenePlace.mentioned_place),
  ]).filter((place) => !currentPlaceSet.has(place))
}

function buildMustNotShow(
  value: unknown,
  mentionedPlaces: string[],
): string[] {
  const fromPrompt = asStringArray(value)
  const fromMentionedPlaces = mentionedPlaces.map(
    (place) => `Do not depict ${place} as the current scene location`,
  )

  return uniqueStrings([
    ...fromPrompt,
    ...fromMentionedPlaces,
    "Portable story props that do not define space",
  ])
}

export async function runStageBlueprintExtraction(
  packetLog: ScenePackets,
  groundedLog: GroundedSceneModel,
  llmClient: LLMClient,
  docId: string,
  chapterId: string,
  parents: Record<string, string> = {},
  visualLog?: VisualGrounding,
  onProgress?: (msg: string) => void,
): Promise<StageBlueprint> {
  const packets: StageBlueprintPacket[] = []

  for (let i = 0; i < packetLog.packets.length; i++) {
    const packet = packetLog.packets[i]
    const groundedEntry = groundedLog.validated.find((entry) => entry.scene_id === packet.scene_id) ?? groundedLog.validated[i]
    const visualPacket = visualLog?.packets.find((entry) => entry.scene_id === packet.scene_id)
    const sceneIndex = getValidatedSceneIndex(groundedEntry)
    const scenePlace = asObject(sceneIndex.scene_place)
    const environment = asObjectArray(sceneIndex.environment)
    const goals = asObjectArray(sceneIndex.goals)
    const objects = asObjectArray(sceneIndex.objects)
    const currentPlaces = buildCurrentPlaces(packet, scenePlace)
    const mentionedPlaces = buildMentionedPlaces(packet, currentPlaces, scenePlace)
    const onstageCast = asObjectArray(sceneIndex.onstage_cast)

    onProgress?.(`VIS.2: blueprinting ${packet.scene_id}...`)

    const result = await llmClient.extractImageSupport({
      scene_id: packet.scene_id,
      start_pid: String(packet.start_pid),
      end_pid: String(packet.end_pid),
      start_state_json: formatJsonParam(packet.start_state),
      end_state_json: formatJsonParam(packet.end_state),
      scene_text: packet.scene_text_with_pid_markers,
      onstage_cast_json: formatJsonParam(onstageCast),
      current_places_json: formatJsonParam(currentPlaces),
      mentioned_places_json: formatJsonParam(mentionedPlaces),
      objects_json: formatJsonParam(objects),
      environment_json: formatJsonParam(environment),
      goals_json: formatJsonParam(goals),
      grounded_scene_description: visualPacket?.grounded_scene_description ?? packet.scene_text_with_pid_markers,
      ambiguity_resolutions_json: formatJsonParam(visualPacket?.ambiguity_resolutions ?? []),
    })

    const record = asObject(result)
    const warnings = asStringArray(record.blueprint_warnings)
    const semanticAvoids = buildSemanticAvoids(visualPacket)
    const zones = normalizeZones(record.zones, warnings)

    const packetResult: StageBlueprintPacket = {
      scene_id: packet.scene_id,
      canonical_place_key: inferCanonicalPlaceKey(
        record.canonical_place_key,
        visualPacket?.canonical_place_key,
        scenePlace,
        currentPlaces,
      ),
      environment_type: inferEnvironmentType(record.environment_type, visualPacket?.environment_type, environment),
      stage_archetype: inferStageArchetype(record.stage_archetype, visualPacket?.stage_archetype, scenePlace),
      key_moment: asString(record.key_moment) || asString(record.layout_summary) || `Spatial layout for ${packet.scene_id}`,
      setting: normalizeSetting(record.setting, currentPlaces, inferEnvironmentType(record.environment_type, visualPacket?.environment_type, environment)),
      characters: [],
      structural_elements: uniqueStrings(asStringArray(record.structural_elements)),
      layout_summary: asString(record.layout_summary) || `Scene ${packet.scene_id} stage layout derived from validated scene packet.`,
      spatial_zones: normalizeSpatialZones(record.spatial_zones, zones),
      avoid: uniqueStrings([...asStringArray(record.avoid), ...semanticAvoids]),
      must_not_show: buildMustNotShow(record.must_not_show, mentionedPlaces),
      continuity_note: asString(record.continuity_note) || `Keep place and cast continuity aligned with adjacent scenes around ${packet.scene_id}.`,
      uncertainties: uniqueStrings(asStringArray(record.uncertainties)),
      geometry: normalizeGeometry(record.geometry, warnings),
      presentation: normalizePresentation(record.presentation, warnings),
      zones,
      boundaries: uniqueStrings(asStringArray(record.boundaries)),
      repetition: uniqueStrings(asStringArray(record.repetition)),
      forbid: uniqueStrings([...asStringArray(record.forbid), ...semanticAvoids]),
      blueprint_valid: asBoolean(record.blueprint_valid, warnings.length === 0),
      blueprint_warnings: uniqueStrings(warnings),
    }

    packets.push(packetResult)
  }

  return {
    run_id: `image_support__${docId}__${chapterId}`,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: "VIS.2",
    method: "llm+rule",
    parents,
    packets,
  }
}
