# 문서 인덱스

이 디렉터리는 문서의 역할에 따라 나뉘어 있다.

## 폴더 구조

## `current/`

현재 앱 표면과 인프라 상태를 설명하는 문서들이다.

- `current/ui.md`
  - 현재 Upload / Pipeline / Reader UI 동작
  - run 선택과 favorite 처리
  - 구현된 stage inspection view

- `current/ui-graph-and-reader-support.md`
  - 그래프형 stage 선택 UI
  - Reader 화면의 support card 배치
  - 향후 UI 개선 작업

- `current/firebase-admin-setup.md`
  - Firebase permission-denied 원인
  - Admin SDK 환경변수 설정
  - 클라이언트 Firestore 직접 접근 제거 사항

- `current/infra.md`
  - 인프라와 실행 환경 메모

## `pipeline/`

현재 실제로 구현된 파이프라인 단계를 설명하는 문서들이다.

- `pipeline/pre-ent.md`
  - PRE, ENT 단계

- `pipeline/state.md`
  - STATE 단계

- `pipeline/scene.md`
  - SCENE 단계

- `pipeline/sub.md`
  - SUB 단계

- `pipeline/visual-current.md`
  - 현재 구현된 VIS.1 ~ VIS.4 브랜치
  - 장기 목표 아키텍처가 아니라 현재 구현 문서

- `pipeline/final.md`
  - FINAL.1, FINAL.2 reader packaging 동작

## `support/`

다음 reader-support 아키텍처를 위한 설계 및 계획 문서들이다.

- `support/reader-support-design.md`
  - reader-support 형태와 설계 원칙

- `support/roadmap.md`
  - support system 실행 로드맵

- `support/memory-schema.md`
  - 문서 전역 support memory 제안

- `support/pipeline-plan.md`
  - 제안된 `SUP.*` 브랜치

- `support/support-implementation.md`
  - 이번 브랜치에서 실제 구현된 `SUP.0` ~ `SUP.7`
  - stage별 입력/출력, API route, FINAL.1 연결

- `support/reliability-and-ops-plan.md`
  - 검증, 보정, prompt governance, observability

- `support/visual-support-proposal.md`
  - VIS 재배치, usefulness scoring, continuity, fallback

## `research/`

연구 framing, 기여점, 평가 계획을 다루는 문서들이다.

- `research/narrative-relation-graph.md`
  - Narrative Relation Graph 제안
  - scene state, thread ledger, scene/chapter edge 설계
  - evidence, spoiler, scope, correction-loop 요구사항

- `research/direction-roadmap.md`
  - API orchestration을 넘는 연구 기여 framing
  - evidence index에서 graph-derived support로 가는 마일스톤
  - 기술 기여를 위한 baseline과 평가 계획

- `research/evaluation-plan.md`
  - offline evaluation, pilot study, logging, success criteria

## `review/`

구현 상태, 문서, 향후 계획 사이의 차이를 점검하는 문서들이다.

- `review/current-implementation-vs-docs.md`
  - 현재 코드 동작과 현재/제안 문서의 대응 관계
  - 어떤 문서가 구현 기반이고, 어떤 문서가 proposal-only인지 구분

- `review/implementation-alignment-review.md`
  - 이전 구현-문서 정합성 점검 메모

## 권장 읽기 순서

현재 구현부터 보고 싶다면:

1. `current/ui.md`
2. `pipeline/pre-ent.md`
3. `pipeline/state.md`
4. `pipeline/scene.md`
5. `pipeline/sub.md`
6. `pipeline/visual-current.md`
7. `pipeline/final.md`
8. `review/current-implementation-vs-docs.md`

다음 아키텍처를 보고 싶다면:

1. `support/reader-support-design.md`
2. `research/narrative-relation-graph.md`
3. `research/direction-roadmap.md`
4. `support/roadmap.md`
5. `support/memory-schema.md`
6. `support/pipeline-plan.md`
7. `support/reliability-and-ops-plan.md`

연구 기여 관점으로 보고 싶다면:

1. `research/direction-roadmap.md`
2. `research/narrative-relation-graph.md`
3. `research/evaluation-plan.md`
4. `review/current-implementation-vs-docs.md`

## 추가 문서

- `current/storage-v2-and-legacy.md`
  - `documents_v2` 기준 신규 저장 구조
  - 기존 `documents` 컬렉션 legacy 읽기 전용 접근
  - artifact payload 중복 저장을 줄이기 위한 `stageRefs` 구조

- `current/knowledge-graph-query-layer.md`
  - Firestore 기반 graph node/edge projection
  - `ENT.3`, `SUP.0` artifact의 query layer
  - graph 조회 API와 UI 동작
