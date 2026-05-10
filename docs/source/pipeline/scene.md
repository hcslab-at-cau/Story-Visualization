# Pipeline: SCENE.1, SCENE.2, SCENE.3

이 문서는 현재 `Story-Visualization` 저장소에서 `SCENE.1 ~ SCENE.3`이 실제로 어떻게 구현되어 있는지 정리한다.

관련 구현 파일:

- `src/lib/pipeline/scene1.ts`
- `src/lib/pipeline/scene2.ts`
- `src/lib/pipeline/scene3.ts`

---

## 현재 상태

| Stage | 구현 위치 | 현재 상태 | 비고 |
|---|---|---|---|
| SCENE.1 | `src/lib/pipeline/scene1.ts` | 구현 완료 | 규칙 기반 scene packet builder |
| SCENE.2 | `src/lib/pipeline/scene2.ts` | 구현 완료 | LLM scene index extraction |
| SCENE.3 | `src/lib/pipeline/scene3.ts` | 구현 완료 | rule precheck + LLM validation |

---

## SCENE.1 - Scene Packet Builder

### 역할

- `STATE.3`에서 정한 scene span을 downstream-friendly packet으로 정리
- 이후 LLM 단계가 packet만 보고도 scene을 처리할 수 있게 만듦

### 입력

- `SceneBoundaries`
- `RefinedStateFrames`
- `StateFrames`
- `EntityGraph`
- `RawChapter`

### 출력

- `ScenePackets`

주요 필드:

- `scene_text_with_pid_markers`
- `start_state`
- `end_state`
- `scene_cast_union`
- `scene_current_places`
- `scene_mentioned_places`
- `scene_time_signals`
- `phase_markers`
- `entity_registry`

### run_id

```ts
const runId = `scene_packet__${docId}__${chapterId}`
```

---

## SCENE.2 - Scene Index Extraction

### 역할

- scene packet을 scene-level semantic index로 변환

### 입력

- `ScenePackets`

### 출력

- `SceneIndexDraft`

주요 필드:

- `scene_summary`
- `scene_place`
- `scene_time`
- `onstage_cast`
- `mentioned_offstage_cast`
- `main_actions`
- `goals`
- `relations`
- `objects`
- `environment`

### run_id

```ts
const runId = `scene_index__${docId}__${chapterId}`
```

---

## SCENE.3 - Scene Validation

### 역할

- SCENE.2 결과를 규칙 precheck + LLM 검증으로 grounded scene model로 보정

### 입력

- `ScenePackets`
- `SceneIndexDraft`
- `EntityGraph`
- `RefinedStateFrames`

### 출력

- `GroundedSceneModel`

주요 필드:

- `validated_scene_index`
- `dropped_items`
- `downgraded_items`
- `merged_items`
- `validation_notes`

### 현재 precheck 범위

- evidence pid가 scene 범위를 벗어나는지
- `onstage_cast`가 `scene_cast_union`에 있는지
- `actual_place`가 current place가 아니라 mentioned place만 아닌지

### run_id

```ts
const runId = `scene_validated__${docId}__${chapterId}`
```

---

## 현재 구현 메모

- SCENE branch는 이미 실제 reader-support용 구조의 중심이다.
- 이후 SUPPORT branch를 만들더라도 대부분 `SCENE.3` 결과를 주 기준으로 쓰게 된다.

---

## 개선 필요 지점

### 1. SCENE.2 output normalization이 약하다

현재 `scene2.ts`는 LLM 결과를 강한 정규화 없이 `SceneIndex`로 밀어 넣는 편이다.

문제:

- 필드 형식이 조금만 흔들려도 downstream 품질이 불안정해질 수 있음

권장 개선:

- field별 normalizer 추가
- evidence structure, confidence, grounding_type 정규화 강화

### 2. SCENE.3는 packet/index 정렬을 array index에 의존한다

현재 구현은 `packetLog.packets[i]`와 `indexLog.indices[i]`를 같은 scene으로 본다.

문제:

- 중간 stage 출력 순서가 흔들리면 잘못된 scene pair validation 가능

권장 개선:

- `scene_id` 기반 join으로 변경

### 3. SCENE.3 precheck가 최소한만 수행한다

현재 precheck는 useful하지만 범위가 좁다.

추가로 점검할 만한 것:

- relation subject/object가 registered entity인지
- goal holder가 onstage / offstage 규칙과 맞는지
- object/environment evidence quality
- duplicate item merge candidates

### 4. scene-level causal structure가 아직 약하다

SCENE.3는 action / goal / relation은 뽑지만, 지원 단계에서 바로 쓰기 좋은 `event-level causality`는 아직 부족하다.

권장 개선:

- support memory용 event extraction을 scene 단계 직후에 붙이기
