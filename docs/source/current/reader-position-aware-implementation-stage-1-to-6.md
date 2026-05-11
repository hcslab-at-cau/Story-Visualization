# Reader-position-aware recovery 구현 계획 1-6

## 목표

이번 구현의 목표는 support를 더 많이 만드는 것이 아니라, 현재 reader support가 다음 질문에 답할 수 있게 만드는 것이다.

- 현재 선택한 run이 Graph, BOOK.0, Reader support를 표시할 준비가 되었는가?
- support unit은 어떤 memory edge, claim, evidence에서 왔는가?
- 현재 scene에서 어떤 narrative claim이 spoiler-safe하게 사용 가능한가?
- `/api/support-context`는 support kind별로 필요한 context만 가져오는가?
- support unit은 grounding, usefulness, intrusion, spoiler risk 기준으로 검증되는가?
- Reader runtime은 reader state에 따라 support 노출을 조절하는가?

## 구현 범위

### 1. Run readiness / missing artifact diagnostic

`/api/run-readiness`를 추가한다. 이 API는 현재 `docId`, `chapterId`, `runId` 기준으로 다음을 점검한다.

- selected run에 `ENT.3`, `SUP.0`, `SUP.7`, `FINAL.1`, `FINAL.2`가 있는지
- graph projection node/edge가 있는지
- 최신 `BOOK.0`이 있는지
- `BOOK.0.chapterRunIds[chapterId]`가 어떤 run을 가리키는지
- Reader가 실제로 읽을 effective run에 `FINAL.1`이 있는지

UI에서는 `RunReadinessPanel`로 표시한다. 문제가 있으면 "Projection rebuild", "SUP.7/FINAL.1 rerun", "BOOK.0 run mismatch"처럼 원인을 직접 보여준다.

### 2. Provenance drill-down

Graph edge와 Reader support unit이 단순 label이 아니라 다음 정보를 노출해야 한다.

- source stage
- source artifact/run
- evidence count and text preview
- claim/support score
- 왜 visible/on-demand/suppressed인지

1차 구현에서는 Graph edge detail과 Reader support score/evidence detail을 확장한다.

### 3. NRG.0 Narrative Relation Graph materialized view

전용 graph DB는 아직 도입하지 않는다. 대신 `BOOK.0`에서 claim-level view를 생성하는 deterministic layer를 추가한다.

`NarrativeClaim`은 다음 정보를 가진다.

- claim id/type/text
- subject/object refs
- evidence refs
- support level
- confidence
- reveal position
- spoiler risk
- narrative scope
- source run id

초기 claim source는 `BOOK.0.sceneRefs`, `BOOK.0.edges`, `BOOK.0.entityThreads`이다.

### 4. RET.1 support-context v2

기존 `/api/support-context`를 유지하되, 응답에 `narrativeClaims`를 추가한다. support kind별 filtering은 다음처럼 적용한다.

- `causal_bridge`: causal claim/edge 중심
- `spatial_continuity`, `visual_context`: place claim/edge 중심
- `character_focus`, `reference_repair`, `relation_delta`: relation/entity claim 중심
- `snapshot`, `boundary_delta`, `reentry_recap`: 현재 scene state와 incoming edge 중심

모든 retrieval은 reader position 이전에 reveal된 scene만 허용한다.

### 5. SUP.V verifier / usefulness scorer

별도 LLM 호출은 아직 추가하지 않는다. 1차 구현은 rule-based verifier로 충분하다.

검증 기준:

- grounding score가 낮으면 suppress
- confidence가 낮으면 suppress
- spoiler risk가 높으면 suppress
- intrusion cost가 높으면 suppress
- redundancy key가 중복이면 suppress
- evidence가 없는 strong inference는 downgrade

기존 `SUP.6` policy와 `BOOK.0` enrichment에 verifier를 적용한다.

### 6. Runtime Support Governor 2.0

Reader runtime에서 다음 signal을 사용한다.

- session re-entry gap
- scene boundary entry
- long pause
- backscroll
- support open count / fatigue
- visual usefulness

정책:

- default visible은 최대 1개 유지
- high fatigue이면 default visible을 on-demand로 내린다
- backscroll/long pause가 있으면 state recovery support를 on-demand에서 더 위로 올린다
- re-entry recap은 session gap이 충분할 때만 노출한다
- visual support는 usefulness가 낮으면 suppress한다

## 구현 후 확인

- `npm run lint`
- `npm run build`
- Graph 탭에서 readiness panel이 selected run mismatch를 설명하는지 확인
- Graph 탭에서 NRG claim inspector가 현재 scene 기준 claim을 보여주는지 확인
- Reader에서 support card의 evidence/score/provenance가 표시되는지 확인
- Reader에서 long pause/backscroll signal이 governor 상태에 반영되는지 확인

