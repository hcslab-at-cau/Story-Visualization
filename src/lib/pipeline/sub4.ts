/**
 * SUB.4 - Intervention Packaging (LLM)
 * Port of Story-Decomposition/src/viewer/intervention_packaging.py
 */

import type {
  CompactHint,
  InfoButton,
  InterventionPackageItem,
  InterventionPackages,
  InterventionUnit,
  ValidatedSubscene,
  ValidatedSubscenes,
  ScenePackets,
  GroundedSceneModel,
  CharacterHintUnit,
  GlobalHintView,
  PairHintUnit,
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

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function matchesAllowedName(name: string, allowedNames: string[]): boolean {
  const normalized = name.toLowerCase()
  return allowedNames.some((allowed) => {
    const candidate = allowed.toLowerCase()
    return (
      candidate === normalized ||
      candidate.includes(normalized) ||
      normalized.includes(candidate)
    )
  })
}

function normalizeHints(value: unknown): CompactHint[] {
  return asObjectArray(value)
    .map((item) => {
      const label = asString(item.label)
      const text = asString(item.text)
      if (!label || !text) return null
      return { label, text } satisfies CompactHint
    })
    .filter((item): item is CompactHint => item !== null)
    .slice(0, 3)
}

function normalizeInfoButtons(value: unknown): InfoButton[] {
  return asObjectArray(value)
    .map((item) => {
      const label = asString(item.label)
      const buttonType = asString(item.button_type)
      const reveal = asString(item.reveal)
      if (!label || !buttonType || !reveal) return null
      return {
        label,
        button_type: buttonType,
        reveal,
      } satisfies InfoButton
    })
    .filter((item): item is InfoButton => item !== null)
}

function normalizeGlobalView(value: unknown, fallbackSummary: string): GlobalHintView {
  const record = asObject(value)
  const buttons = normalizeInfoButtons(record.buttons)
  const hints = normalizeHints(record.hints)

  return {
    summary_hint: asString(record.summary_hint) || fallbackSummary,
    hints: hints.length > 0 ? hints : buttons.slice(0, 2).map((button) => ({
      label: button.label,
      text: button.reveal,
    })),
    buttons,
  }
}

function normalizeCharacterUnits(
  value: unknown,
  activeCast: string[],
): CharacterHintUnit[] {
  return asObjectArray(value)
    .map((item) => {
      const name = asString(item.name)
      if (!name || (activeCast.length > 0 && !matchesAllowedName(name, activeCast))) return null
      return {
        name,
        role: asString(item.role) || "present in the moment",
        micro_summary: asString(item.micro_summary) || `${name} is active in this subscene.`,
        hints: normalizeHints(item.hints),
        buttons: normalizeInfoButtons(item.buttons),
      } satisfies CharacterHintUnit
    })
    .filter((item): item is CharacterHintUnit => item !== null)
}

function normalizePairUnits(
  value: unknown,
  activeCast: string[],
): PairHintUnit[] {
  return asObjectArray(value)
    .map((item) => {
      const names = uniqueStrings(
        Array.isArray(item.names) ? item.names.map((name) => asString(name)) : [],
      )
      if (names.length !== 2) return null
      if (
        activeCast.length > 0 &&
        names.some((name) => !matchesAllowedName(name, activeCast))
      ) {
        return null
      }

      return {
        names,
        relation_label: asString(item.relation_label) || "shared moment",
        micro_summary: asString(item.micro_summary) || `${names[0]} and ${names[1]} are jointly relevant here.`,
        hints: normalizeHints(item.hints),
        buttons: normalizeInfoButtons(item.buttons),
      } satisfies PairHintUnit
    })
    .filter((item): item is PairHintUnit => item !== null)
}

function buildLegacyCastButtons(characterUnits: CharacterHintUnit[]) {
  return characterUnits.map((unit) => ({
    name: unit.name,
    role: unit.role,
    reveal: unit.micro_summary,
  }))
}

function buildLegacyInfoButtons(globalView: GlobalHintView) {
  return globalView.buttons
}

function normalizeUnit(
  value: Record<string, unknown>,
  validatedSubscene: ValidatedSubscene | undefined,
): InterventionUnit | null {
  const subsceneId = asString(value.subscene_id)
  if (!subsceneId) return null

  const oneLineSummary =
    asString(value.one_line_summary) ||
    validatedSubscene?.action_summary ||
    `Reader hint package for ${subsceneId}.`
  const activeCast = validatedSubscene?.active_cast ?? []
  const globalView = normalizeGlobalView(value.global_view, oneLineSummary)
  const characterUnits = normalizeCharacterUnits(value.character_units, activeCast)
  const pairUnits = normalizePairUnits(value.pair_units, activeCast)

  return {
    subscene_id: subsceneId,
    title: asString(value.title) || validatedSubscene?.headline || validatedSubscene?.label || subsceneId,
    one_line_summary: oneLineSummary,
    cast_buttons: buildLegacyCastButtons(characterUnits),
    info_buttons: buildLegacyInfoButtons(globalView),
    global_view: globalView,
    character_units: characterUnits,
    pair_units: pairUnits,
    priority: asNumber(value.priority, validatedSubscene ? Math.min(1, Math.max(0.2, validatedSubscene.confidence)) : 0.4),
    jump_targets: uniqueStrings(
      Array.isArray(value.jump_targets) ? value.jump_targets.map((target) => asString(target)) : [],
    ),
  }
}

export async function runInterventionPackaging(
  validationLog: ValidatedSubscenes,
  packetLog: ScenePackets,
  validatedSceneLog: GroundedSceneModel,
  llmClient: LLMClient,
  docId: string,
  chapterId: string,
  parents: Record<string, string> = {},
  onProgress?: (msg: string) => void,
): Promise<InterventionPackages> {
  const packets: InterventionPackageItem[] = []

  for (let i = 0; i < validationLog.packets.length; i++) {
    const valItem = validationLog.packets[i]
    const packet = packetLog.packets[i]
    const entry = validatedSceneLog.validated[i]
    if (!valItem || !packet || !entry) continue

    onProgress?.(`SUB.4: packaging interventions for ${packet.scene_id}...`)

    const sceneIndex = entry.validated_scene_index as Record<string, unknown>
    const prevPacket = i > 0 ? packetLog.packets[i - 1] : undefined
    const relations = Array.isArray(sceneIndex.relations) ? sceneIndex.relations : []
    const validatedSubsceneMap = new Map(
      valItem.validated_subscenes.map((subscene) => [subscene.subscene_id, subscene]),
    )

    const result = await llmClient.packageInterventions({
      scene_id: packet.scene_id,
      scene_summary: (sceneIndex.scene_summary as string) ?? "",
      onstage_cast_json: formatJsonParam(sceneIndex.onstage_cast ?? []),
      scene_relations_json: formatJsonParam(relations),
      prev_end_state_json: formatJsonParam(prevPacket?.end_state ?? {}),
      subscenes_json: formatJsonParam(valItem.validated_subscenes),
    })

    const rawUnits = Array.isArray(result.subscene_ui_units)
      ? result.subscene_ui_units
      : (Array.isArray(result.units) ? result.units : [])

    const normalizedUnits = rawUnits
      .map((unit) => normalizeUnit(asObject(unit), validatedSubsceneMap.get(asString(asObject(unit).subscene_id))))
      .filter((unit): unit is InterventionUnit => unit !== null)

    packets.push({
      scene_id: packet.scene_id,
      subscene_ui_units: normalizedUnits,
    })
  }

  const runId = `intervention_packages__${docId}__${chapterId}`
  return {
    run_id: runId,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: "SUB.4",
    method: "llm",
    parents,
    packets,
  }
}
