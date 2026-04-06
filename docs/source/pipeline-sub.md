# Pipeline: SUB Branch

`Story-Visualization`에서 SUB 브랜치는 포트돼 있지만, 현재 UI는 원본 Streamlit의 전용 SUB 탭들을 제공하지 않는다.  
그래서 이 문서는 "무엇을 계산하는가"와 "현재 저장소에서 어떻게 쓰이는가"를 같이 적는다.

---

## 현재 상태

| Stage | 현재 위치 | 상태 | 비고 |
|---|---|---|---|
| SUB.1 | `src/lib/pipeline/sub1.ts` | 포트됨 | scene 단위 proposal |
| SUB.2 | `src/lib/pipeline/sub2.ts` | 포트됨 | candidate별 local state |
| SUB.3 | `src/lib/pipeline/sub3.ts` | 포트됨 | validation / merge |
| SUB.4 | `src/lib/pipeline/sub4.ts` | 포트됨 | reader-facing intervention packaging |

이 브랜치의 출력은 현재 최종적으로 `FINAL.1`과 `ReaderScreen`에서 소비된다.

## 단계별 이전 결과

| Stage | 필요 입력 | 이전 단계 기준 |
|---|---|---|
| SUB.1 | `GroundedSceneModel`, `ScenePackets` | SCENE.3, SCENE.1 필요 |
| SUB.2 | `SubsceneProposals`, `ScenePackets`, `GroundedSceneModel` | SUB.1, SCENE.1, SCENE.3 필요 |
| SUB.3 | `SubsceneProposals`, `SubsceneStates`, `ScenePackets`, `GroundedSceneModel` | SUB.1, SUB.2, SCENE.1, SCENE.3 필요 |
| SUB.4 | `ValidatedSubscenes`, `ScenePackets`, `GroundedSceneModel` | SUB.3, SCENE.1, SCENE.3 필요 |

---

## 공통 흐름

```text
SCENE.3
  -> SUB.1 propose subscenes
  -> SUB.2 extract subscene state
  -> SUB.3 validate / merge
  -> SUB.4 package intervention UI
```

---

## SUB.1 - Subscene Proposal

### 현재 구현 파일

`src/lib/pipeline/sub1.ts`

### 역할

scene 내부에서 narrative pivot 후보를 recall 위주로 제안한다.

### 입력

- `GroundedSceneModel`
- `ScenePackets`

### 출력

`SubsceneProposals`

핵심 필드:

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

### 현재 구현 파일

`src/lib/pipeline/sub2.ts`

### 역할

SUB.1 후보 각각에 대해 local narrative state를 채운다.

### 출력

`SubsceneStates`

핵심 필드:

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

### 현재 구현 파일

`src/lib/pipeline/sub3.ts`

### 역할

SUB.1 후보와 SUB.2 상태를 합쳐 accept / merge / reject 판단을 내린다.

### 출력

`ValidatedSubscenes`

핵심 필드:

- `validated_subscenes`
- `original_count`
- `accepted_count`
- `merged_count`
- `rejected_count`

### 현재 TS 포트의 중요한 차이

원본 Python 구현은 `rejected_count`를 다시 계산하는 로직이 있었지만,  
현재 TS 포트는 LLM 응답에 들어온 count를 그대로 사용한다.

즉 현재 구현은:

```ts
packets.push({
  scene_id: packet.scene_id,
  validated_subscenes: result.validated_subscenes ?? [],
  original_count: result.original_count ?? 0,
  accepted_count: result.accepted_count ?? 0,
  merged_count: result.merged_count ?? 0,
  rejected_count: result.rejected_count ?? 0,
})
```

### run_id

```ts
const runId = `subscene_validated__${docId}__${chapterId}`
```

---

## SUB.4 - Intervention Packaging

### 현재 구현 파일

`src/lib/pipeline/sub4.ts`

### 역할

validated subscene를 reader UI에 가까운 패키지로 바꾼다.

### 입력

- `ValidatedSubscenes`
- `ScenePackets`
- `GroundedSceneModel`

### 출력

`InterventionPackages`

핵심 필드:

- `subscene_ui_units[].title`
- `subscene_ui_units[].one_line_summary`
- `subscene_ui_units[].cast_buttons`
- `subscene_ui_units[].info_buttons`
- `subscene_ui_units[].priority`
- `subscene_ui_units[].jump_targets`

### 구현 메모

이전 scene context는 `packetLog.packets[i - 1]`의 `end_state`를 그대로 사용한다.

### run_id

```ts
const runId = `intervention_packages__${docId}__${chapterId}`
```

---

## UI 연결 지점

현재 SUB 브랜치 결과는 독립된 SUB 화면보다 `FINAL.1` 내부에서 실제로 쓰인다.

- `SUB.3` -> subscene nav / body paragraph slicing / panel buttons
- `SUB.4` -> character popover text source

즉 지금 Next.js UI에서는 SUB 단계의 결과를 "별도 검토 화면"으로 보기보다  
"reader packet을 만들기 위한 중간 구조"로 이해하는 편이 맞다.
