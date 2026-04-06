/**
 * VIS.3 - Render Package Compilation (rule-based)
 */

import type {
  RenderPackage,
  RenderPackageItem,
  StageBlueprint,
  StageBlueprintPacket,
} from "@/types/schema"
import { PromptLoader, formatJsonParam } from "@/lib/prompt-loader"

const PROMPT_SCHEMA_VERSION = "vis3.render_package.v2"

function quote(value: unknown, fallback = "unspecified"): string {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return fallback
}

function bulletList(items: string[], emptyLine: string): string {
  if (items.length === 0) return `- ${emptyLine}`
  return items.map((item) => `- ${item}`).join("\n")
}

function describeCharacters(packet: StageBlueprintPacket): Array<Record<string, unknown>> {
  return packet.characters.map((character) => ({
    name: character.name,
    composition_position: character.composition_position,
    pose: character.pose,
    expression: character.expression,
    gaze_direction: character.gaze_direction,
    notable_props: character.notable_props,
  }))
}

function buildSceneJson(packet: StageBlueprintPacket): string {
  return formatJsonParam({
    scene_id: packet.scene_id,
    canonical_place_key: packet.canonical_place_key,
    environment_type: packet.environment_type,
    stage_archetype: packet.stage_archetype,
    key_moment: packet.key_moment,
    location: packet.setting.location,
    time_of_day: packet.setting.time_of_day,
    atmosphere: packet.setting.atmosphere,
    lighting: packet.setting.lighting,
    layout_summary: packet.layout_summary,
    structural_elements: packet.structural_elements,
    spatial_zones: packet.spatial_zones.map((zone) => ({
      role: zone.role,
      priority: zone.priority,
    })),
    characters: describeCharacters(packet),
    geometry: packet.geometry,
    boundaries: packet.boundaries,
    repetition: packet.repetition,
    continuity_note: packet.continuity_note,
    avoid: packet.avoid,
    forbid: packet.forbid,
    must_not_show: packet.must_not_show,
    uncertainties: packet.uncertainties,
    blueprint_valid: packet.blueprint_valid,
    blueprint_warnings: packet.blueprint_warnings,
  })
}

function describePerspective(mode: string): string {
  switch (mode) {
    case "plan_oblique":
      return "Use a slightly elevated natural view, not a rigid diagram."
    case "vertical_section":
      return "Use a vertical sectional view only as much as needed to explain the space."
    case "oblique_section":
      return "Use an oblique sectional view only as much as needed to explain layered space."
    case "axonometric_2_5d":
    default:
      return "Use a restrained elevated view with low distortion, but do not literalize it as a rigid isometric block."
  }
}

function describeSection(mode: string): string {
  switch (mode) {
    case "front_cut":
      return "A front cut is allowed only if absolutely necessary; avoid boxed cutaway presentation."
    case "side_cut":
      return "A side cut is allowed only if absolutely necessary; avoid exposed box walls."
    case "vertical_section":
      return "A vertical section is allowed only if the place cannot be understood otherwise."
    case "hybrid":
      return "Use any hybrid sectioning very sparingly and avoid presentation-model aesthetics."
    case "none":
    default:
      return "Do not use any cutaway or sectional opening."
  }
}

function describeFrame(mode: string): string {
  switch (mode) {
    case "soft_frame":
      return "Keep only a soft visual boundary; do not box the place into a panel."
    case "thin_panel":
      return "Avoid a panel-like presentation; treat the place as a view, not a board."
    case "cutaway_box":
      return "Avoid a cutaway box unless the spatial logic truly requires it."
    case "platform":
      return "Do not present the place as a raised platform or freestanding slab."
    case "full_bleed":
    default:
      return "Let the place continue naturally to the image edges, not as a centered object."
  }
}

function describeCoverage(mode: string): string {
  switch (mode) {
    case "centered_object":
      return "Do not isolate the place as a centered object; fill the frame with the scene."
    case "balanced_margin":
      return "Keep margins modest and secondary to the place itself."
    case "edge_to_edge":
    default:
      return "Let the actual place occupy most of the frame."
  }
}

function describeBaseVisibility(mode: string): string {
  switch (mode) {
    case "visible":
      return "Do not show a visible slab, underside, pedestal, or display base unless absolutely unavoidable."
    case "minimal":
      return "Any ground edge should be minimal and natural, never a model base."
    case "hidden":
    default:
      return "Hide any slab thickness, underside, pedestal, or support base completely."
  }
}

function buildPresentationBlock(packet: StageBlueprintPacket): string {
  const geometry = packet.geometry
  const presentation = packet.presentation

  return [
    "Spatial composition guidance:",
    `- key_moment: ${quote(packet.key_moment)}`,
    `- layout_summary: ${quote(packet.layout_summary)}`,
    `- continuity_note: ${quote(packet.continuity_note, "maintain continuity with prior scenes if applicable")}`,
    `- enclosure cue: ${quote(geometry?.enclosure)}`,
    `- main spatial flow: ${quote(geometry?.main_axis)}`,
    `- ground character: ${quote(geometry?.ground_profile)}`,
    `- dominant spatial form: ${quote(geometry?.dominant_geometry)}; if this reads as "patch", treat it as an organic grounded area, not a square tile.`,
    `- vertical profile: ${quote(geometry?.height_profile)}`,
    `- openness cue: ${quote(geometry?.openness)}`,
    `- viewpoint: ${describePerspective(quote(presentation?.perspective_mode))}`,
    `- section handling: ${describeSection(quote(presentation?.section_mode))}`,
    `- frame handling: ${describeFrame(quote(presentation?.frame_mode))}`,
    `- edge handling: ${quote(presentation?.edge_treatment) === "clean_margin" ? "Use only slight padding; do not create large blank margins." : quote(presentation?.edge_treatment) === "architectural_cut" ? "Avoid hard sliced box edges unless structurally required." : "Let terrain and architecture crop naturally at the edges."}`,
    `- coverage: ${describeCoverage(quote(presentation?.coverage))}`,
    `- continuity beyond frame: ${quote(presentation?.continuity_beyond_frame) === "true" ? "Allow the place to continue beyond the crop." : "Keep the crop self-contained without turning the place into an isolated object."}`,
    `- base visibility: ${describeBaseVisibility(quote(presentation?.support_base_visibility))}`,
    `- symmetry tolerance: ${quote(presentation?.symmetry_tolerance)}`,
    `- naturalism bias: ${quote(presentation?.naturalism_bias)}; prefer believable terrain/architecture over diagram panels.`,
    "Zone guidance:",
    bulletList(
      packet.zones.map(
        (zone) =>
          `${zone.position} ${zone.shape} zone, scale=${zone.scale}, priority=${zone.priority}`,
      ),
      "No explicit zone grammar provided.",
    ),
    "Structural elements:",
    bulletList(packet.structural_elements, "Keep only the minimum structural elements needed for orientation."),
    "Character placement references:",
    bulletList(
      packet.characters.map(
        (character) =>
          `${character.name}: ${character.composition_position}; pose=${character.pose}; expression=${character.expression}`,
      ),
      "No characters should be rendered.",
    ),
  ].join("\n")
}

function buildHardConstraintsBlock(packet: StageBlueprintPacket): string {
  const combinedAvoid = Array.from(
    new Set([
      ...packet.avoid,
      ...packet.forbid,
      ...packet.must_not_show,
    ]),
  )

  return [
    "Hard constraints:",
    `- blueprint_valid: ${packet.blueprint_valid ? "true" : "false"}`,
    "Avoid:",
    bulletList(combinedAvoid, "Avoid any interpretation not grounded by the blueprint."),
    "Boundaries:",
    bulletList(packet.boundaries, "Preserve readable scene boundaries without adding new ones."),
    "Repetition controls:",
    bulletList(packet.repetition, "Do not duplicate structural or object motifs unnecessarily."),
    "Blueprint warnings:",
    bulletList(packet.blueprint_warnings, "No blueprint warnings recorded."),
    "Uncertainties:",
    bulletList(packet.uncertainties, "No unresolved uncertainty was recorded."),
    "Must not show any human figure even if characters are described; use character fields only as spatial anchoring hints for future overlays.",
    "Must not show a slab underside, pedestal, platform thickness, dollhouse wall cut, or presentation-box framing.",
    "Must not render any readable text, zone label, annotation, caption, or floating word on the image.",
    "If a real sign or inscription would naturally exist, keep it too small or abstract to read unless the text itself is scene-essential.",
  ].join("\n")
}

function buildFailurePatchBlock(packet: StageBlueprintPacket): string {
  return [
    "Failure patch instructions:",
    "- If the output becomes a story illustration, simplify it back into a calm, low-detail place view with quiet outlines and minimal ornament.",
    "- If the image turns into a dollhouse, cutaway box, platform diorama, or sectional slice, regenerate it as a natural camera-framed view of the place itself.",
    "- If human figures, silhouettes, or faces appear, remove them entirely while preserving only the environmental cues needed for spatial comprehension.",
    "- If any readable text, zone label, annotation, or caption appears, regenerate with no readable text anywhere in the image.",
    "- If geometry becomes cluttered or overly realistic, reduce detail and keep only place-defining structures.",
    "- If there is too much empty space around the place, crop closer so the actual scene fills the frame.",
    "- If the composition drifts away from the declared zones, restore the main axis and zone priority ordering.",
    "- If forbidden or avoided elements appear, regenerate without those elements and prefer omission over risky substitution.",
    `- Canonical place key to preserve: ${quote(packet.canonical_place_key)}`,
    `- Stage archetype to preserve: ${quote(packet.stage_archetype)}`,
  ].join("\n")
}

function joinPromptBlocks(item: Omit<RenderPackageItem, "scene_id" | "full_prompt" | "prompt_schema_version" | "failure_history">): string {
  return [
    item.common_style_block,
    item.scene_blueprint_block,
    item.presentation_block,
    item.hard_constraints_block,
    item.failure_patch_block,
  ]
    .map((block) => block.trim())
    .filter(Boolean)
    .join("\n\n")
}

export function runRenderPackageCompilation(
  blueprintLog: StageBlueprint,
  docId: string,
  chapterId: string,
  parents: Record<string, string> = {},
): RenderPackage {
  const promptLoader = new PromptLoader()
  const commonStyleBlock = promptLoader.load("vis3_style_common").trim()

  const items: RenderPackageItem[] = blueprintLog.packets.map((packet) => {
    const sceneBlueprintBlock = promptLoader
      .load("vis3_image_common", {
        SCENE_JSON: buildSceneJson(packet),
      })
      .trim()

    const itemBase = {
      common_style_block: commonStyleBlock,
      scene_blueprint_block: sceneBlueprintBlock,
      presentation_block: buildPresentationBlock(packet),
      hard_constraints_block: buildHardConstraintsBlock(packet),
      failure_patch_block: buildFailurePatchBlock(packet),
    }

    return {
      scene_id: packet.scene_id,
      ...itemBase,
      full_prompt: joinPromptBlocks(itemBase),
      prompt_schema_version: PROMPT_SCHEMA_VERSION,
      failure_history: [],
    }
  })

  return {
    run_id: `render_package__${docId}__${chapterId}`,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: "VIS.3",
    method: "rule",
    parents,
    items,
  }
}
