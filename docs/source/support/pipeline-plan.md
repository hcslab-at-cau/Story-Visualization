# Support Pipeline 계획

## 구현 반영 메모

이번 구현 브랜치에서는 `SUP.0` ~ `SUP.7`이 실제 stage로 추가되었다. 실제 구현 상세는 `support/support-implementation.md`를 기준으로 본다.

현재 구현된 stage 구성은 다음과 같다.

- `SUP.0`: Support Memory
- `SUP.1`: Shared Support Context
- `SUP.2`: Snapshot and Boundary
- `SUP.3`: Causal Bridges
- `SUP.4`: Character and Relation
- `SUP.5`: Reentry and Reference
- `SUP.6`: Support Policy
- `SUP.7`: Reader Support Package

초기 계획과 달리 첫 구현에서는 boundary delta를 `SUP.2`에, character/relation을 `SUP.4`에, re-entry/reference/spatial/visual cue를 `SUP.5`에 묶었다. 목적은 stage 수를 늘리기보다 실행 가능한 artifact 계약과 inspector를 먼저 고정하는 것이다.

## 1. 목적

이 문서는 프로젝트에 새로운 support-generation branch를 추가하는 계획을 정리한다.

현재 파이프라인은

- 이야기 구조를 추출하고 검증하는 데에는 강하다.

하지만 아직 부족한 것은

- 그 구조를 여러 reader-facing support artifact로 변환하는 별도 브랜치

이다.

---

## 2. 왜 별도 브랜치가 필요한가

support generation을 단순히

- `SUB.4`
- `FINAL.1`

안에만 두는 것은 구조적으로 아쉽다.

이유:

- `SUB.4`는 local하고 subscene-centered
- `FINAL.1`은 packaging 중심
- support generation은 retrieval, grounding, ranking logic을 따로 가져야 함

그래서 더 자연스러운 구조는 다음과 같다.

`SCENE.3 + SUB.3 + support memory -> support artifacts -> FINAL.1`

---

## 3. 제안하는 Support Branch

권장 stage family:

- `SUP.0` Support Memory Build
- `SUP.1` Shared Support Representation
- `SUP.2` Current-State Snapshot
- `SUP.3` Boundary Delta Chips
- `SUP.4` Causal Bridge
- `SUP.5` Character / Relation Support
- `SUP.6` Re-entry / Reference Repair
- `SUP.7` Support Policy Selection

처음에는 optional branch로 시작해도 되지만, 구조적으로는 명시적인 브랜치로 보는 편이 맞다.

---

## 4. Stage별 역할

## 4.1 `SUP.0` Support Memory Build

목적:

- validated artifact에서 document-level support memory를 materialize

입력:

- `ENT.3`
- `STATE.2`
- `STATE.3`
- `SCENE.1`
- `SCENE.3`
- `SUB.2`
- `SUB.3`

처리 방식:

- 기본은 rule-based
- 이후 필요하면 가벼운 normalization prompt 추가 가능

출력:

- doc-level storage에 memory record 작성

주요 기능:

- scene ledger write
- subscene ledger write
- event node extraction
- place normalization
- relation timeline write

## 4.2 `SUP.1` Shared Support Representation

목적:

- scene 또는 subscene 단위의 안정된 support-ready unit 생성

입력:

- 현재 scene/subscene artifact
- retrieved memory record

처리 방식:

- rule-based retrieval + merge 중심
- 필요시 가벼운 LLM cleanup

출력:

- `SharedSupportUnit[]`

권장 필드:

- `support_target_type`
- `support_target_id`
- `current_state`
- `delta_from_previous`
- `local_event`
- `causal_parent_candidates`
- `active_characters`
- `relation_candidates`
- `place_transition`
- `ambiguity_flags`
- `evidence_refs`

## 4.3 `SUP.2` Current-State Snapshot

목적:

- 가장 기본적인 복구용 support 생성

입력:

- shared support unit

처리 방식:

- 먼저 rule templating
- 필요하면 그 위에 LLM compression

출력:

- scene/subscene별 snapshot

권장 필드:

- `support_target_id`
- `summary_lines`
- `state_fields`
- `confidence`
- `evidence_refs`

## 4.4 `SUP.3` Boundary Delta Chips

목적:

- 전환 신호를 가벼운 chip 형태로 생성

입력:

- shared support unit
- boundary reason

처리 방식:

- deterministic

출력:

- ranked chip set

권장 카테고리:

- place
- time
- cast
- goal
- relation
- narrative mode

## 4.5 `SUP.4` Causal Bridge

목적:

- 현재 subscene/state를 이전 enabling 또는 causing event와 연결

입력:

- shared support unit
- event graph

처리 방식:

- retrieval + 짧은 LLM generation

출력:

- ranked causal bridge

권장 필드:

- `target_id`
- `bridge_text`
- `source_event_id`
- `target_event_id`
- `edge_path`
- `confidence`
- `evidence_refs`

중요 규칙:

- 긴 설명 사슬 금지
- 한 문장 bridge를 우선

## 4.6 `SUP.5` Character / Relation Support

목적:

- active character와 중요한 pair를 위한 focused support 생성

입력:

- shared support unit
- entity memory
- relation memory

처리 방식:

- retrieval + 짧은 LLM formatting

출력:

- character focus card
- relation delta card

## 4.7 `SUP.6` Re-entry / Reference Repair

목적:

- pause-resume와 local ambiguity repair 지원

입력:

- shared support unit
- optional reader session memory
- local mention ambiguity signal

처리 방식:

- trigger-dependent

출력:

- re-entry recap
- reference repair list

권장 규칙:

- 항상 생성하지 말고 trigger 또는 on-demand에서만 생성

## 4.8 `SUP.7` Support Policy Selection

목적:

- 어떤 support를 어디에 어떤 우선순위로 보여줄지 결정

입력:

- 모든 support artifact
- optional VIS usefulness
- interface context
- trigger state

처리 방식:

- 우선 deterministic policy
- personalization은 나중 단계

출력:

- `DisplaySupportPlan`

권장 필드:

- `always_visible`
- `expandable`
- `on_trigger`
- `suppressed`
- `ui_priority_order`

---

## 5. deterministic vs LLM 경계

모든 support stage를 LLM-heavy하게 만들 필요는 없다.

권장 분리:

거의 deterministic:

- `SUP.0`
- `SUP.1`
- `SUP.3`
- `SUP.7`

혼합:

- `SUP.2`
- `SUP.5`
- `SUP.6`

retrieval + LLM:

- `SUP.4`

이유:

- support branch는 controllable하고 auditable해야 한다.

---

## 6. 기존 브랜치와의 관계

## 6.1 `SUB`와의 관계

가장 자연스러운 해석:

- `SUB`는 local progression unit과 local support target을 찾는다.
- `SUP`는 더 넓은 memory를 이용해 그것을 reader-facing support form으로 바꾼다.

## 6.2 `VIS`와의 관계

가장 자연스러운 해석:

- `VIS`는 하나의 output modality다.
- `SUP`가 VIS를 support bundle에 포함할지 결정한다.

## 6.3 `FINAL`과의 관계

가장 자연스러운 해석:

- `FINAL.1`은 text support + VIS + UI policy를 합쳐 조립하는 packager가 된다.

---

## 7. MVP 범위

가장 작은 유의미한 support branch만 먼저 만든다면:

- `SUP.0`
- `SUP.1`
- `SUP.2`
- `SUP.3`
- `SUP.4`
- `SUP.7`의 단순 버전

이 정도만으로도 다음 질문은 시험할 수 있다.

- generic summary보다 targeted repair support가 더 나은가?

---

## 8. 주요 리스크

### 리스크 1. `SUB.4`와 중복된다

대응:

- `SUB.4`는 local
- `SUP`는 retrieval-aware, document-aware로 역할 분리

### 리스크 2. artifact type이 너무 빨리 늘어난다

대응:

- first-wave artifact만 먼저 구현

### 리스크 3. LLM 의존도가 과도해진다

대응:

- retrieval과 diff logic은 deterministic 우선

### 리스크 4. support 출력이 서로 반복된다

대응:

- deduplication과 suppression rule 명시

---

## 9. 최종 권장 방향

support branch는 다음처럼 이해하는 것이 맞다.

`구조화된 narrative understanding을 선택적이고 복구 지향적인 reader support로 변환하는 파이프라인`

이 관점이 이후 구현 결정을 가장 일관되게 만들어 준다.
