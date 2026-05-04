# Pipeline: STATE.1, STATE.2, STATE.3

이 문서는 현재 `Story-Visualization` 저장소에서 `STATE.1 ~ STATE.3`이 실제로 어떻게 구현되어 있는지 정리한다.

관련 구현 파일:

- `src/lib/pipeline/state1.ts`
- `src/lib/pipeline/state2.ts`
- `src/lib/pipeline/state3.ts`

---

## 현재 상태

| Stage | 구현 위치 | 현재 상태 | 비고 |
|---|---|---|---|
| STATE.1 | `src/lib/pipeline/state1.ts` | 구현 완료 | 규칙 기반 state tracking |
| STATE.2 | `src/lib/pipeline/state2.ts` | 구현 완료 | LLM state validation |
| STATE.3 | `src/lib/pipeline/state3.ts` | 구현 완료 | 규칙 기반 boundary detection + optional LLM title generation |

---

## STATE.1 - State Tracking

### 역할

- paragraph 단위 상태 추적
- active cast, current place, time signal을 누적적으로 정리

### 입력

- `EntityGraph`
- `RawChapter`

### 출력

- `StateFrames`

주요 필드:

- `observed.cast / place / time`
- `state.active_cast`
- `state.primary_place`
- `transitions.cast_enter`
- `transitions.cast_exit_candidates`
- `transitions.place_set`
- `transitions.place_shift`
- `transitions.time_signals`

### 구현 특징

- cast는 sliding window 기반 유지
- place는 score-based persistence / shift 판단
- time은 현재 상태값보다 signal 중심으로 다룸

### run_id

```ts
const runId = `state_tracking__${docId}__${chapterId}`
```

---

## STATE.2 - State Validation

### 역할

- STATE.1 결과를 LLM으로 검증하고 canonical name 기준의 scene-facing state로 정리

### 입력

- `StateFrames`
- `EntityGraph`
- `RawChapter`
- `ContentUnits`

### 출력

- `RefinedStateFrames`

주요 필드:

- `validated_state.current_place`
- `validated_state.mentioned_place`
- `validated_state.active_cast`
- `validated_state.weak_exit_candidates`
- `actions[]`

### run_id

```ts
const runId = `state_validated__${docId}__${chapterId}`
```

---

## STATE.3 - Boundary Detection

### 역할

- validated state frame 사이의 변화를 이용해 scene boundary 후보를 점수화
- 최종 `SceneSpan[]` 생성
- 선택적으로 LLM scene title 생성

### 입력

- `RefinedStateFrames`
- optional `StateFrames`
- optional `LLMClient`
- optional `paragraphMap`

### 출력

- `SceneBoundaries`

주요 필드:

- `boundaries`
- `scenes`
- `scene_titles`

### 점수 요소

- place shift
- place re-establish
- cast turnover
- time signal

### 후처리

- 근접 boundary 경쟁 해소
- minimum scene length 강제
- optional LLM title generation

### run_id

```ts
const runId = `boundary_detection__${docId}__${chapterId}`
```

---

## 현재 구현 메모

- `STATE.3`은 완전 비-LLM 단계가 아니라, title generation이 붙으면 optional LLM 사용 단계다.
- UI 상에서도 `STATE.3`은 model 입력을 받을 수 있다.

---

## 개선 필요 지점

### 1. 현재 time modeling이 약하다

지금 구조에서는 time이 `current_time`으로 안정적으로 유지되기보다 `time_signals` 중심으로만 작동한다.

문제:

- 장면 전환은 잡아도, scene-level 시간 상태를 지원물로 재사용하기에는 약함

권장 개선:

- `validated_state`에 time state를 명시적으로 추가
- explicit / inferred time normalization 분리

### 2. STATE.3의 cast turnover 계산은 재검토가 필요하다

현재 구현의 cast turnover 계산은 heuristic이며, 값 해석이 직관적이지 않다.

문제:

- scene boundary 민감도가 불안정할 수 있음
- boundary 품질이 scene/sub/final 전체에 영향

권장 개선:

- symmetric difference 기반 turnover 정의로 단순화
- regression sample로 boundary score tuning

### 3. STATE.3 title generation 실패 시 품질 편차가 크다

현재 title generation은 optional이고 실패 시 빈 title map이 반환될 수 있다.

권장 개선:

- fallback title rule 추가
- 예: place + key action 기반 deterministic title 초안 생성

### 4. boundary scoring 근거를 더 풍부하게 남길 필요가 있다

현재는 reason type은 남지만, 지원 단계에서 바로 쓰기에는 설명력이 부족하다.

권장 개선:

- boundary candidate에 요약 텍스트 또는 human-readable delta 추가
- 이후 `Boundary Delta Chips`에서 재사용 가능하게 정리
