# Support Memory 스키마 제안

## 1. 왜 memory 구조를 바꿔야 하는가

현재 저장 구조는 pipeline run 관리에는 강하지만 reader support에는 약하다.

현재 강점:

- chapter / run / stage artifact를 잘 보존함

현재 약점:

- support는 문서 전역 retrieval이 필요한 경우가 많음
- causal / relation support는 cross-scene linking이 필요함
- re-entry support는 현재 chapter artifact만으로 부족함

그래서 두 번째 저장 계층이 필요하다.

- raw extraction storage도 아니고
- UI 전용 cache도 아니며
- support generation을 위한 normalized memory 계층

이 계층은 여러 support form에서 재사용 가능한 story state를 보존해야 한다.

---

## 2. 설계 목표

memory schema는 다음을 만족해야 한다.

- document scope에서 동작
- provenance와 evidence 유지
- 가능한 경우 append-only update 지원
- run-specific artifact와 normalized memory 분리
- schema가 바뀌어도 artifact에서 재구성 가능

반대로 피해야 하는 것:

- 최종 prose summary만 저장
- reader UI state와 canonical narrative state를 혼합
- unsupported inference를 사실처럼 저장

---

## 3. 저장 철학

두 층을 구분한다.

## Layer A. Pipeline Artifacts

이미 존재하는 계층이다.

목적:

- run별 중간 산출물 보존
- debugging과 재현성

예:

- `PRE.2`
- `SCENE.3`
- `SUB.4`
- `VIS.2`

## Layer B. Support Memory

새로 제안하는 계층이다.

목적:

- support generation에 쓰이는 normalized story memory

예:

- scene ledger
- event node
- causal edge
- place graph
- relation timeline

이 두 번째 계층은 보통 `SCENE.3`, `SUB.3` 이후의 안정된 artifact에서 생성하는 편이 맞다.

---

## 4. 제안하는 Firestore 구조

루트:

`documents/{docId}/memory/`

하위 컬렉션:

- `entities`
- `scenes`
- `subscenes`
- `events`
- `edges`
- `places`
- `relations`
- `evidence`
- `support_units`
- `reader_sessions`

---

## 5. 컬렉션 정의

## 5.1 `entities`

경로:

`documents/{docId}/memory/entities/{entityId}`

목적:

- 독자 지원용 canonical entity memory

권장 필드:

- `entity_id`
- `canonical_name`
- `entity_type`
- `aliases`
- `first_seen`
- `latest_seen`
- `scene_ids`
- `chapter_ids`
- `salience_score`
- `relation_partner_ids`
- `place_associations`
- `open_questions`

메모:

- `ENT.3`를 대체하는 것이 아니라, scene/chapter를 넘어서 요약·확장하는 계층이다.

## 5.2 `scenes`

경로:

`documents/{docId}/memory/scenes/{sceneId}`

목적:

- support retrieval을 위한 안정된 scene ledger

권장 필드:

- `scene_id`
- `chapter_id`
- `scene_index_in_doc`
- `start_pid`
- `end_pid`
- `scene_title`
- `scene_summary`
- `current_place`
- `mentioned_places`
- `active_cast`
- `time_label`
- `goals`
- `main_actions`
- `key_relations`
- `previous_scene_id`
- `next_scene_id`
- `boundary_reason_summary`
- `evidence_refs`
- `source_run_id`

## 5.3 `subscenes`

경로:

`documents/{docId}/memory/subscenes/{subsceneId}`

목적:

- scene 내부 local progression memory

권장 필드:

- `subscene_id`
- `scene_id`
- `chapter_id`
- `start_pid`
- `end_pid`
- `headline`
- `label`
- `action_mode`
- `local_goal`
- `problem_state`
- `causal_input`
- `causal_result`
- `active_cast`
- `key_objects`
- `narrative_importance`
- `evidence_refs`
- `source_run_id`

## 5.4 `events`

경로:

`documents/{docId}/memory/events/{eventId}`

목적:

- causal retrieval에 쓰이는 normalized event node

권장 필드:

- `event_id`
- `scene_id`
- `subscene_id`
- `chapter_id`
- `event_type`
- `actors`
- `acted_on`
- `place`
- `action_summary`
- `goal_state`
- `problem_state`
- `result_state`
- `event_time`
- `importance`
- `evidence_refs`
- `derived_from`
- `source_run_id`

권장 `event_type` 예:

- `entry`
- `exit`
- `discovery`
- `attempt`
- `failure`
- `success`
- `decision`
- `revelation`
- `interaction_shift`
- `place_shift`
- `goal_shift`

## 5.5 `edges`

경로:

`documents/{docId}/memory/edges/{edgeId}`

목적:

- event를 causal / narrative 구조로 연결

권장 필드:

- `edge_id`
- `from_event_id`
- `to_event_id`
- `edge_type`
- `confidence`
- `support_level`
- `evidence_refs`
- `notes`
- `source_run_id`

권장 `edge_type`:

- `causes`
- `enables`
- `blocks`
- `triggers`
- `reveals`
- `escalates`
- `resolves`
- `follows_from`
- `reframes`

권장 `support_level`:

- `explicit`
- `strong_inference`
- `weak_inference`

## 5.6 `places`

경로:

`documents/{docId}/memory/places/{placeKey}`

목적:

- place identity와 continuity를 정규화

권장 필드:

- `place_key`
- `canonical_name`
- `aliases`
- `environment_type`
- `place_archetype`
- `neighbor_place_keys`
- `scene_ids`
- `first_seen`
- `latest_seen`
- `visual_continuity_seed`
- `notes`

## 5.7 `relations`

경로:

`documents/{docId}/memory/relations/{pairKey}`

목적:

- character pair relation memory

권장 필드:

- `pair_key`
- `entity_ids`
- `labels`
- `timeline`
- `current_relation_state`
- `latest_change_type`
- `latest_change_scene_id`
- `evidence_refs`

timeline item 예:

- `scene_id`
- `subscene_id`
- `relation_label`
- `change_type`
- `confidence`
- `evidence_refs`

## 5.8 `evidence`

경로:

`documents/{docId}/memory/evidence/{evidenceId}`

목적:

- reusable text-grounding reference 저장

권장 필드:

- `evidence_id`
- `chapter_id`
- `pid`
- `scene_id`
- `subscene_id`
- `text`
- `span_type`
- `source_stage`

## 5.9 `support_units`

경로:

`documents/{docId}/memory/support_units/{supportUnitId}`

목적:

- 최종 support form으로 변환되기 전 shared support representation 저장

권장 필드:

- `support_unit_id`
- `scene_id`
- `subscene_id`
- `current_state`
- `delta_from_previous`
- `event_refs`
- `causal_parent_refs`
- `active_character_refs`
- `relation_refs`
- `place_transition`
- `ambiguity_flags`
- `support_candidates`
- `source_run_id`

## 5.10 `reader_sessions`

경로:

`documents/{docId}/memory/reader_sessions/{sessionId}`

목적:

- re-entry나 adaptive support를 위한 reader-state memory

권장 필드:

- `session_id`
- `last_scene_id`
- `last_subscene_id`
- `last_active_at`
- `resume_scene_id`
- `reentry_type`
- `support_shown`
- `interaction_summary`

처음 구현 단계에서는 optional로 두어도 된다.

---

## 6. 업데이트 정책

## 6.1 canonical vs run-specific

권장 방향:

- artifact는 run-specific 유지
- support memory는 document scope에서 canonicalized

즉:

- 특정 run이 memory를 populate / refresh할 수 있고
- memory record는 `source_run_id`를 가져야 하며
- 필요하면 다시 rebuild 가능해야 한다.

## 6.2 append-first 정책

append-only를 선호하는 대상:

- relation timeline
- event record
- scene ledger history

replace / merge를 선호하는 대상:

- latest entity summary
- latest place summary
- rebuilt support unit

## 6.3 rebuildability

모든 support memory record는 artifact에서 다시 만들어질 수 있어야 한다.

실무 규칙:

- stage artifact로 trace-back 할 수 없는 memory record는 저장하지 않는다.

---

## 7. retrieval 패턴

schema는 적어도 다음 retrieval을 지원해야 한다.

## 7.1 current scene recovery

조회 대상:

- current scene ledger
- current subscene
- latest support unit

## 7.2 causal bridge retrieval

조회 대상:

- current event node
- incoming causal edge
- 가장 가까운 prior supporting event

## 7.3 character focus retrieval

조회 대상:

- active cast
- entity profile
- 해당 entity가 포함된 최근 relevant event

## 7.4 relation delta retrieval

조회 대상:

- current pair relation
- previous pair relation state

## 7.5 re-entry recap retrieval

조회 대상:

- current scene
- 현재 scene에 이어지는 최근 salient scene 2~4개
- unresolved tension

---

## 8. validation 규칙

support memory가 두 번째 hallucination layer가 되면 안 된다.

기본 검증 규칙:

- 모든 event는 evidence ref를 가져야 함
- 모든 edge는 confidence와 support level을 가져야 함
- place key는 current / mentioned place를 구분해야 함
- relation timeline update는 변화가 발생한 scene/subscene를 참조해야 함
- inferred field와 explicit field를 구분 가능해야 함

구현 제안:

- memory collection마다 zod schema 추가
- write 전에 normalization / consistency check 수행

---

## 9. 권장 구축 순서

1. `scenes`
2. `subscenes`
3. `events`
4. `edges`
5. `places`
6. `relations`
7. `support_units`
8. optional `reader_sessions`

이유:

- scene / subscene ledger가 가장 쉽고 가치가 높다.
- support unit은 lower-level memory가 안정화된 뒤에 만드는 편이 맞다.

---

## 10. 최종 권장 방향

이 memory layer는 다음처럼 이해하는 것이 맞다.

`support generation을 위한 normalized, evidence-linked story state store`

즉,

- 기존 artifact의 단순 복제도 아니고
- UI cache도 아니며
- 자유로운 summary database도 아니다.

이 계층이 잘 만들어지면 이후 support 아이디어 대부분이 훨씬 쉽게 구현된다.
