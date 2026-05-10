import type { SceneReaderPacket, SupportUnit } from "@/types/schema"

export interface VisualSupportPolicy {
  usefulnessScore: number
  primaryRole: "spatial_model" | "character_anchor" | "atmosphere" | "low_value"
  showImageByDefault: boolean
  showBlueprintByDefault: boolean
  suppressReason?: "visual_low" | "unsupported"
  reasons: string[]
}

const SPATIAL_TERMS = [
  "place",
  "room",
  "door",
  "window",
  "street",
  "garden",
  "forest",
  "road",
  "path",
  "corridor",
  "hall",
  "stairs",
  "inside",
  "outside",
  "left",
  "right",
  "behind",
  "under",
  "above",
  "across",
  "toward",
  "through",
  "enter",
  "leave",
  "move",
  "run",
  "follow",
  "hide",
  "search",
  "look",
  "find",
]

const LOW_VALUE_TERMS = [
  "think",
  "thought",
  "remember",
  "feel",
  "felt",
  "wonder",
  "said",
  "asked",
  "answered",
]

function boundedScore(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function countTerms(text: string, terms: string[]): number {
  const lowered = text.toLowerCase()
  return terms.filter((term) => lowered.includes(term.toLowerCase())).length
}

function visualPrimaryRole(packet: SceneReaderPacket, supportUnits: SupportUnit[]): VisualSupportPolicy["primaryRole"] {
  if (supportUnits.some((unit) => unit.kind === "spatial_continuity" || unit.kind === "visual_context")) {
    return "spatial_model"
  }
  if (packet.visual.overlay_characters.length >= 2) return "character_anchor"
  if (packet.visual.chips.length > 0) return "atmosphere"
  return "low_value"
}

export function scoreVisualSupport(
  packet: SceneReaderPacket,
  supportUnits: SupportUnit[] = [],
): VisualSupportPolicy {
  const text = [
    packet.scene_title,
    packet.scene_summary,
    packet.visual.chips.join(" "),
    ...supportUnits.map((unit) => `${unit.title} ${unit.body}`),
  ].join(" ")
  const spatialMatches = countTerms(text, SPATIAL_TERMS)
  const lowValueMatches = countTerms(text, LOW_VALUE_TERMS)
  const reasons: string[] = []
  let score = 0.12

  if (packet.visual.image_path) {
    score += 0.22
    reasons.push("image_available")
  }
  if (packet.visual.fallback_blueprint_available) {
    score += 0.1
    reasons.push("blueprint_available")
  }
  if (packet.visual.chips.length > 0) {
    score += Math.min(0.16, packet.visual.chips.length * 0.04)
    reasons.push("visual_chips")
  }
  if (packet.visual.overlay_characters.length >= 2) {
    score += 0.1
    reasons.push("multiple_character_anchors")
  }
  if (supportUnits.some((unit) => unit.kind === "spatial_continuity")) {
    score += 0.2
    reasons.push("spatial_support_available")
  }
  if (supportUnits.some((unit) => unit.kind === "visual_context")) {
    score += 0.18
    reasons.push("visual_context_support_available")
  }
  if (spatialMatches > 0) {
    score += Math.min(0.22, spatialMatches * 0.04)
    reasons.push("spatial_language")
  }
  if (lowValueMatches > spatialMatches) {
    score -= 0.14
    reasons.push("dialogue_or_internal_focus")
  }

  const usefulnessScore = boundedScore(score)
  const primaryRole = visualPrimaryRole(packet, supportUnits)
  const showImageByDefault = Boolean(packet.visual.image_path) && usefulnessScore >= 0.48
  const showBlueprintByDefault = !packet.visual.image_path &&
    packet.visual.fallback_blueprint_available &&
    usefulnessScore >= 0.4
  const suppressReason = showImageByDefault || showBlueprintByDefault
    ? undefined
    : packet.visual.image_path || packet.visual.fallback_blueprint_available
      ? "visual_low"
      : "unsupported"

  return {
    usefulnessScore,
    primaryRole,
    showImageByDefault,
    showBlueprintByDefault,
    suppressReason,
    reasons,
  }
}
