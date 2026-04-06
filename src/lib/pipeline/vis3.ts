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

const PROMPT_SCHEMA_VERSION = "vis3.render_package.v1"

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
    spatial_zones: packet.spatial_zones,
    characters: describeCharacters(packet),
    geometry: packet.geometry,
    presentation: packet.presentation,
    zones: packet.zones,
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

function buildPresentationBlock(packet: StageBlueprintPacket): string {
  const geometry = packet.geometry
  const presentation = packet.presentation

  return [
    "Presentation and stage grammar:",
    `- key_moment: ${quote(packet.key_moment)}`,
    `- layout_summary: ${quote(packet.layout_summary)}`,
    `- continuity_note: ${quote(packet.continuity_note, "maintain continuity with prior scenes if applicable")}`,
    `- geometry.enclosure: ${quote(geometry?.enclosure)}`,
    `- geometry.main_axis: ${quote(geometry?.main_axis)}`,
    `- geometry.ground_profile: ${quote(geometry?.ground_profile)}`,
    `- geometry.dominant_geometry: ${quote(geometry?.dominant_geometry)}`,
    `- geometry.height_profile: ${quote(geometry?.height_profile)}`,
    `- geometry.openness: ${quote(geometry?.openness)}`,
    `- presentation.perspective_mode: ${quote(presentation?.perspective_mode)}`,
    `- presentation.section_mode: ${quote(presentation?.section_mode)}`,
    `- presentation.frame_mode: ${quote(presentation?.frame_mode)}`,
    `- presentation.edge_treatment: ${quote(presentation?.edge_treatment)}`,
    `- presentation.coverage: ${quote(presentation?.coverage)}`,
    `- presentation.continuity_beyond_frame: ${quote(presentation?.continuity_beyond_frame)}`,
    `- presentation.support_base_visibility: ${quote(presentation?.support_base_visibility)}`,
    `- presentation.symmetry_tolerance: ${quote(presentation?.symmetry_tolerance)}`,
    `- presentation.naturalism_bias: ${quote(presentation?.naturalism_bias)}`,
    "Zone grammar:",
    bulletList(
      packet.zones.map(
        (zone) =>
          `${zone.name}: shape=${zone.shape}, position=${zone.position}, scale=${zone.scale}, priority=${zone.priority}`,
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
  ].join("\n")
}

function buildFailurePatchBlock(packet: StageBlueprintPacket): string {
  return [
    "Failure patch instructions:",
    "- If the output becomes a story illustration, simplify it back into a calm axonometric spatial diagram.",
    "- If human figures, silhouettes, or faces appear, remove them entirely while preserving open space where they would stand.",
    "- If geometry becomes cluttered or overly realistic, reduce detail and keep only stage-defining structures.",
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
