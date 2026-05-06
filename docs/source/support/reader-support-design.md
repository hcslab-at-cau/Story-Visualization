# Reader Support 설계 제안

## 1. 문제 재정의

이 프로젝트의 다음 단계는 단순히 "더 긴 요약"을 만드는 것이 아니다.

진짜 목표는 다음과 같다.

- 독자의 현재 situation model 복구
- scene/state tracking이 무너졌을 때 빠른 회복 지원
- 지금 이 순간 필요한 최소한의 정보 제공
- evidence와 causal grounding을 유지한 support 생성

2026-04-13 미팅 자료와 JCCI 발표 자료는 같은 방향을 가리킨다.

- scene segmentation과 scene representation이 기반
- support는 shared scene representation에서 파생되어야 함
- image는 여러 형태 중 하나일 뿐
- causal linkage, state recovery, re-entry support가 image만큼 중요함

이 문서는 `SUM / IDX / CAU / VIS`를 넘어서 더 넓은 support space를 다시 보고,
어떤 형태가 실제로 가치가 큰지와 구현 방향을 함께 정리한다.

---

## 2. 현재 시스템 읽기

현재 저장소에는 이미 강한 intermediate structure가 있다.

지금 확보된 구조:

- chapter text와 paragraph ID
- mention / entity clustering
- paragraph-level state tracking과 scene boundary
- cast / place / time이 집계된 scene packet
- actions / goals / relations / objects / environment를 가진 grounded scene index
- subscene-level local state와 intervention packaging
- scene blueprint와 image generation branch

관련 구현 파일:

- `src/types/schema.ts`
- `src/lib/pipeline/scene1.ts`
- `src/lib/pipeline/scene3.ts`
- `src/lib/pipeline/sub2.ts`
- `src/lib/pipeline/sub4.ts`
- `src/lib/pipeline/final1.ts`
- `src/lib/pipeline/vis1.ts`
- `src/lib/pipeline/vis2.ts`
- `src/lib/firestore.ts`

현재 한계:

- 저장 구조가 거의 `document -> chapter -> run -> artifact` 중심
- reasoning이 여전히 chapter-local
- event, recurring entity, causal edge, relation change를 위한 stable doc-level memory가 없음
- final reader support가 `scene packet + local subscene hint + optional image`에 치우쳐 있음

그래서 다음 단계는 다음 순서로 가야 한다.

1. doc-level support memory 구축
2. 그 memory에서 여러 support form 생성
3. reader state와 trigger timing에 따라 어떤 support를 보여줄지 결정

---

## 3. 설계 원칙

support form은 다음 한 질문으로 평가해야 한다.

`이 support가 raw rereading보다 더 빨리 독자를 현재 이야기 상태에 다시 연결해 주는가?`

좋은 support는 보통 다음 네 가지를 만족한다.

- local: 현재 scene/subscene에 붙어 있음
- contrastive: 무엇이 바뀌었는지 강조함
- grounded: evidence span이나 source state를 가리킬 수 있음
- selective: metadata를 한꺼번에 쏟아붓지 않음

반대로 나쁜 support는 보통 다음 이유로 실패한다.

- 너무 global함
- 지나치게 장식적임
- evidence 없이 과하게 추론함
- 읽는 순간에 비해 너무 조밀함

---

## 4. 확장된 Support Inventory

## 4.1 핵심 형태: 가장 강한 후보

이 형태들은 연구 목표와 현재 파이프라인 구조에 가장 잘 맞는다.

### A. Current-State Snapshot

목적:

- "지금 어디이고, 누가 있고, 무슨 일이 벌어지고 있지?"에 답함

독자 문제:

- 시간 / 장소 / 인물 / 목표 정렬을 놓침

출력 형태:

- 3~5개의 짧은 줄
- `place`
- `active cast`
- `immediate goal`
- `local problem`
- `why this moment matters`

강한 이유:

- 인지 부하가 가장 낮음
- situation-model recovery와 바로 연결됨
- 혼란 상황과 re-entry 상황 둘 다에 유용

### B. Boundary Delta Chips

목적:

- scene/subscene 전환 신호를 작은 조각으로 보여줌

독자 문제:

- place / time / cast / goal 변화 신호를 놓침

출력 형태:

- 문장 근처나 경계 근처에 붙는 짧은 chip
- 예:
  - `Place shift`
  - `Rabbit exits`
  - `Goal changes`
  - `Flashback begins`

강한 이유:

- "딱 필요한 만큼" 보여주는 방식에 잘 맞음
- always-on support로 두기 좋음
- 현재 state delta에서 비교적 싸게 계산 가능

### C. Causal Bridge

목적:

- "왜 지금 이런 일이 생겼지?"에 답함

독자 문제:

- 현재 사건을 일으킨 이전 원인을 잊어서 현재 장면이 뜬금없게 느껴짐

출력 형태:

- 짧은 causal sentence 1개
- 필요하면 2단 구조:
  - `Earlier: ...`
  - `So now: ...`

강한 이유:

- 발표 자료에서 가장 중요하게 언급된 failure mode를 직접 다룸
- 현재 `SUB.2 causal_input/result`를 기반으로 시작할 수 있지만, 실제로는 doc-level linking이 필요함

### D. Character Focus Card

목적:

- "이 장면에서 이 인물은 무엇을 하고, 무엇을 원하지?"에 답함

독자 문제:

- 인물이 많거나 대화가 길면 각 인물의 현재 역할이 흐려짐

출력 형태:

- active character별 on-demand card
- `role in this beat`
- `current intention`
- `constraint`
- `recent change`

강한 이유:

- 현재 `SUB.4 character_units`와 잘 이어짐
- dialogue-heavy scene에서 특히 유용

### E. Relation Delta Card

목적:

- "두 인물 사이에서 무엇이 바뀌었지?"에 답함

독자 문제:

- 이름은 기억하지만 social alignment 변화는 놓치기 쉬움

출력 형태:

- pair-level short card
- `before`
- `now`
- `change`
- `why it matters`

강한 이유:

- relation change는 단순 cast listing보다 훨씬 중요할 때가 많음
- current pipeline의 scene relations, pair-level hint slot과 연결 가능

### F. Spatial Continuity Card

목적:

- "어떻게 여기까지 왔지?" 또는 "지금 이 공간이 어떤 곳이지?"에 답함

독자 문제:

- 이동이 많거나 nested space가 복잡한 경우 공간 감각 붕괴

출력 형태:

- 간단한 place chain 또는 공간 메모
- `previous place -> current place`
- `current space cues`
- `mentioned but not current places`

강한 이유:

- narrative comprehension의 spatial updating 연구와 잘 맞음
- full map보다 더 가볍고 안정적임

### G. Re-entry Recap

목적:

- 독서를 쉬었다가 다시 들어왔을 때 빠르게 복귀 지원

독자 문제:

- 오랜만에 돌아와서 scene momentum이 사라짐

출력 형태:

- 3파트 압축:
  - `current state`
  - `most recent turning points`
  - `unfinished tension`

강한 이유:

- 실제 사용 시나리오가 매우 분명함
- 단순 retrospective summary와 달리 현재 reading point에 맞춰 anchor됨

### H. Reference Repair

목적:

- 지시어, 호칭, 역할 지칭을 빠르게 풀어줌

독자 문제:

- "he", "she", 직함, 가족 호칭, 역할 호칭이 길어질수록 누군지 흐려짐

출력 형태:

- 짧은 alias resolution
- `he = Mr. X`
- `the girl = Alice`
- `the doctor = Dr. Y`

강한 이유:

- 구현 비용 대비 체감 가치가 큼
- 긴 대화와 다인물 장면에서 특히 유용

## 4.2 보조 형태: 조건부로 유용함

### I. Scene Image

유용한 경우:

- place와 cast 배치가 중요할 때
- 장면의 spatial structure가 안정적일 때
- 이미지가 보수적이고 일관성 있게 생성될 때

하지만 이것만으로 충분하지는 않다.

- causality, relation change, local goal/problem은 image alone으로 복구하기 어려움
- 과하게 믿으면 오히려 오해를 만들 수 있음

### J. Evidence Quote Card

목적:

- support claim 뒤의 decisive text span을 보여줌

유용한 경우:

- explainability가 중요할 때
- support가 약간 inference를 포함할 때

리스크:

- 인용을 너무 많이 보여주면 읽기 흐름을 깨뜨림

### K. Goal-Problem Tracker

목적:

- local pursuit structure를 정리

유용한 경우:

- action / problem-solving 중심 narrative

리스크:

- reflective scene에서는 value가 낮을 수 있음

### L. Prediction Prompt / Reflective Question

목적:

- 단순 복구를 넘어 active reading을 유도

유용한 경우:

- 나중에 learning / engagement 효과까지 보려는 실험

리스크:

- 회복 지원보다 과제 느낌이 강해질 수 있음

## 4.3 과하거나 지금은 약한 형태

### M. Full Story Graph Viewer

- retrospective analysis에는 강함
- immediate scene recovery에는 약함
- 현재 목표에 비해 UI와 data complexity가 큼

### N. Always-visible Global Timeline

- 전체 흐름 회상에는 좋을 수 있지만
- 현재 읽기 순간에 필요한 최소 지원과는 거리가 있음

### O. Dense Knowledge Dashboard

- panel이 많아지면 reader task를 방해함
- minimal repair principle에 어긋남

### P. Heavy Image-first Interface

- support가 illustration consumption으로 기울어짐
- causal / relation repair에는 약함

---

## 5. 권장 Support Portfolio

### Tier 1: 먼저 만들 것

- Current-State Snapshot
- Boundary Delta Chips
- Causal Bridge
- Character Focus Card
- Re-entry Recap
- Reference Repair

### Tier 2: 다음 단계

- Relation Delta Card
- Spatial Continuity Card
- Scene Image
- Evidence Quote Card

### Tier 3: 조건부 / 실험용

- Goal-Problem Tracker
- Prediction Prompt
- retrospective graph / timeline tool

---

## 6. 형태별 구현 전략

### Current-State Snapshot

재사용 데이터:

- `STATE.2`
- `SCENE.3`
- `SUB.2`
- `SUB.4`

처리:

1. active scene / subscene retrieval
2. place / cast / local goal / local problem / action summary merge
3. 3~5개의 짧은 field로 압축

추가 시스템:

- `SUP.1 CurrentStateSnapshot`
- field-level evidence linking

### Boundary Delta Chips

재사용 데이터:

- `STATE.3`
- `SCENE.1`
- `SUB.3`

처리:

1. previous vs current delta 계산
2. chip vocabulary로 mapping
3. salience ranking

추가 시스템:

- `SUP.2 BoundaryDelta`
- delta scoring layer

### Causal Bridge

재사용 데이터:

- `SUB.2 causal_input / causal_result`
- `SCENE.3 actions / goals / relations`
- previous scene end state

처리:

1. subscene에서 event node 생성
2. causes / enables / blocks / reveals / escalates edge 연결
3. 현재 subscene의 prior causal parent retrieval
4. evidence 기반 짧은 bridge sentence 생성

추가 시스템:

- document-level event graph
- edge extraction / validation

### Character Focus Card

재사용 데이터:

- `ENT.3`
- `SCENE.3`
- `SUB.2`
- `SUB.4`

추가 시스템:

- character memory profile
- alias handling layer

### Relation Delta Card

재사용 데이터:

- `SCENE.3 relations`
- `SUB.4 pair_units`
- previous relation state

추가 시스템:

- relation timeline store
- pair-state diff logic

### Spatial Continuity Card

재사용 데이터:

- `STATE.2 current_place`
- `SCENE.1 current / mentioned places`
- `SCENE.3 scene_place`
- optional `VIS.1`

추가 시스템:

- place graph
- place synonym normalization

### Re-entry Recap

재사용 데이터:

- scene-level support memory 전반

추가 시스템:

- reader-state / session memory
- prior scene salience ranking

### Reference Repair

재사용 데이터:

- `ENT.3`
- local paragraph text
- scene cast
- dialogue-local participants

추가 시스템:

- mention alias table
- confidence-based filtering

### Scene Image

재사용 데이터:

- `VIS.1 ~ VIS.4`

원칙:

- image는 optional support
- image는 support metadata와 함께 제시
- image alone이 정답처럼 보이지 않게 설계

---

## 7. 추가로 필요한 시스템

### 7.1 Document-Level Support Memory

가장 중요한 누락 시스템이다.

필요한 컬렉션 예:

- `entities`
- `scene_ledger`
- `event_nodes`
- `causal_edges`
- `place_graph`
- `relation_timeline`
- `evidence_index`

### 7.2 Shared Support Representation

각 support form을 raw artifact에서 직접 만드는 대신,
공통 intermediate layer를 두어야 한다.

예:

- current_state
- delta_from_previous
- local_event
- causal_parent_candidates
- active_characters
- relation_candidates
- place_transition
- evidence_index

### 7.3 Support Policy Layer

모든 support를 같은 방식으로 보여주면 안 된다.

권장 구분:

- 항상 보임:
  - Boundary Delta Chips
  - 작은 Current-State Snapshot

- click / hover:
  - Character Focus
  - Relation Delta
  - Spatial Continuity
  - Evidence Quote

- trigger-only:
  - Re-entry Recap
  - Reference Repair
  - 일부 Causal Bridge

---

## 8. 제안하는 새 Stage Layout

기존 extraction stage 이름은 유지해도 된다.

다만 `SCENE.3`와 `SUB.4` 이후에 support branch를 명시적으로 추가하는 편이 맞다.

권장 stage:

- `SUP.0` Document Memory Builder
- `SUP.1` Shared Support Representation Builder
- `SUP.2` Snapshot Generator
- `SUP.3` Delta Chip Generator
- `SUP.4` Causal Bridge Generator
- `SUP.5` Character / Relation Card Generator
- `SUP.6` Re-entry / Reference Repair Generator
- `SUP.7` Support Policy Selector

---

## 9. VIS에 대해 지금 바꾸면 좋은 점

현재 VIS는 구현 자체는 되어 있지만, reader support라는 연구 목표에 비춰 보면 재정의가 필요하다.

강점:

- semantic clarification -> blueprint -> render package -> image generation 구조가 분명함
- avoid / forbid / must_not_show logic이 있음
- environment-first 접근이 비교적 안정적임

한계:

- causal / relation / goal repair를 대신할 수 없음
- usefulness score가 없음
- recurring place continuity가 약함
- support metadata가 부족함

권장 수정:

1. `visual_usefulness_score` 추가
2. `canonical_place_key` 기반 continuity memory 추가
3. support-side metadata 추가
4. schematic fallback 모드 추가
5. image를 항상 기본 support로 쓰지 않고, support bundle 안의 한 modality로 배치

---

## 10. 실무적 구축 순서

1. doc-level memory 추가
2. `SharedSupportUnit` 추가
3. snapshot / chips / causal bridge부터 구현
4. support policy를 `FINAL.1`에 연결
5. 그 다음 VIS usefulness / continuity / fallback을 붙이기

---

## 11. 최종 권장 방향

이 프로젝트가 소수의 support form만 먼저 골라야 한다면 가장 좋은 조합은 다음이다.

- Current-State Snapshot
- Boundary Delta Chips
- Causal Bridge
- Character Focus Card
- Re-entry Recap
- Scene Image(보조 수단)

반대로 매력적으로 보이지만 지금 선두에 세우면 안 되는 것:

- full story graph viewer
- always-open timeline dashboard
- image-first interface
- 과도하게 조밀한 side panel

가장 중요한 구조적 결정은 다음 한 문장으로 요약된다.

`chapter-local artifact generation에서 document-level support memory와 selective support rendering 구조로 넘어간다.`
