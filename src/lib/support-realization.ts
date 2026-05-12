import type { ReaderProblem, SupportUnit } from "@/types/schema"

export interface ReaderSupportRealization {
  chipLabel: string
  categoryLabel: string
  title: string
  preview: string
  detail: string
  bridge?: {
    previous: string
    current: string
  }
}

export type AnchoredSupportGranularity = "paragraph" | "sentence" | "phrase" | "word"

export interface AnchoredSupportContext {
  selectedText: string
  paragraphText: string
  granularity: AnchoredSupportGranularity
  mode: "reader" | "researcher"
}

export interface AnchoredSupportBullet {
  label: string
  text: string
}

export interface AnchoredSupportRealization {
  chipLabel: string
  categoryLabel: string
  title: string
  lead: string
  bullets: AnchoredSupportBullet[]
  detail?: string
  bridge?: {
    previous: string
    current: string
  }
  evidenceLabel?: string
  debug?: {
    parsedFrom: "structured_body" | "bridge_body" | "legacy_body" | "fallback"
    rawTitle: string
    rawBody: string
  }
}

const PROBLEM_LABELS: Record<ReaderProblem, { chip: string; category: string; title: string }> = {
  boundary_update: {
    chip: "변화",
    category: "달라진 점",
    title: "방금 무엇이 바뀌었나요?",
  },
  state_recovery: {
    chip: "지금",
    category: "현재 상황",
    title: "지금 장면의 핵심은 무엇인가요?",
  },
  causal_gap: {
    chip: "왜?",
    category: "이전 사건",
    title: "왜 이 일이 이어질까요?",
  },
  reference_ambiguity: {
    chip: "누구?",
    category: "지시어 단서",
    title: "이 표현은 누구를 가리키나요?",
  },
  character_reentry: {
    chip: "인물",
    category: "인물 기억",
    title: "이 인물은 왜 다시 중요할까요?",
  },
  relation_delta: {
    chip: "관계",
    category: "관계 변화",
    title: "관계가 어떻게 달라졌나요?",
  },
  spatial_disorientation: {
    chip: "장소",
    category: "장소 단서",
    title: "지금 어디에서 이어지고 있나요?",
  },
  session_reentry: {
    chip: "복귀",
    category: "다시 읽기",
    title: "다시 읽기 전에 무엇을 기억하면 좋을까요?",
  },
}

function cleanSupportText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\bSUP\.\d+\b/g, "")
    .replace(/\bBOOK\.0\b/g, "")
    .replace(/\bFINAL\.\d+\b/g, "")
    .trim()
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function compactReaderText(text: string, maxLength = 120): string {
  const normalized = cleanSupportText(text)
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1).trim()}…`
}

const STRUCTURED_FIELD_LABELS = [
  "Place",
  "Current place",
  "Nearby/mentioned places",
  "Cast",
  "Active cast",
  "Goals",
  "Goal",
  "Objects",
  "Environment",
  "Relations",
  "Actions",
  "Entered",
  "Exited",
  "Time",
  "Summary",
]

function normalizeFieldKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")
}

function extractStructuredFields(body: string): Record<string, string> {
  const text = cleanSupportText(body)
  const matches: Array<{ label: string; index: number; valueStart: number }> = []

  for (const label of STRUCTURED_FIELD_LABELS) {
    const pattern = new RegExp(`(?:^|\\s)${escapeRegExp(label)}:\\s*`, "gi")
    let match = pattern.exec(text)
    while (match) {
      matches.push({
        label,
        index: match.index,
        valueStart: match.index + match[0].length,
      })
      match = pattern.exec(text)
    }
  }

  if (matches.length === 0) return {}

  const fields: Record<string, string> = {}
  const sorted = matches.sort((a, b) => a.index - b.index)
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index]
    const next = sorted[index + 1]
    const value = text
      .slice(current.valueStart, next?.index ?? text.length)
      .replace(/[.;,\s]+$/g, "")
      .trim()
    if (value) fields[normalizeFieldKey(current.label)] = value
  }
  return fields
}

function getField(fields: Record<string, string>, keys: string[]): string | undefined {
  return keys.map((key) => fields[key]).find(Boolean)
}

function splitFieldList(value: string | undefined, maxItems = 4): string | undefined {
  if (!value) return undefined
  const items = value
    .split(/\s*(?:,|;|\||\/|\band\b)\s*/i)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems)
  return items.length > 0 ? items.join(", ") : compactReaderText(value, 90)
}

function splitRawList(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(/\s*(?:,|;|\||\/|\band\b)\s*/i)
    .map((item) => item.replace(/[.:]+$/g, "").trim())
    .filter(Boolean)
}

function extractReferenceTargets(body: string): string[] {
  const match = cleanSupportText(body).match(/against:\s*(.+)$/i)
  return splitRawList(match?.[1])
}

function resolveReferenceTarget(selectedText: string, targets: string[]): string | undefined {
  if (targets.length === 0) return undefined
  const normalized = selectedText.toLowerCase().replace(/[^a-z\s-]/g, "").trim()
  if (/\b(she|her|hers|alice)\b/.test(normalized)) {
    return targets.find((target) => /alice/i.test(target)) ?? targets[0]
  }
  if (/\b(it|its|rabbit|white rabbit)\b/.test(normalized)) {
    return targets.find((target) => /rabbit/i.test(target)) ?? targets[1] ?? targets[0]
  }
  return targets.join(", ")
}

function bullet(label: string, text: string | undefined, maxLength = 92): AnchoredSupportBullet | null {
  if (!text?.trim()) return null
  return { label, text: compactReaderText(text, maxLength) }
}

function ensureBullets(
  items: Array<AnchoredSupportBullet | null>,
  fallbackLabel: string,
  fallbackText: string | undefined,
): AnchoredSupportBullet[] {
  const bullets = items.filter((item): item is AnchoredSupportBullet => Boolean(item))
  if (bullets.length > 0) return bullets
  const fallback = bullet(fallbackLabel, fallbackText, 120)
  return fallback ? [fallback] : []
}

function compactSelectedText(context: AnchoredSupportContext): string {
  const maxLength = context.granularity === "paragraph" ? 120 : 70
  return compactReaderText(context.selectedText || context.paragraphText, maxLength)
}

function selectedLead(context: AnchoredSupportContext, supportMessage: string): string {
  const selectedText = compactSelectedText(context)
  if (!selectedText) return supportMessage
  if (context.granularity === "word") {
    return `선택한 표현 "${selectedText}"은 ${supportMessage}`
  }
  if (context.granularity === "phrase") {
    return `선택한 구절 "${selectedText}"은 ${supportMessage}`
  }
  if (context.granularity === "sentence") {
    return `선택한 문장에서는 ${supportMessage}`
  }
  return `이 문단에서는 ${supportMessage}`
}

export function splitSupportBridgeBody(body: string): { previous: string; current: string } | null {
  const parts = cleanSupportText(body)
    .split(/\s*(?:->|→|=>)\s*/)
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.length < 2) return null

  return {
    previous: parts.slice(0, -1).join(" -> "),
    current: parts[parts.length - 1],
  }
}

function getFallbackLabels(unit: SupportUnit): { chip: string; category: string; title: string } {
  if (unit.reader_problem && PROBLEM_LABELS[unit.reader_problem]) {
    return PROBLEM_LABELS[unit.reader_problem]
  }

  switch (unit.kind) {
    case "causal_bridge":
      return PROBLEM_LABELS.causal_gap
    case "reference_repair":
      return PROBLEM_LABELS.reference_ambiguity
    case "spatial_continuity":
    case "visual_context":
      return PROBLEM_LABELS.spatial_disorientation
    case "character_focus":
      return PROBLEM_LABELS.character_reentry
    case "relation_delta":
      return PROBLEM_LABELS.relation_delta
    case "reentry_recap":
      return PROBLEM_LABELS.session_reentry
    case "snapshot":
      return PROBLEM_LABELS.state_recovery
    case "boundary_delta":
      return PROBLEM_LABELS.boundary_update
    default:
      return {
        chip: "도움",
        category: "읽기 단서",
        title: "이 장면을 이해하는 데 필요한 단서",
      }
  }
}

export function realizeSupportUnit(unit: SupportUnit): ReaderSupportRealization {
  const labels = getFallbackLabels(unit)
  const bridge = unit.reader_problem === "causal_gap" || unit.kind === "causal_bridge"
    ? splitSupportBridgeBody(unit.body)
    : null

  if (bridge) {
    return {
      chipLabel: labels.chip,
      categoryLabel: labels.category,
      title: labels.title,
      preview: `${compactReaderText(bridge.previous, 58)} → ${compactReaderText(bridge.current, 58)}`,
      detail: "이전 장면의 사건이 현재 장면의 이유나 결과로 이어지는 부분입니다.",
      bridge,
    }
  }

  const cleanedBody = cleanSupportText(unit.body)
  return {
    chipLabel: labels.chip,
    categoryLabel: labels.category,
    title: labels.title,
    preview: compactReaderText(cleanedBody, 110),
    detail: cleanedBody || unit.title || labels.title,
  }
}

export function realizeAnchoredSupportUnit(
  unit: SupportUnit,
  context: AnchoredSupportContext,
): AnchoredSupportRealization {
  const base = realizeSupportUnit(unit)
  const fields = extractStructuredFields(unit.body)
  const fieldCount = Object.keys(fields).length
  const evidenceText = unit.evidence.find((ref) => ref.text?.trim())?.text
  const bridge = (unit.reader_problem === "causal_gap" || unit.kind === "causal_bridge")
    ? splitSupportBridgeBody(unit.body)
    : null

  if (bridge) {
    return {
      chipLabel: base.chipLabel,
      categoryLabel: base.categoryLabel,
      title: "이 일이 이어지는 이유",
      lead: selectedLead(context, "앞선 사건과 지금 행동의 연결을 확인하는 단서입니다."),
      bullets: [],
      detail: "앞에서 생긴 일과 지금 문장의 연결만 확인하면 됩니다.",
      bridge: {
        previous: compactReaderText(bridge.previous, 120),
        current: compactReaderText(bridge.current, 120),
      },
      evidenceLabel: evidenceText ? compactReaderText(evidenceText, 120) : undefined,
      debug: {
        parsedFrom: "bridge_body",
        rawTitle: unit.title,
        rawBody: unit.body,
      },
    }
  }

  const place = getField(fields, ["place", "current_place"])
  const nearbyPlaces = getField(fields, ["nearby_mentioned_places"])
  const cast = splitFieldList(getField(fields, ["cast", "active_cast"]))
  const goals = splitFieldList(getField(fields, ["goals", "goal"]))
  const actions = splitFieldList(getField(fields, ["actions"]))
  const objects = splitFieldList(getField(fields, ["objects"]))
  const environment = splitFieldList(getField(fields, ["environment"]))
  const relations = splitFieldList(getField(fields, ["relations"]))
  const entered = splitFieldList(getField(fields, ["entered"]))
  const exited = splitFieldList(getField(fields, ["exited"]))
  const time = getField(fields, ["time"])
  const summary = getField(fields, ["summary"])
  const referenceTargets = extractReferenceTargets(unit.body)
  const resolvedReferenceTarget = resolveReferenceTarget(context.selectedText, referenceTargets)
  const cleanedDetail = compactReaderText(summary || base.detail || unit.body, 180)

  const commonDebug = {
    parsedFrom: fieldCount > 0 ? "structured_body" as const : "fallback" as const,
    rawTitle: unit.title,
    rawBody: unit.body,
  }

  switch (unit.kind) {
    case "snapshot":
      return {
        chipLabel: "지금",
        categoryLabel: "현재 상황",
        title: "지금 이 부분에서 확인할 상황",
        lead: selectedLead(context, "현재 장소, 인물, 목표를 정렬하는 단서입니다."),
        bullets: ensureBullets([
          bullet("장소", place),
          bullet("인물", cast),
          bullet("목표", goals),
        ], "현재 상황", cleanedDetail),
        detail: cleanedDetail,
        evidenceLabel: evidenceText ? compactReaderText(evidenceText, 120) : undefined,
        debug: commonDebug,
      }
    case "boundary_delta":
      return {
        chipLabel: "변화",
        categoryLabel: "달라진 점",
        title: "방금 바뀐 점",
        lead: selectedLead(context, "장면의 상태, 관심, 등장 인물이 바뀌는 신호입니다."),
        bullets: ensureBullets([
          bullet("장소", place || nearbyPlaces),
          bullet("시간", time),
          bullet("등장", entered),
          bullet("퇴장", exited),
          bullet("행동", actions),
        ], "바뀐 점", cleanedDetail),
        detail: cleanedDetail,
        evidenceLabel: evidenceText ? compactReaderText(evidenceText, 120) : undefined,
        debug: commonDebug,
      }
    case "character_focus":
      return {
        chipLabel: "인물",
        categoryLabel: "인물 단서",
        title: "이 부분에서 중요한 인물",
        lead: selectedLead(context, "누가 행동하고 무엇을 신경 쓰는지 잡아주는 단서입니다."),
        bullets: ensureBullets([
          bullet("인물", cast),
          bullet("행동", actions),
          bullet("목표", goals),
        ], "인물 단서", cleanedDetail),
        detail: cleanedDetail,
        evidenceLabel: evidenceText ? compactReaderText(evidenceText, 120) : undefined,
        debug: commonDebug,
      }
    case "relation_delta":
      return {
        chipLabel: "관계",
        categoryLabel: "관계 변화",
        title: "관계에서 볼 점",
        lead: selectedLead(context, "인물 사이의 거리, 관심, 반응을 읽는 단서입니다."),
        bullets: ensureBullets([
          bullet("관계", relations),
          bullet("인물", cast),
          bullet("신호", actions || cleanedDetail),
        ], "관계 신호", cleanedDetail),
        detail: cleanedDetail,
        evidenceLabel: evidenceText ? compactReaderText(evidenceText, 120) : undefined,
        debug: commonDebug,
      }
    case "spatial_continuity":
      return {
        chipLabel: "장소",
        categoryLabel: "장소 단서",
        title: "지금 어디에서 이어지나요?",
        lead: selectedLead(context, "장소나 이동 흐름을 놓치지 않도록 잡아주는 단서입니다."),
        bullets: ensureBullets([
          bullet("현재 장소", place),
          bullet("주변 장소", nearbyPlaces),
          bullet("이동 흐름", actions),
        ], "장소 흐름", cleanedDetail),
        detail: cleanedDetail,
        evidenceLabel: evidenceText ? compactReaderText(evidenceText, 120) : undefined,
        debug: commonDebug,
      }
    case "reference_repair":
      return {
        chipLabel: "누구?",
        categoryLabel: "지시어 단서",
        title: "이 표현이 가리키는 대상",
        lead: selectedLead(context, "짧은 지칭이나 애매한 표현의 대상을 확인하는 단서입니다."),
        bullets: ensureBullets([
          bullet("가리키는 대상", resolvedReferenceTarget),
          bullet("표현", compactSelectedText(context), 70),
          bullet("가능한 대상", referenceTargets.length > 0 ? referenceTargets.join(", ") : cast || objects),
          bullet("근거", evidenceText),
        ], "지시어 단서", cleanedDetail),
        detail: cleanedDetail,
        evidenceLabel: evidenceText ? compactReaderText(evidenceText, 120) : undefined,
        debug: commonDebug,
      }
    case "visual_context":
      return {
        chipLabel: "단서",
        categoryLabel: "장면 단서",
        title: "장면을 떠올릴 단서",
        lead: selectedLead(context, "공간, 사물, 분위기를 떠올리게 하는 시각 단서입니다."),
        bullets: ensureBullets([
          bullet("공간", place || environment),
          bullet("사물", objects),
          bullet("분위기", environment),
        ], "장면 단서", cleanedDetail),
        detail: cleanedDetail,
        evidenceLabel: evidenceText ? compactReaderText(evidenceText, 120) : undefined,
        debug: commonDebug,
      }
    case "reentry_recap":
      return {
        chipLabel: "복귀",
        categoryLabel: "다시 읽기",
        title: "다시 읽기 전에 기억할 것",
        lead: selectedLead(context, "쉬었다가 돌아왔을 때 필요한 직전 흐름을 복구하는 단서입니다."),
        bullets: ensureBullets([
          bullet("직전 흐름", summary || cleanedDetail),
          bullet("인물", cast),
          bullet("장소", place),
        ], "복귀 단서", cleanedDetail),
        detail: cleanedDetail,
        evidenceLabel: evidenceText ? compactReaderText(evidenceText, 120) : undefined,
        debug: commonDebug,
      }
    default:
      return {
        chipLabel: base.chipLabel,
        categoryLabel: base.categoryLabel,
        title: base.title,
        lead: selectedLead(context, "읽기 흐름을 보완하는 짧은 단서입니다."),
        bullets: ensureBullets([
          bullet("단서", base.preview || cleanedDetail),
        ], "단서", cleanedDetail),
        detail: cleanedDetail,
        evidenceLabel: evidenceText ? compactReaderText(evidenceText, 120) : undefined,
        debug: {
          parsedFrom: fieldCount > 0 ? "structured_body" : "legacy_body",
          rawTitle: unit.title,
          rawBody: unit.body,
        },
      }
  }
}
