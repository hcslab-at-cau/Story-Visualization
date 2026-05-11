import type { UiLocale } from "@/lib/ui-strings"
import type { ReadinessStatus } from "@/types/readiness"

export const READINESS_STRINGS: Record<UiLocale, {
  panel: {
    eyebrow: string
    title: string
    description: string
    refresh: string
    loading: string
    error: string
    selectedRun: string
    effectiveRun: string
    bookRun: string
    graph: string
    recommendations: string
    noRecommendations: string
    statusLabels: Record<ReadinessStatus, string>
  }
  nrg: {
    eyebrow: string
    title: string
    description: string
    loading: string
    empty: string
    claims: string
    relations: string
    total: string
    safety: string
    supportKind: string
    all: string
    evidence: string
  }
}> = {
  ko: {
    panel: {
      eyebrow: "실행 정합성",
      title: "Graph / BOOK.0 / Reader Support 준비 상태",
      description: "현재 선택한 run이 graph projection, cross-chapter memory, Reader support를 표시할 수 있는지 점검합니다.",
      refresh: "상태 새로고침",
      loading: "준비 상태를 확인하는 중...",
      error: "준비 상태를 불러오지 못했습니다.",
      selectedRun: "선택 run",
      effectiveRun: "Reader 사용 run",
      bookRun: "BOOK.0",
      graph: "Graph",
      recommendations: "필요 작업",
      noRecommendations: "필요한 추가 작업이 없습니다.",
      statusLabels: {
        ready: "준비됨",
        warning: "주의",
        missing: "없음",
        unknown: "확인 필요",
      },
    },
    nrg: {
      eyebrow: "NRG.0",
      title: "Narrative Relation Graph claims",
      description: "BOOK.0에서 현재 reader position 기준으로 사용 가능한 state/event/place/relation/causal claim을 파생합니다.",
      loading: "claim을 불러오는 중...",
      empty: "표시할 claim이 없습니다. BOOK.0을 먼저 생성하거나 scene/run 연결을 확인하세요.",
      claims: "claims",
      relations: "relations",
      total: "전체",
      safety: "safety filter",
      supportKind: "support kind",
      all: "전체",
      evidence: "근거",
    },
  },
  en: {
    panel: {
      eyebrow: "Run readiness",
      title: "Graph / BOOK.0 / Reader Support readiness",
      description: "Checks whether the selected run can display graph projection, cross-chapter memory, and Reader support.",
      refresh: "Refresh readiness",
      loading: "Checking readiness...",
      error: "Failed to load readiness.",
      selectedRun: "Selected run",
      effectiveRun: "Reader run",
      bookRun: "BOOK.0",
      graph: "Graph",
      recommendations: "Recommended actions",
      noRecommendations: "No additional action is required.",
      statusLabels: {
        ready: "Ready",
        warning: "Warning",
        missing: "Missing",
        unknown: "Check",
      },
    },
    nrg: {
      eyebrow: "NRG.0",
      title: "Narrative Relation Graph claims",
      description: "Derives reader-position-safe state/event/place/relation/causal claims from BOOK.0.",
      loading: "Loading claims...",
      empty: "No claims to show. Build BOOK.0 first or check scene/run links.",
      claims: "claims",
      relations: "relations",
      total: "total",
      safety: "safety filter",
      supportKind: "support kind",
      all: "All",
      evidence: "Evidence",
    },
  },
}

