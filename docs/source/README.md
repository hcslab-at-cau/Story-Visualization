# 문서 인덱스

이 디렉터리는 문서의 성격에 따라 나뉜다. 이전의 `current/`, `support/`, `review/` 폴더는 구현 문서, 제안 문서, 점검 메모가 섞여 있어서 제거했다. 현재 코드 기준 설명은 `implementation/`과 `pipeline/`을 우선 읽으면 된다.

## 폴더 구조

## `implementation/`

현재 구현된 앱 표면, 저장 구조, graph/support 연결, 인프라를 설명한다.

- `implementation/reader-support-pipeline.md`
  - 현재 reader support의 기준 문서
  - `SUP.0~SUP.7`, `BOOK.0`, `NRG.0`, `FINAL.1.support`, `ReaderScreen` 연결
  - `Knowledge Graph`, `BOOK.0`, `NRG.0`의 역할 차이

- `implementation/ui.md`
  - Upload / Pipeline / Graph / Reader 화면의 현재 동작
  - run 선택, favorite 처리, stage inspector

- `implementation/ui-graph-and-reader-support.md`
  - 그래프형 stage 선택 UI
  - Reader의 anchored support 표시 방식
  - Reader mode와 Researcher mode의 노출 차이

- `implementation/support-graph-book-visualization.md`
  - Graph tab의 `SUP`, `BOOK.0`, `NRG.0`, `Knowledge Graph` 시각화
  - 발표/데모에서 각 계층을 설명하기 위한 화면 구조

- `implementation/knowledge-graph-query-layer.md`
  - Firestore 기반 graph node/edge projection
  - `ENT.3`, `SUP.0` artifact의 query layer
  - Graph tab 조회 API와 한계

- `implementation/storage-v2-and-legacy.md`
  - `documents_v2` 기준 신규 저장 구조
  - 기존 `documents` 컬렉션 legacy 읽기 전용 접근
  - artifact payload 중복 저장을 줄이기 위한 `stageRefs` 구조

- `implementation/firebase-admin-setup.md`
  - Firebase permission-denied 원인
  - Admin SDK 환경변수 설정
  - 클라이언트 Firestore 직접 접근 제거 사항

- `implementation/epub-ingest-normalization.md`
  - EPUB chapter normalization 구현
  - 비본문 필터링, 제목 정규화, visible chapter numbering

- `implementation/ui-language-mode.md`
  - KO/EN UI language mode
  - `ui-strings.ts` 기반 copy catalog

- `implementation/infra.md`
  - LLM client, prompt loader, EPUB parser, Firestore 입출력 계층

## `pipeline/`

실제 stage 단위 파이프라인을 설명한다. 내부 stage contract나 실행 순서를 확인할 때 이 폴더를 본다.

- `pipeline/pre-ent.md`
  - `PRE.1`, `PRE.2`, `ENT.1~ENT.3`

- `pipeline/state.md`
  - `STATE.1~STATE.3`

- `pipeline/scene.md`
  - `SCENE.1~SCENE.3`

- `pipeline/sub.md`
  - `SUB.1~SUB.4`

- `pipeline/visual.md`
  - `VIS.1~VIS.4`
  - visual branch의 현재 구현과 한계

- `pipeline/final.md`
  - `FINAL.1`, `FINAL.2`, `ReaderScreen`
  - `SUP.7` support package가 reader package에 포함되는 방식

## `proposals/`

아직 완전히 구현 기준 문서가 아닌 설계, 개선안, 다음 단계 계획이다. 구현 완료 여부를 확인하려면 먼저 `implementation/reader-support-pipeline.md`를 읽는다.

- `proposals/reader-support-design.md`
  - reader support form과 설계 원칙

- `proposals/anchored-support-realization-plan.md`
  - 본문 anchor를 눌렀을 때 support kind별로 자연스럽게 보여주는 UI/content 계획
  - 독자 모드와 연구자 모드의 표시 강도, card copy, provenance 분리

- `proposals/memory-schema.md`
  - document-level support memory schema 제안

- `proposals/pipeline-stage-granularity-review.md`
  - micro stage와 macro stage를 어떻게 나눌지에 대한 검토

- `proposals/reliability-and-ops-plan.md`
  - grounding, prompt governance, observability, regression 관리

- `proposals/visual-support-proposal.md`
  - VIS 재배치, usefulness scoring, continuity, fallback 제안

- `proposals/hint-display-image-prompts/`
  - 힌트 유형별 Reader UI mockup 이미지 생성을 위한 프롬프트 묶음
  - 공통 visual brief와 각 힌트별 image-generation handoff prompt

## `research/`

연구 framing, 문헌 정리, 평가 계획을 다룬다.

- `research/direction-roadmap.md`
  - API orchestration을 넘는 연구 기여 framing
  - evidence index에서 graph-derived support로 가는 마일스톤

- `research/narrative-relation-graph.md`
  - Narrative Relation Graph 제안
  - scene state, thread ledger, scene/chapter edge 설계
  - evidence, spoiler, scope, correction-loop 요구사항

- `research/reader-position-aware-recovery-plan.md`
  - `SUP.*`, `BOOK.0`, `NRG.0`, Support Governor를 연결하는 통합 계획
  - 기존 Narrative RAG/KG와의 차별점, schema 변경, retrieval API, verifier/scorer, runtime policy

- `research/qa-grounded-reader-support-plan.md`
  - QA / reading comprehension 문헌에서 반복되는 질문 유형을 reader support taxonomy로 재정의
  - 현재 rule-based support scoring을 need probability, evidence, intrusion, spoiler risk 기반 policy로 발전시키는 계획

- `research/narrative-kg-rag-literature-review.md`
  - Narrative RAG, Narrative KG, GraphRAG, KG-RAG, long narrative benchmark 문헌 정리
  - NRG, `BOOK.0`, `SUP.*`, Support Governor에 적용할 아이디어
  - baseline, metric, NRGScore, 구현 우선순위 제안

- `research/evaluation-plan.md`
  - offline evaluation, pilot study, logging, success criteria

## `archive/`

특정 날짜의 회의/발표 정리처럼 당시 맥락을 보존하는 문서다. 최신 구현 기준 문서는 아니다.

- `archive/meeting-implementation-summary-2026-05-10.md`
  - 2026-05-10 기준 구현 내용과 다음 미팅 질문

## 권장 읽기 순서

현재 구현을 빠르게 이해하려면:

1. `implementation/reader-support-pipeline.md`
2. `pipeline/final.md`
3. `implementation/ui-graph-and-reader-support.md`
4. `implementation/support-graph-book-visualization.md`
5. `implementation/knowledge-graph-query-layer.md`
6. `implementation/storage-v2-and-legacy.md`

stage별 내부 구조를 확인하려면:

1. `pipeline/pre-ent.md`
2. `pipeline/state.md`
3. `pipeline/scene.md`
4. `pipeline/sub.md`
5. `pipeline/visual.md`
6. `pipeline/final.md`

다음 구현 계획을 잡으려면:

1. `implementation/reader-support-pipeline.md`
2. `proposals/anchored-support-realization-plan.md`
3. `proposals/pipeline-stage-granularity-review.md`
4. `proposals/reliability-and-ops-plan.md`
5. `proposals/memory-schema.md`

연구 기여 관점으로 읽으려면:

1. `research/direction-roadmap.md`
2. `research/narrative-relation-graph.md`
3. `research/reader-position-aware-recovery-plan.md`
4. `research/qa-grounded-reader-support-plan.md`
5. `research/narrative-kg-rag-literature-review.md`
6. `research/evaluation-plan.md`

## 정리 기준

- 현재 코드와 직접 맞는 문서는 `implementation/` 또는 `pipeline/`에 둔다.
- 구현 전 계획이나 다음 단계 제안은 `proposals/`에 둔다.
- 연구 주장, 문헌, 평가 설계는 `research/`에 둔다.
- 과거 회의 기록은 `archive/`에 둔다.
- 중복되거나 이전 구현을 설명하던 문서는 삭제하고, 필요한 내용은 `implementation/reader-support-pipeline.md`로 합쳤다.
