import type { UiLocale } from "@/lib/ui-strings"
import type { BookMemoryEdgeType } from "@/types/book-memory"
import type { KnowledgeGraphNodeKind } from "@/types/graph"
import type { StageId } from "@/types/schema"

type SupportStageId = Extract<StageId, `SUP.${number}`>

export const VISUALIZATION_STRINGS: Record<UiLocale, {
  showcase: {
    eyebrow: string
    title: string
    description: string
    refresh: string
    loading: string
    noRun: string
    errorPrefix: string
    supportBranch: string
    dataProducts: string
    liveOutputs: string
    complete: string
    missing: string
    graphProduct: string
    graphProductBody: string
    bookProduct: string
    bookProductBody: string
    readerProduct: string
    readerProductBody: string
    noBookMemory: string
    graphProjection: string
    stageMetricFallback: string
    stages: Record<SupportStageId, { title: string; body: string; output: string }>
  }
  bookMap: {
    title: string
    description: string
    empty: string
    chapterLane: string
    edgeArcMap: string
    entityRibbons: string
    noThreads: string
    scenes: string
    events: string
    mentions: string
    edgeTypeLabels: Record<BookMemoryEdgeType, string>
  }
  graphCanvas: {
    title: string
    description: string
    empty: string
    selected: string
    shown: string
    legend: string
    edgeLimit: string
    kindLabels: Record<KnowledgeGraphNodeKind, string>
  }
}> = {
  ko: {
    showcase: {
      eyebrow: "발표용 구조 맵",
      title: "SUP, BOOK.0, Knowledge Graph가 어떻게 연결되는지 보기",
      description: "현재 선택한 run의 SUP 단계 산출물, 책 단위 BOOK.0 스냅샷, Firestore graph projection을 한 화면에서 설명할 수 있게 요약합니다.",
      refresh: "시각화 새로고침",
      loading: "구조 데이터를 불러오는 중...",
      noRun: "저장된 run을 선택하면 SUP 단계와 graph projection 상태를 볼 수 있습니다.",
      errorPrefix: "시각화 데이터를 불러오지 못했습니다.",
      supportBranch: "SUP branch",
      dataProducts: "Memory products",
      liveOutputs: "현재 산출물",
      complete: "생성됨",
      missing: "없음",
      graphProduct: "Knowledge Graph",
      graphProductBody: "ENT.3와 SUP.0을 scene, event, entity, mention node/edge로 투영합니다.",
      bookProduct: "BOOK.0",
      bookProductBody: "챕터별 SUP.0과 ENT.3를 모아 cross-chapter scene, edge, entity thread를 만듭니다.",
      readerProduct: "Reader Support",
      readerProductBody: "SUP.7 display plan과 BOOK.0 맥락을 합쳐 Reader 화면의 visible/on-demand support로 연결합니다.",
      noBookMemory: "BOOK.0 스냅샷 없음",
      graphProjection: "graph projection",
      stageMetricFallback: "artifact 있음",
      stages: {
        "SUP.0": {
          title: "Story memory",
          body: "scene, event, edge를 만드는 원천 memory입니다. BOOK.0과 graph projection이 이 결과를 사용합니다.",
          output: "scenes / events / edges",
        },
        "SUP.1": {
          title: "Shared context",
          body: "각 scene의 현재 상태, boundary delta, prior thread, 후보 support 종류를 정리합니다.",
          output: "scene contexts",
        },
        "SUP.2": {
          title: "Snapshot + boundary",
          body: "독자가 바로 필요한 현재 상태와 장면 전환 정보를 support unit으로 만듭니다.",
          output: "snapshot / boundary units",
        },
        "SUP.3": {
          title: "Causal bridge",
          body: "이전 사건이 현재 장면으로 이어지는 이유를 짧은 bridge 후보로 만듭니다.",
          output: "causal units",
        },
        "SUP.4": {
          title: "Character + relation",
          body: "현재 scene의 active cast와 relation signal을 독자용 support로 변환합니다.",
          output: "character / relation units",
        },
        "SUP.5": {
          title: "Re-entry + reference",
          body: "복귀 요약, 지시어 repair, 공간/시각 cue를 on-demand 후보로 만듭니다.",
          output: "re-entry / reference units",
        },
        "SUP.6": {
          title: "Policy selection",
          body: "usefulness, grounding, intrusion, spoiler risk를 기준으로 selected/deferred/suppressed를 나눕니다.",
          output: "selected / deferred / suppressed",
        },
        "SUP.7": {
          title: "Display plan",
          body: "Reader가 사용할 before_text, beside_visual, on_demand, runtime rule 형태로 패키징합니다.",
          output: "reader packets",
        },
      },
    },
    bookMap: {
      title: "BOOK.0 memory map",
      description: "챕터별 scene reference를 하나의 timeline으로 놓고, cross-chapter edge와 반복 entity thread를 같이 보여줍니다.",
      empty: "BOOK.0 snapshot을 빌드하면 여기에 챕터 간 memory map이 표시됩니다.",
      chapterLane: "Chapter lane",
      edgeArcMap: "Cross-chapter edge arcs",
      entityRibbons: "Entity thread ribbons",
      noThreads: "반복 entity thread가 없습니다.",
      scenes: "장면",
      events: "사건",
      mentions: "mentions",
      edgeTypeLabels: {
        chapter_sequence: "챕터 순서",
        cross_chapter_character_thread: "인물 연속",
        cross_chapter_same_place: "같은 장소",
        cross_chapter_place_shift: "장소 전환",
        cross_chapter_causal_bridge: "인과 연결",
        entity_reappearance: "재등장",
      },
    },
    graphCanvas: {
      title: "Knowledge Graph canvas",
      description: "현재 쿼리 결과를 node kind별 column으로 배치합니다. node를 누르면 주변 hop을 다시 조회합니다.",
      empty: "표시할 graph node가 없습니다.",
      selected: "선택됨",
      shown: "표시 중",
      legend: "Node kind",
      edgeLimit: "edge가 많아 일부만 그렸습니다.",
      kindLabels: {
        scene: "장면",
        event: "사건",
        character: "인물",
        place: "장소",
        entity: "엔티티",
        mention: "멘션",
      },
    },
  },
  en: {
    showcase: {
      eyebrow: "Presentation map",
      title: "How SUP, BOOK.0, and Knowledge Graph connect",
      description: "Summarize the selected run's SUP artifacts, book-level BOOK.0 snapshot, and Firestore graph projection in one explainable view.",
      refresh: "Refresh Visualization",
      loading: "Loading structure data...",
      noRun: "Select a saved run to inspect SUP stages and graph projection status.",
      errorPrefix: "Failed to load visualization data.",
      supportBranch: "SUP branch",
      dataProducts: "Memory products",
      liveOutputs: "Live outputs",
      complete: "ready",
      missing: "missing",
      graphProduct: "Knowledge Graph",
      graphProductBody: "Projects ENT.3 and SUP.0 into scene, event, entity, and mention nodes/edges.",
      bookProduct: "BOOK.0",
      bookProductBody: "Combines chapter-level SUP.0 and ENT.3 into cross-chapter scenes, edges, and entity threads.",
      readerProduct: "Reader Support",
      readerProductBody: "Combines SUP.7 display plans with BOOK.0 context into visible/on-demand Reader support.",
      noBookMemory: "No BOOK.0 snapshot",
      graphProjection: "graph projection",
      stageMetricFallback: "artifact available",
      stages: {
        "SUP.0": {
          title: "Story memory",
          body: "The source memory that creates scenes, events, and edges. BOOK.0 and graph projection both depend on it.",
          output: "scenes / events / edges",
        },
        "SUP.1": {
          title: "Shared context",
          body: "Organizes current state, boundary delta, prior threads, and candidate support kinds for each scene.",
          output: "scene contexts",
        },
        "SUP.2": {
          title: "Snapshot + boundary",
          body: "Creates current-state and scene-transition support units for immediate reader recovery.",
          output: "snapshot / boundary units",
        },
        "SUP.3": {
          title: "Causal bridge",
          body: "Creates short bridge candidates that explain why the current scene follows previous events.",
          output: "causal units",
        },
        "SUP.4": {
          title: "Character + relation",
          body: "Turns active cast and relation signals into reader-facing support candidates.",
          output: "character / relation units",
        },
        "SUP.5": {
          title: "Re-entry + reference",
          body: "Creates re-entry recaps, reference repair, and spatial/visual cues as on-demand candidates.",
          output: "re-entry / reference units",
        },
        "SUP.6": {
          title: "Policy selection",
          body: "Splits candidates into selected, deferred, and suppressed using usefulness, grounding, intrusion, and spoiler risk.",
          output: "selected / deferred / suppressed",
        },
        "SUP.7": {
          title: "Display plan",
          body: "Packages support into before_text, beside_visual, on_demand, and runtime rules for Reader.",
          output: "reader packets",
        },
      },
    },
    bookMap: {
      title: "BOOK.0 memory map",
      description: "Place chapter scene references on one timeline, then show cross-chapter edges and repeated entity threads together.",
      empty: "Build a BOOK.0 snapshot to show the cross-chapter memory map here.",
      chapterLane: "Chapter lane",
      edgeArcMap: "Cross-chapter edge arcs",
      entityRibbons: "Entity thread ribbons",
      noThreads: "No repeated entity thread.",
      scenes: "scenes",
      events: "events",
      mentions: "mentions",
      edgeTypeLabels: {
        chapter_sequence: "Chapter sequence",
        cross_chapter_character_thread: "Cast thread",
        cross_chapter_same_place: "Same place",
        cross_chapter_place_shift: "Place shift",
        cross_chapter_causal_bridge: "Causal bridge",
        entity_reappearance: "Reappearance",
      },
    },
    graphCanvas: {
      title: "Knowledge Graph canvas",
      description: "Lay out the current query result by node-kind columns. Click a node to reload its neighborhood.",
      empty: "No graph nodes to display.",
      selected: "selected",
      shown: "shown",
      legend: "Node kind",
      edgeLimit: "Some edges are hidden because the result is large.",
      kindLabels: {
        scene: "Scene",
        event: "Event",
        character: "Character",
        place: "Place",
        entity: "Entity",
        mention: "Mention",
      },
    },
  },
}
