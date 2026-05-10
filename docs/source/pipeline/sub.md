# Pipeline: SUB.1, SUB.2, SUB.3, SUB.4

이 문서는 현재 `Story-Visualization` 저장소에서 `SUB` 브랜치가 실제로 어떻게 구현되어 있는지 정리한다.

관련 구현 파일:

- `src/lib/pipeline/sub1.ts`
- `src/lib/pipeline/sub2.ts`
- `src/lib/pipeline/sub3.ts`
- `src/lib/pipeline/sub4.ts`

---

## 현재 상태

| Stage | 구현 위치 | 현재 상태 | 비고 |
|---|---|---|---|
| SUB.1 | `src/lib/pipeline/sub1.ts` | 구현 완료 | scene 내부 subscene candidate proposal |
| SUB.2 | `src/lib/pipeline/sub2.ts` | 구현 완료 | candidate별 local state extraction |
| SUB.3 | `src/lib/pipeline/sub3.ts` | 구현 완료 | validation / merge |
| SUB.4 | `src/lib/pipeline/sub4.ts` | 구현 완료 | reader-facing intervention packaging |

현재 SUB 브랜치 출력은 `FINAL.1`과 `ReaderScreen`에 직접 연결된다.

---

## SUB.1 - Subscene Proposal

### 역할

- scene 내부 narrative pivot 후보를 제안

### 입력

- `GroundedSceneModel`
- `ScenePackets`

### 출력

- `SubsceneProposals`

주요 필드:

- `candidate_id`
- `start_pid`, `end_pid`
- `label`
- `shift_type`
- `boundary_reason`
- `trigger_event`
- `local_focus`
- `confidence`
- `evidence`

### run_id

```ts
const runId = `subscene_proposal__${docId}__${chapterId}`
```

---

## SUB.2 - Subscene State Extraction

### 역할

- 각 candidate span을 local progression unit으로 정리

### 입력

- `SubsceneProposals`
- `ScenePackets`
- `GroundedSceneModel`

### 출력

- `SubsceneStates`

주요 필드:

- `local_goal`
- `action_summary`
- `action_mode`
- `active_cast`
- `key_objects`
- `problem_state`
- `emotional_tone`
- `causal_input`
- `causal_result`
- `narrative_importance`

### run_id

```ts
const runId = `subscene_state__${docId}__${chapterId}`
```

---

## SUB.3 - Subscene Validation

### 역할

- proposal/state를 합쳐 accept / merge / reject 판단

### 입력

- `SubsceneProposals`
- `SubsceneStates`
- `ScenePackets`
- `GroundedSceneModel`

### 출력

- `ValidatedSubscenes`

주요 필드:

- `validated_subscenes`
- `original_count`
- `accepted_count`
- `merged_count`
- `rejected_count`

### run_id

```ts
const runId = `subscene_validated__${docId}__${chapterId}`
```

---

## SUB.4 - Intervention Packaging

### 역할

- validated subscene를 reader-facing hint package로 변환

### 입력

- `ValidatedSubscenes`
- `ScenePackets`
- `GroundedSceneModel`

### 출력

- `InterventionPackages`

주요 필드:

- `subscene_ui_units[].title`
- `subscene_ui_units[].one_line_summary`
- `subscene_ui_units[].global_view`
- `subscene_ui_units[].character_units`
- `subscene_ui_units[].pair_units`
- `subscene_ui_units[].priority`
- `subscene_ui_units[].jump_targets`

### 구현 메모

- `scene_relations_json`
- `prev_end_state_json`
- `subscenes_json`

을 LLM 입력으로 사용한다.

### run_id

```ts
const runId = `intervention_packages__${docId}__${chapterId}`
```

---

## 현재 구현 메모

- 현재 저장소에서는 SUB 브랜치가 이미 reader-facing hint의 핵심 역할을 일부 맡고 있다.
- 다만 이 힌트는 여전히 scene/subscene local 정보에 강하게 묶여 있다.

---

## 개선 필요 지점

### 1. SUB.3는 scene packet 정렬을 array index에 의존한다

현재 `proposalLog.packets[i]`, `stateLog.packets[i]`, `packetLog.packets[i]`, `validatedLog.validated[i]`를 같은 scene으로 본다.

문제:

- 중간 결과 순서가 변하면 잘못된 scene끼리 합쳐질 위험

권장 개선:

- `scene_id` 기반 join으로 변경

### 2. SUB.3는 count 필드를 LLM 응답에 의존한다

현재 구현은 `accepted_count`, `merged_count`, `rejected_count`를 LLM 응답에서 그대로 사용한다.

문제:

- 실제 `validated_subscenes` 길이와 count가 불일치할 수 있음

권장 개선:

- 최종 배열 기준으로 count를 재계산

### 3. SUB.4는 이전 scene context를 `prevPacket.end_state`에 주로 의존한다

문제:

- relation 변화나 장기 causal linkage는 잘 반영되지 않을 수 있음

권장 개선:

- 이후 support memory가 생기면 SUB.4 또는 SUP branch가 이전 scene/event retrieval을 같이 쓰도록 확장

### 4. SUB 브랜치는 local support에는 강하지만 document-aware support에는 한계가 있다

예를 들어:

- re-entry recap
- long-range causal bridge
- recurring relation change

같은 지원은 SUB만으로 만들기 어렵다.

권장 개선:

- SUB 이후 별도 SUPPORT branch 도입
