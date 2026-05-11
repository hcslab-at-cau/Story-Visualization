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

export function compactReaderText(text: string, maxLength = 120): string {
  const normalized = cleanSupportText(text)
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1).trim()}…`
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
