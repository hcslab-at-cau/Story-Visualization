/**
 * VIS.1 - Semantic Clarification (LLM)
 */

import type {
  AmbiguityResolution,
  ConfidenceLevel,
  GroundedSceneEntry,
  ScenePackets,
  VisualGrounding,
  VisualGroundingPacket,
} from "@/types/schema"
import type { LLMClient } from "@/lib/llm-client"
import { formatJsonParam } from "@/lib/prompt-loader"

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
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

function normalizeConfidence(value: unknown): ConfidenceLevel {
  const raw = asString(value).toLowerCase()
  if (raw === "high" || raw === "medium" || raw === "low") {
    return raw
  }
  return "medium"
}

function normalizeAmbiguityResolution(value: unknown): AmbiguityResolution | null {
  const record = asObject(value)
  const surfaceForm = asString(record.surface_form)
  const resolvedSense = asString(record.resolved_sense)
  const renderHint = asString(record.render_hint)
  const reason = asString(record.reason)

  if (!surfaceForm || !resolvedSense || !renderHint) {
    return null
  }

  return {
    surface_form: surfaceForm,
    resolved_sense: resolvedSense,
    render_hint: renderHint,
    avoid: asStringArray(record.avoid),
    reason,
    confidence: normalizeConfidence(record.confidence),
  }
}

function inferEnvironmentType(
  value: unknown,
  environment: unknown[],
): "indoor" | "outdoor" | "mixed" {
  const raw = asString(value).toLowerCase()
  if (raw === "indoor" || raw === "outdoor" || raw === "mixed") {
    return raw
  }

  const serialized = JSON.stringify(environment).toLowerCase()
  const hasIndoor = /indoor|room|hall|house|inside|interior/.test(serialized)
  const hasOutdoor = /outdoor|street|forest|field|garden|outside|exterior/.test(serialized)

  if (hasIndoor && hasOutdoor) return "mixed"
  if (hasOutdoor) return "outdoor"
  return "indoor"
}

function inferStageArchetype(
  value: unknown,
  scenePlace: Record<string, unknown>,
  environment: unknown[],
): string {
  const direct = asString(value)
  if (direct) return direct

  const placeCandidates = [
    scenePlace.actual_place,
    scenePlace.place_type,
    scenePlace.place_label,
    scenePlace.location,
  ]
    .map((item) => asString(item))
    .filter(Boolean)

  if (placeCandidates.length > 0) {
    return placeCandidates[0]
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "generic_space"
  }

  const serialized = JSON.stringify(environment).toLowerCase()
  if (serialized.includes("forest")) return "forest"
  if (serialized.includes("street")) return "street"
  if (serialized.includes("room")) return "room"
  return "generic_space"
}

function inferCanonicalPlaceKey(
  value: unknown,
  scenePlace: Record<string, unknown>,
  sceneCurrentPlaces: string[],
): string {
  const direct = asString(value)
  if (direct) return direct

  const placeCandidates = [
    scenePlace.actual_place,
    scenePlace.place_key,
    scenePlace.location,
    ...sceneCurrentPlaces,
  ]
    .map((item) => asString(item))
    .filter(Boolean)

  return placeCandidates[0] ?? "unknown_place"
}

function collectAvoid(
  topLevelAvoid: unknown,
  ambiguityResolutions: AmbiguityResolution[],
): string[] {
  const combined = [
    ...asStringArray(topLevelAvoid),
    ...ambiguityResolutions.flatMap((item) => item.avoid),
  ]
  return Array.from(new Set(combined))
}

function getValidatedSceneIndex(entry: GroundedSceneEntry | undefined): Record<string, unknown> {
  return asObject(entry?.validated_scene_index)
}

function buildCurrentPlaces(
  packet: ScenePackets["packets"][number],
  scenePlace: Record<string, unknown>,
): string[] {
  const values = [
    ...packet.scene_current_places,
    asString(scenePlace.actual_place),
    asString(scenePlace.location),
    asString(scenePlace.place_label),
  ].filter(Boolean)

  return Array.from(new Set(values))
}

export async function runSemanticClarification(
  packetLog: ScenePackets,
  groundedLog: { validated: GroundedSceneEntry[] },
  llmClient: LLMClient,
  docId: string,
  chapterId: string,
  parents: Record<string, string> = {},
  onProgress?: (msg: string) => void,
): Promise<VisualGrounding> {
  const packets: VisualGroundingPacket[] = []

  for (let i = 0; i < packetLog.packets.length; i++) {
    const packet = packetLog.packets[i]
    const groundedEntry = groundedLog.validated[i]
    const sceneIndex = getValidatedSceneIndex(groundedEntry)
    const scenePlace = asObject(sceneIndex.scene_place)
    const environment = Array.isArray(sceneIndex.environment) ? sceneIndex.environment : []
    const onstageCast = Array.isArray(sceneIndex.onstage_cast) ? sceneIndex.onstage_cast : []
    const currentPlaces = buildCurrentPlaces(packet, scenePlace)

    onProgress?.(`VIS.1: clarifying ${packet.scene_id}...`)

    const result = await llmClient.extractSemanticClarification({
      scene_id: packet.scene_id,
      start_pid: String(packet.start_pid),
      end_pid: String(packet.end_pid),
      scene_text: packet.scene_text_with_pid_markers,
      current_places_json: formatJsonParam(currentPlaces),
      environment_json: formatJsonParam(environment),
      start_state_json: formatJsonParam(packet.start_state),
      onstage_cast_json: formatJsonParam(onstageCast),
    })

    const record = asObject(result)
    const ambiguityResolutions = Array.isArray(record.ambiguity_resolutions)
      ? record.ambiguity_resolutions
          .map((item) => normalizeAmbiguityResolution(item))
          .filter((item): item is AmbiguityResolution => item !== null)
      : []

    packets.push({
      scene_id: packet.scene_id,
      environment_type: inferEnvironmentType(record.environment_type, environment),
      stage_archetype: inferStageArchetype(record.stage_archetype, scenePlace, environment),
      canonical_place_key: inferCanonicalPlaceKey(
        record.canonical_place_key,
        scenePlace,
        currentPlaces,
      ),
      ambiguity_resolutions: ambiguityResolutions,
      grounded_scene_description:
        asString(record.grounded_scene_description) || packet.scene_text_with_pid_markers,
      visual_constraints: asStringArray(record.visual_constraints),
      avoid: collectAvoid(record.avoid, ambiguityResolutions),
    })
  }

  return {
    run_id: `semantic_clarification__${docId}__${chapterId}`,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: "VIS.1",
    method: "llm",
    parents,
    packets,
  }
}
