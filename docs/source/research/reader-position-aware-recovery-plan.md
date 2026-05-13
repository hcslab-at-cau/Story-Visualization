# Reader-position-aware Recovery System 계획

## 1. 이 문서의 목적

이번 대화와 2026-05-13 발표자료 검토에서 얻은 결론은 분명하다.

현재 프로젝트는 더 많은 요약, 더 예쁜 이미지, 더 많은 support card를 만드는 방향으로 가면 연구적으로 약하다. 다음 단계의 핵심은 독자의 현재 위치에서 situation model이 흔들리는 지점을 찾고, cross-chapter narrative memory와 evidence-grounded graph를 이용해 가장 작은 support만 제공하는 것이다.

이 문서는 기존 문서의 내용을 대체하지 않는다. 역할은 다음과 같다.

- `reader-support-design.md`: 어떤 support form이 가능한지 정리한 inventory
- `narrative-relation-graph.md`: graph-shaped intermediate representation 제안
- `evaluation-plan.md`: support 효과를 어떻게 평가할지 정리
- 이 문서: 위 세 문서를 현재 구현과 연결해 다음 구현 순서를 정한다

## 2. 이번 대화에서 확정된 판단

### 2.1 유지할 것

`SUP.0`은 계속 핵심이다.

현재 `SUP.0`은 scene, event, edge memory를 만든다. `BOOK.0` cross-chapter memory도 이 `SUP.0`을 모아서 chapter를 넘는 thread를 만든다. 이 구조는 버릴 것이 아니라 `Narrative Relation Graph`의 원천 데이터로 봐야 한다.

`SUP.1`부터 `SUP.7`까지도 완전히 버릴 필요는 없다. 이미 stage artifact, inspector, FINAL.1/ReaderScreen 연결이 만들어져 있기 때문이다. 다만 의미를 바꿔야 한다.

기존 해석:

```text
SUP.1~SUP.7 = scene별 reader support card를 미리 만들어 FINAL.1에 넣는 단계
```

권장 해석:

```text
SUP.1~SUP.7 = reader problem별 support candidate를 생성하고 display plan까지 만드는 단계
```

실제 노출은 Reader runtime의 Support Governor가 결정해야 한다.

### 2.2 바꿔야 할 것

현재 구조에서 가장 약한 부분은 support 노출 정책이다.

현재 구현은 `priority`가 높은 support unit을 선택하고, `before_text`, `beside_visual`, `on_demand` slot에 배치한다. 이 방식은 첫 구현으로는 충분하지만 다음 한계가 있다.

- 독자가 실제로 헷갈렸는지 모른다.
- 같은 scene에 support가 너무 많이 노출될 수 있다.
- cross-chapter memory가 support generation에 충분히 주입되지 않는다.
- confidence, spoiler risk, intrusion cost가 없다.
- 왜 이 support가 지금 보여졌는지 설명하기 어렵다.

따라서 다음 단계는 "좋은 support를 더 많이 생성"하는 것이 아니라 "틀리거나 방해되는 support를 숨기는 계층"을 추가하는 것이다.

### 2.3 연구 framing

가장 방어 가능한 연구 주장은 다음이다.

```text
우리는 long-form fiction을 위한 reader-position-aware narrative graph를 구축하고,
그 graph에서 현재 독자의 situation model 복구에 필요한 support를
spoiler-safe, evidence-grounded, low-intrusion 방식으로 제공한다.
```

피해야 할 주장:

- LLM으로 소설을 요약한다.
- 소설 이미지를 생성한다.
- 소설용 KG/RAG를 만들었다.
- character graph를 보여준다.

위 주장은 이미 관련 연구가 많거나, 현재 연구의 차별점을 충분히 설명하지 못한다.

## 3. 기존 Narrative RAG를 그대로 쓰기 어려운 이유

기존 Narrative RAG와 GraphRAG 연구는 반드시 참고해야 한다. 하지만 그대로 가져오면 이 프로젝트의 핵심 문제를 충분히 풀지 못한다.

### 3.1 기존 연구의 중심 문제

가까운 연구들은 대체로 다음 문제를 푼다.

- 긴 narrative에 대해 QA를 잘한다.
- temporal, causal, character consistency를 보존한다.
- long-document QA를 위해 grounded KG를 만든다.
- screenplay 전체의 narrative world representation을 평가한다.

예를 들어 E2RAG는 entity graph와 event graph를 분리해 temporal/causal reasoning을 강화한다. ComoRAG는 stateful memory workspace로 long narrative reasoning을 한다. STAGE는 full screenplay의 KG construction, event summarization, QA, role-playing을 하나의 benchmark로 묶는다. GroundedKG-RAG는 sentence-grounded KG index로 long-document QA를 한다.

### 3.2 우리 프로젝트의 중심 문제

우리 문제는 QA가 아니다.

핵심 질문은 다음이다.

```text
현재 독자가 이 scene에 있을 때,
이 정보를 지금 보여주는 것이 도움이 되는가,
아니면 spoiler이거나 방해인가?
```

그래서 우리 graph와 retrieval layer는 다음 정보를 반드시 알아야 한다.

- reader position
- reveal timing
- spoiler risk
- narrative scope
- evidence reference
- confidence
- support가 해결하려는 reader problem
- support의 intrusion cost
- runtime trigger condition

이 metadata가 없으면 일반 Narrative RAG는 "질문에 대한 답"은 줄 수 있지만, "독서 중 필요한 순간의 최소 support"는 결정하기 어렵다.

## 4. 최종 아키텍처 방향

권장 구조는 다음과 같다.

```text
Validated artifacts
  ENT.3 / STATE.3 / SCENE.3 / SUB.3 / VIS.*
        |
        v
SUP.0 chapter-local support memory
        |
        v
BOOK.0 cross-chapter memory snapshot
        |
        v
NRG.0 reader-position-aware narrative relation graph
        |
        v
BOOK.1 / RET.1 support context retrieval
        |
        v
SUP.1~SUP.5 support candidate generators
        |
        v
SUP.V verifier + usefulness scorer
        |
        v
SUP.6 policy selection
        |
        v
SUP.7 display plan
        |
        v
RUNTIME.0 Reader-State & Support Governor
        |
        v
Reader UI + interaction logging
```

중요한 변화는 `SUP.7`이 최종 표시 결과가 아니라 후보와 runtime rule을 담은 display plan이 된다는 점이다.

## 5. 데이터 계약 변경

### 5.1 SupportUnit 확장

현재 `SupportUnit`은 `kind`, `label`, `title`, `body`, `priority`, `display_mode`, `evidence` 중심이다. 다음 필드를 추가해야 한다.

```ts
type ReaderProblem =
  | "boundary_update"
  | "state_recovery"
  | "causal_gap"
  | "reference_ambiguity"
  | "character_reentry"
  | "relation_delta"
  | "spatial_disorientation"
  | "session_reentry";

interface SupportUnitV2 {
  unit_id: string;
  scene_id: string;
  kind: SupportUnitKind;
  reader_problem: ReaderProblem;
  title: string;
  body: string;
  evidence: SupportEvidenceRef[];
  source_stage_ids: string[];

  confidence: number;
  grounding_score: number;
  usefulness_score: number;
  intrusion_cost: number;
  redundancy_cost: number;
  spoiler_risk: "none" | "low" | "medium" | "high";

  default_display: "visible" | "expandable" | "trigger_only" | "suppressed";
  trigger_preconditions: SupportTriggerCondition[];
  suppression_reason?: SupportSuppressionReason;
  redundancy_key?: string;
}
```

`priority`는 유지해도 되지만 최종 판단 기준이 되어서는 안 된다. `priority`는 중요도이고, 실제 노출에는 usefulness, intrusion, confidence, spoiler risk가 함께 필요하다.

### 5.2 NarrativeClaim 추가

support unit의 prose만 저장하면 재검증과 재사용이 어렵다. graph와 support 사이에 claim 단위가 필요하다.

```ts
interface NarrativeClaim {
  claim_id: string;
  claim_type: "state" | "event" | "relation" | "causal" | "place" | "goal";
  subject_refs: string[];
  object_refs: string[];
  text: string;

  evidence_refs: SupportEvidenceRef[];
  support_level: "explicit" | "strong_inference" | "weak_inference";
  confidence: number;

  reveal_start: ReaderPosition;
  reveal_end?: ReaderPosition;
  spoiler_risk: "none" | "low" | "medium" | "high";

  scope:
    | "actual"
    | "memory"
    | "imagination"
    | "hypothetical"
    | "dialogue_claim"
    | "unreliable"
    | "metaphor";

  source_run_id: string;
}
```

scope가 중요한 이유는 fiction에서는 상상, 회상, 거짓말, 비유, 대화 속 주장, 미래 암시가 모두 등장하기 때문이다. 이것을 actual storyworld state처럼 저장하면 reader support가 잘못된 정보를 줄 수 있다.

### 5.3 ReaderSession / ReaderEvent 추가

Support Governor는 reader state가 없으면 동작할 수 없다.

```ts
interface ReaderSession {
  session_id: string;
  doc_id: string;
  reader_id?: string;
  current_chapter_id: string;
  current_scene_id: string;
  current_pid?: number;
  last_active_at: string;
  last_scene_key?: string;
  support_fatigue_score: number;
}

interface ReaderSupportEvent {
  event_id: string;
  session_id: string;
  scene_key: string;
  unit_id: string;
  action: "shown" | "opened" | "dismissed" | "suppressed";
  reason?: string;
  created_at: string;
}
```

초기에는 개인화까지 갈 필요는 없다. 하지만 session gap, shown/opened/suppressed reason은 평가를 위해 반드시 남겨야 한다.

## 6. 신규 subsystem 계획

### 6.1 NRG.0 Narrative Relation Graph Materializer

목적:

`SUP.0`과 `BOOK.0`을 graph query가 가능한 document-level memory로 정규화한다.

입력:

- `ENT.3`
- `STATE.3`
- `SCENE.3`
- `SUB.3`
- `SUP.0`
- `BOOK.0`

출력:

- scene node
- event node
- entity thread node
- relation state node
- place state node
- causal / temporal / place / cast / relation edge
- claim-level evidence / scope / reveal metadata

초기 구현은 Firestore projection으로 충분하다. Neo4j 같은 전용 GraphDB는 지금 당장 필요하지 않다.

### 6.2 RET.1 Support Context Retriever

목적:

현재 scene과 support kind를 기준으로 필요한 subgraph만 가져온다.

예상 API:

```text
GET /api/support-context
  ?docId=...
  &chapterId=...
  &sceneId=...
  &readerPosition=...
  &supportKind=causal_bridge
```

응답:

```json
{
  "current_scene": {},
  "current_event": {},
  "prior_events": [],
  "causal_edges": [],
  "relation_history": [],
  "entity_threads": [],
  "place_chain": [],
  "evidence_refs": [],
  "safety_filter_result": {}
}
```

이 layer가 생겨야 `SUP.3` causal bridge와 `SUP.4` relation delta가 chapter-local 한계를 넘을 수 있다.

### 6.3 SUP.V Verifier / Usefulness Scorer

목적:

생성된 support candidate를 바로 UI로 보내지 않고, 신뢰도와 방해 비용을 계산한다.

초기 scoring은 LLM보다 rule-based로 시작한다.

```text
final_score =
  usefulness_score
  * grounding_score
  * confidence
  - intrusion_cost
  - redundancy_cost
  - spoiler_penalty
```

Verifier가 해야 할 일:

- evidence가 claim을 실제로 지지하는지 확인
- weak inference를 explicit claim처럼 보이지 않게 downgrade
- reveal_start 이후 정보만 허용
- scope가 `actual`이 아닌 claim은 reader-facing wording에서 명확히 표시
- visual support가 unsupported detail을 암시하면 suppress

### 6.4 RUNTIME.0 Support Governor

목적:

Reader 화면에서 실제로 무엇을 보여줄지 결정한다.

입력:

- reader position
- session gap
- current scene boundary salience
- support candidates
- support scores
- previously shown support
- support fatigue
- user interactions

결정:

- show nothing
- show one boundary chip
- show collapsed current-state strip
- enable on-demand causal bridge
- trigger re-entry recap
- show reference repair on tap
- suppress VIS

기본 정책:

- 항상 보이는 support는 최대 0~1개
- causal / relation / evidence는 기본적으로 on-demand
- re-entry / reference repair / VIS는 trigger-only
- score가 애매하면 더 길게 설명하지 말고 숨긴다

## 7. Reader UI 계획

### 7.1 기본 원칙

Reader UI는 본문 우선이어야 한다.

support의 목표는 독자를 분석 모드로 끌어내는 것이 아니라, 이야기의 현재 상태로 다시 돌아오게 하는 것이다.

### 7.2 권장 노출 정책

기본 visible:

- Boundary Delta Chip 또는 Current-State Strip 중 하나
- 한 화면에 최대 1개

on-demand:

- Causal Bridge
- Character Focus
- Relation Delta
- Evidence Quote
- Spatial Chain

trigger-only:

- Re-entry Recap
- Reference Repair
- VIS / schematic

### 7.3 Cross-chapter Memory Panel의 재해석

현재 Reader의 Cross-chapter Memory Panel은 디버그와 연구자 확인에는 유용하다. 다만 독자 UI의 최종 형태로는 다소 분석적이다.

장기적으로는 다음과 같이 바꿔야 한다.

- Bridges 탭의 raw edge card를 곧바로 보여주지 않는다.
- 현재 scene에 필요한 edge 1~2개만 Memory Bridge로 변환한다.
- evidence는 기본 숨김 처리한다.
- Thread는 global list가 아니라 현재 scene의 reappearing entity만 보여준다.
- Path는 전체 graph가 아니라 현재 위치 anchor로만 보여준다.

## 8. SUP stage 재정의

### 8.1 현재 stage 유지안

기존 stage 이름을 유지하면 구현 변경 비용이 낮다.

```text
SUP.0  Support Memory
SUP.1  Shared Support Context
SUP.2  Snapshot / Boundary Candidate Generator
SUP.3  Causal Bridge Candidate Generator
SUP.4  Character / Relation Candidate Generator
SUP.5  Re-entry / Reference / Spatial Candidate Generator
SUP.V  Verifier / Usefulness Scorer
SUP.6  Policy Selection
SUP.7  Reader Support Display Plan
```

### 8.2 장기 stage 통합안

장기적으로는 너무 많은 stage가 관리 비용이 될 수 있다. UI와 저장 구조가 안정화되면 다음처럼 묶을 수 있다.

```text
SUP.0  Memory Source
SUP.1  Retrieval Context
SUP.2  Candidate Generation
SUP.3  Verify / Score / Policy
SUP.4  Display Plan
```

하지만 지금은 이미 `SUP.0~SUP.7` inspector와 실행 UI가 있으므로, 당장은 기존 번호를 유지하고 `SUP.V`만 추가하는 편이 현실적이다.

## 9. 구현 마일스톤

### M0. 문서와 타입 정합성 정리

목표:

- 이 문서 기준으로 `reader-support-design`, `reader-support-pipeline`, `narrative-relation-graph`, `evaluation-plan`의 표현을 맞춘다.
- 현재 구현은 static MVP이고, 다음 목표는 runtime-aware recovery system이라는 점을 문서에 명확히 남긴다.

### M1. SupportUnit schema 확장

작업:

- `reader_problem`
- `confidence`
- `grounding_score`
- `usefulness_score`
- `intrusion_cost`
- `redundancy_cost`
- `spoiler_risk`
- `trigger_preconditions`
- `suppression_reason`

주의:

기존 artifact와의 호환을 위해 optional field로 시작한다.

### M2. BOOK.1 / RET.1 retrieval API

작업:

- `BOOK.0`에서 현재 scene 기준 incoming/outgoing edge를 반환한다.
- entity thread, place chain, relation history를 support kind별로 필터링한다.
- `readerPosition` 이후 정보는 safety filter로 제거한다.

첫 버전은 deterministic retrieval로 충분하다.

초기 구현 상태:

- `/api/support-context` GET endpoint를 추가했다.
- 입력은 `docId`, `chapterId`, `sceneId`, 선택적 `bookRunId`, `supportKind`, `readerPid`다.
- `BOOK.0` snapshot을 읽어 현재 scene 기준 incoming/outgoing edge, causal edge, place chain, entity thread, nearby scene, evidence ref를 반환한다.
- 현재 reader position 이후 scene/edge/thread occurrence는 safety filter에서 제거한다.
- 이 API는 아직 SUP.1~SUP.7 생성에 자동 주입되지는 않았고, 다음 단계에서 `SUP.V`/Support Governor와 연결한다.

### M3. SUP.V rule-based scorer

작업:

- 기존 `priority` 기반 selected_units를 score 기반으로 바꾼다.
- low confidence, redundant, too intrusive, spoiler risk reason을 저장한다.
- selected/deferred/suppressed를 분리한다.

### M4. SUP.7 display plan 전환

작업:

- 기존 `ReaderSupportPacket`을 유지하되, 새 `ReaderSupportPlan`을 추가한다.
- `default_visible`, `expandable`, `trigger_only`, `suppressed`를 분리한다.
- FINAL.1은 backward compatibility를 위해 기존 slot도 계속 읽을 수 있게 둔다.

### M5. Reader Support Governor

작업:

- default visible max 1 rule 적용
- session gap 기반 re-entry recap trigger
- support opened/dismissed/shown logging
- VIS usefulness low이면 기본 suppress

초기 구현 상태:

- `src/lib/support-governor.ts`를 추가했다.
- `ReaderScreen`이 `ReaderSupportPacket.display_plan`을 우선 해석한다.
- 기본 visible support는 최대 1개로 제한한다.
- `trigger_only` support는 기본으로 숨기고, `reentry_recap`은 10분 이상 session gap이 있을 때만 on-demand로 올린다.
- 이전 artifact처럼 `display_plan`이 없는 support packet은 기존 slot을 읽되, `before_text`는 최대 1개로 제한한다.
- 아직 서버 저장형 interaction logging은 구현하지 않았고, 현재는 브라우저 `localStorage`의 last-active timestamp만 사용한다.

### M6. Evaluation logging

작업:

- support candidate 수
- 실제 노출 수
- opened / dismissed / suppressed reason
- scene navigation time
- re-entry gap
- support overload signal

이 로그는 나중에 qualitative study와 artifact quality annotation을 연결하는 핵심 데이터가 된다.

## 10. 1차 실험 범위

처음부터 모든 support를 평가하면 조건이 너무 많다.

1차 범위:

- Boundary Delta Chip
- Current-State Snapshot
- Causal Bridge
- Re-entry Recap

비교 조건:

- no support
- generic scene summary
- targeted snapshot + boundary chip
- targeted snapshot + causal bridge
- re-entry recap vs generic recap

측정:

- scene-state reconstruction
- causal linkage recall
- place continuity recovery
- re-entry time
- helpfulness
- intrusion / overload

초기 논문 주장은 전반적 reading comprehension 향상이 아니라, 현재 scene state recovery와 re-entry recovery에 좁혀야 한다.

## 11. VIS에 대한 계획

VIS는 버리지 않는다. 하지만 기본 answer로 두지 않는다.

추가할 필드:

- `visual_usefulness_score`
- `visual_primary_role`
- `canonical_place_key`
- `not_reliable_for`
- `schematic_fallback_available`

노출 조건:

- 새로운 장소 진입
- 이동, 추적, 탐색처럼 공간 관계가 action 이해에 중요함
- recurring place re-entry
- place chain이 현재 scene 이해에 중요함

suppress 조건:

- 내면 독백
- 관계 뉘앙스 중심 대화
- 핵심 어려움이 causality 또는 goal인 장면
- 이미지가 unsupported object/place/character detail을 암시할 위험이 큰 장면

## 12. 관련 연구에서 얻은 설계 근거

### Situation model / Event indexing

Event-Indexing Model은 narrative event가 time, space, protagonist, causality, intentionality 축으로 연결된다고 설명한다.

설계 반영:

- support taxonomy를 UI form이 아니라 reader problem axis에서 정의한다.
- Boundary Chip, Snapshot, Causal Bridge, Reference Repair는 각각 흔들린 축을 복구한다.

### Event boundary / interruption

Temporal shift와 scene boundary는 독자가 situation model을 업데이트해야 하는 지점이다. interruption 후에는 위치와 맥락 복구 비용이 생긴다.

설계 반영:

- scene boundary 직후 delta signal을 제공한다.
- session gap 이후 re-entry recap을 1회 제공한다.

### JITAI

JITAI는 적절한 시점에 적절한 양의 support를 제공하기 위해 decision point, tailoring variable, decision rule을 사용한다.

설계 반영:

- Support Governor를 runtime layer로 둔다.
- 항상 보여주는 정보보다 show/defer/suppress decision을 핵심 기능으로 본다.

### Graphics / illustration research

그래픽은 평균적으로 도움될 수 있지만, extraneous detail은 attention을 빼앗고 comprehension을 낮출 수 있다.

설계 반영:

- VIS는 optional modality다.
- usefulness score가 낮으면 suppress한다.
- realistic image가 불안정하면 schematic fallback을 쓴다.

### Narrative RAG / KG

NarrativeQA, BookSum, NovelQA, E2RAG, ComoRAG, STAGE, GroundedKG-RAG는 long narrative understanding과 graph/RAG의 필요성을 보여준다.

설계 반영:

- 기존 RAG는 baseline과 component idea로 사용한다.
- 우리 핵심은 reader-position-aware, spoiler-safe, scope-aware support retrieval이다.

## 13. 주요 참고 문헌과 자료

- Zwaan, Langston, Graesser (1995), Event-Indexing Model: https://cir.nii.ac.jp/crid/1363670320125828224
- Speer & Zacks (2005), Temporal changes as event boundaries: https://bpb-us-w2.wpmucdn.com/sites.wustl.edu/dist/e/952/files/2017/09/speermemlang05-20ut2xs.pdf
- Jo, Kim, Seo (2015), EyeBookmark: https://hcil.snu.ac.kr/research/eyebookmark
- Nahum-Shani et al., JITAI framework overview: https://pmc.ncbi.nlm.nih.gov/articles/PMC11272684/
- Guo et al. (2020), Graphics meta-analysis: https://colab.ws/articles/10.1177%2F2332858420901696
- Eng, Godwin, Fisher (2020), Keep it simple: https://www.nature.com/articles/s41539-020-00073-5
- Marvista: https://arxiv.org/abs/2207.08401
- Portrayal: https://arxiv.org/abs/2308.04056
- StoryExplorer: https://arxiv.org/abs/2411.05435
- Story Ribbons: https://arxiv.org/abs/2508.06772
- NarrativeQA: https://arxiv.org/abs/1712.07040
- BookSum: https://arxiv.org/abs/2105.08209
- NovelQA: https://novelqa.github.io/
- FABLES: https://arxiv.org/abs/2404.01261
- E2RAG / ChronoQA: https://arxiv.org/abs/2506.05939
- ComoRAG: https://arxiv.org/abs/2508.10419
- STAGE: https://arxiv.org/abs/2601.08510
- GroundedKG-RAG: https://arxiv.org/abs/2604.04359

## 14. 최종 계획 문장

다음 구현의 목표는 support card를 더 많이 만드는 것이 아니다.

목표는 다음이다.

```text
현재 독자 위치에서 situation model 복구에 필요한 최소 support를
cross-chapter narrative memory와 evidence-grounded graph에서 검색하고,
grounding / spoiler / usefulness / intrusion 기준으로 검증한 뒤,
Support Governor가 필요한 순간에만 노출하는 구조를 만든다.
```

이 구조가 완성되어야 현재 engineering prototype이 하나의 논문 기여로 방어 가능해진다.

## 15. 구현 기록: NRG 기반 SUP.7 보강

2026-05-08 구현에서 `SUP.7`은 더 이상 chapter-local support package만 저장하지 않는다. 처음에는 최신 `BOOK.0` cross-chapter memory snapshot을 함께 읽고, 현재 scene 이전까지 spoiler-safe하게 필터링된 incoming edge를 `ReaderSupportPlan`의 후보 support로 주입했다.

2026-05-12 이후 구현에서는 이 경로를 한 단계 정리했다. `BOOK.0` edge를 바로 `SupportUnit`으로 바꾸는 대신, 우선 `BOOK.0`에서 파생한 NRG.0 reader-safe claim view를 조회하고, 현재 scene을 대상으로 하는 `causal` / `place` / `relation` claim을 support 후보로 변환한다. 직접 BOOK edge 변환은 NRG 후보가 없을 때만 fallback으로 남긴다.

반영된 방식:

- NRG `causal` claim은 `causal_bridge` support unit으로 변환한다.
- NRG `place` claim은 `spatial_continuity` support unit으로 변환한다.
- NRG `relation` claim은 `character_focus` support unit으로 변환한다.
- NRG 기반 support는 기본 노출하지 않고 `expandable` / `reader_request` 대상으로 둔다.
- 각 unit에는 `reader_problem`, `confidence`, `grounding_score`, `usefulness_score`, `intrusion_cost`, `spoiler_risk`, `claims`, `reader_copy`, `anchor_hint`, `redundancy_key`를 포함한다.
- `source_stage_ids`는 `NRG.0`, `BOOK.0`을 함께 기록해, support가 reader-safe claim view에서 왔지만 원천은 BOOK.0임을 드러낸다.

이 결정의 이유는 cross-chapter memory를 단순히 Graph 탭에서 확인하는 데이터로 두지 않고, Reader가 실제로 사용할 수 있는 support retrieval 재료로 연결하기 위해서다. 동시에 BOOK edge를 그대로 support로 쓰는 구조보다, reader position과 spoiler filter를 거친 claim layer를 거치게 만드는 편이 연구 주장에 더 잘 맞는다. 다만 기본 visible support는 여전히 최대 1개로 제한한다. cross-chapter support는 인과/공간/인물 맥락을 복구하는 데 중요하지만, 본문 흐름을 방해할 위험도 있으므로 기본 정책은 on-demand다.

## 16. 구현 기록: Reader support interaction logging

2026-05-08 구현에서 Reader 화면은 support unit이 실제로 독자에게 노출되었는지 기록하기 시작한다. 이 기록은 support generation 품질 평가뿐 아니라, Support Governor가 너무 자주 개입하는지 또는 독자가 어떤 종류의 support를 실제로 열어보는지 분석하기 위한 최소 로그다.

저장 위치:

- `documents_v2/{docId}/support_events/{eventId}`

현재 기록하는 이벤트:

- `shown`: `before_text` 영역에 기본 노출된 support unit
- `opened`: `More reading support` 또는 `Cast / place / visual cues` 접힘 영역을 독자가 펼쳤을 때의 support unit

저장 필드:

- `doc_id`, `session_id`, `scene_key`, `chapter_id`, `scene_id`, `reader_run_id`
- `unit_id`, `unit_kind`, `reader_problem`
- `action`, `reason`, `created_at`

이 단계에서는 privacy-sensitive한 세부 행동을 많이 저장하지 않고, support exposure와 explicit open만 남긴다. 다음 단계에서 필요하면 `dismissed`, `suppressed`, `backscroll`, `long_pause`, `reference_tap`을 추가한다. 연구적으로 중요한 것은 “어떤 support가 생성되었는가”가 아니라 “어떤 support가 실제 reader state에서 사용되었는가”이므로, 이 로그는 이후 정성 연구와 policy ablation의 기본 자료가 된다.

## 17. 구현 기록: VIS usefulness policy

2026-05-08 구현에서 VIS는 기본 노출되는 정답형 support가 아니라, usefulness score에 따라 기본 노출 또는 minimized 상태로 분기되는 modality가 되었다.

현재 rule 기반 score 입력:

- 이미지 또는 blueprint 사용 가능 여부
- `visual.chips` 수
- overlay character anchor 수
- 현재 support 후보 중 `spatial_continuity`, `visual_context` 존재 여부
- scene title/summary/support body 안의 공간/이동 관련 단서
- 대화/내면 중심 단서가 공간 단서보다 많은지 여부

Reader 화면 정책:

- `showImageByDefault=true`이면 기존처럼 이미지/overlay를 기본 노출한다.
- usefulness가 낮지만 이미지가 있으면 `Visual support minimized` 접힘 영역으로 이동한다.
- 이미지와 blueprint가 모두 없으면 큰 빈 이미지 프레임을 보여주지 않고, 짧은 unavailable notice만 보여준다.
- Support Governor는 `visualUseful=false`일 때 `visual_context` support를 runtime-suppressed로 계산한다.

이 변경의 목적은 VIS를 제거하는 것이 아니라, 공간 상황모델 복구에 실제로 도움이 될 가능성이 높은 장면에서만 독자의 주의를 요구하게 만드는 것이다. 이후에는 VIS.* artifact 자체에 `visual_usefulness_score`, `visual_primary_role`, `not_reliable_for`, `schematic_fallback_available` 같은 필드를 저장하는 방향으로 확장한다.
