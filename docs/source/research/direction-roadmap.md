# 연구 방향 및 마일스톤 로드맵

## 1. 현재 현실

현재 구현은 유용한 prototype이지만, 아직 강한 기술적 기여라고 보기는 어렵다.

현재 시스템의 큰 형태:

```text
EPUB 파싱
  -> 단계별 LLM 호출
  -> JSON 정리
  -> 산출물 저장
  -> 점검 UI
  -> 선택적 이미지 생성
```

이 구조는 좋은 engineering infrastructure이지만,
연구 주장으로는 아직 약하다.

다음 연구 단계는 단순히

- prompt만 개선
- scene image만 더 잘 생성
- LLM 출력에서 final reader card를 더 많이 뽑기

가 되어서는 안 된다.

대신 다음으로 가야 한다.

`noisy한 LLM/stage output을 reliable하고 evidence-grounded하며 reader-position-aware한 narrative relation graph로 변환`

그리고 여러 support를 graph projection으로 생성해야 한다.

## 2. 제안하는 연구 논지

작업 가설:

> 우리는 검증된 fiction-analysis artifact로부터 reader-position-aware narrative relation graph를 구성한다. LLM이 바로 reader support를 생성하게 하지 않고, 먼저 scene-state difference에서 narrative relation candidate를 도출하고, evidence와 narrative-scope 제약으로 검증한 뒤, 그 graph에서 여러 spoiler-safe reader-support artifact를 생성한다.

짧게 쓰면:

```text
검증된 scene 산출물
  -> 상태 차이 기반 관계 후보
  -> 범위/근거 보정
  -> 독자 위치 인지형 narrative graph
  -> 다중 support 산출물
```

이렇게 해야 기여가 단순 API orchestration을 넘어간다.

## 3. 가능한 기술적 기여

### 3.1 Reader-position-aware Narrative Relation Graph

모든 node, edge, support claim이 다음을 가지는 graph:

- evidence reference
- confidence
- reveal timing
- spoiler risk
- source run

이 점이 generic story knowledge graph와 다르다.

### 3.2 State-diff Guided Relation Candidate Generation

관계를 전부 LLM에게 찾게 하는 대신,
구조화된 state 변화에서 edge candidate를 먼저 도출한다.

- place change -> `place_shift`
- time change -> `time_shift`
- cast turnover -> `cast_shift`
- goal/thread change -> `goal_shift`, `thread_continuation`
- relation change -> `relationship_delta`
- event/result link -> `causal`, `enables`, `blocks`, `resolves`

이렇게 하면 LLM은 주 생성기가 아니라 verifier/classifier가 된다.

### 3.3 Narrative Scope-aware Correction

다음 범주를 구분해야 한다.

- actual storyworld state
- memory
- imagination
- hypothetical statement
- metaphor
- dialogue claim
- unreliable claim

예를 들어 imagined place가 actual location처럼 저장되는 오류를 줄이는 데 직접 연결된다.

### 3.4 Evidence-grounded Correction Loop

graph claim을 저장하기 전에 다음을 체크한다.

- evidence가 존재하는가
- evidence가 claim을 실제로 지지하는가
- claim이 scope를 위반하지 않는가
- current reader position에서 안전한가
- entity/place ID가 canonical한가
- duplicate edge가 아닌가

### 3.5 One Graph, Many Supports

같은 graph에서 여러 support를 생성해야 한다.

- Resume Card
- Shift Bridge
- Situation Snapshot
- Timeline
- Relation Delta
- Spatial Map
- Visual Support Spec
- Interaction Button

즉 연구 기여는 "support 하나"가 아니라 "재사용 가능한 support-generation layer"에 있다.

## 4. 핵심 연구 질문

권장 primary RQ:

- validated fiction-analysis artifact에서 reader-position-aware relation graph를 안정적으로 구성할 수 있는가?
- graph-derived support가 generic summary나 direct LLM support보다 recovery에 더 유용한가?
- reveal timing과 scope 제약이 spoiler risk를 실제로 줄이는가?

권장 secondary RQ:

- place / time / cast / goal / relation / causal edge 중 어떤 축이 support quality에 가장 크게 기여하는가?
- graph를 만들 때 rule-first + LLM-verify가 direct LLM generation보다 안정적인가?

## 5. 제안하는 마일스톤

### M1. Evidence + Reveal Index

- paragraph / pid 기반 evidence index 구축
- reveal timing과 reader position 제약 정의

### M2. Canonical Scene State Ledger

- scene/subscene memory 정규화
- place / cast / goal / relation state를 stable하게 기록

### M3. Narrative Relation Candidate Layer

- state diff 기반 edge candidate 도출
- place_shift / goal_shift / relation_delta / causal link 후보 생성

### M4. Scope + Evidence Correction Loop

- 잘못된 edge와 unsafe edge 제거
- confidence / support_level 정리

### M5. Reader-position-aware Narrative Graph

- scene / chapter / thread 단위 그래프 완성
- support branch와 연결

### M6. Graph-derived Support Evaluation

- generic summary, direct LLM support, graph-derived support 비교

## 6. 지금 구현과의 연결

현재 코드에서 graph 입력으로 특히 중요한 것은:

- `ENT.3`
- `STATE.2`
- `STATE.3`
- `SCENE.1`
- `SCENE.3`
- `SUB.2`
- `SUB.3`

반대로 직접 graph canonical input으로 쓰기보다 보조적으로 보는 것이 나은 것:

- `ENT.1`
- `ENT.2`
- `SCENE.2`
- `SUB.4`

즉, 지금 파이프라인은 버릴 것이 아니라 graph-building 이전 단계로 재해석하면 된다.

## 7. 최종 권장 방향

가장 강한 연구 방향은 다음 한 줄로 요약된다.

`stage output을 곧바로 support로 쓰지 말고, evidence-linked narrative relation graph로 한 번 더 정제한 뒤 support를 생성한다.`

이 방향이 engineering prototype을 더 강한 research contribution으로 바꿔줄 가능성이 가장 크다.
