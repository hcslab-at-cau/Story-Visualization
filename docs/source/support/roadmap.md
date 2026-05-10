# Support System 로드맵

## 1. 목적

이 문서는 support-design 논의를 실제 실행 로드맵으로 바꾸기 위한 문서다.

목표는 프로젝트를

- 구조를 잘 뽑는 extraction pipeline

에서

- 문서 전역 맥락을 기억하는 reader-support system

으로 발전시키는 것이다.

이 로드맵은 특히 다음을 분명히 하려는 목적을 가진다.

- 어떤 것을 먼저 구현할지
- 어떤 구조를 먼저 안정화해야 하는지
- 어떤 단계에서 평가로 넘어갈지

---

## 2. 전략적 방향

다음 단계는 단순히

- prompt 하나 더 추가하기
- 이미지 품질만 높이기
- metadata를 더 많이 보여주기

가 되어서는 안 된다.

대신 다음 순서로 가는 편이 맞다.

1. 문서 전역 memory 구축
2. support-ready intermediate representation 구성
3. 소수의 고가치 support form 생성
4. 언제 어떤 support를 보여줄지 정책화
5. 실제 독해 복구에 도움이 되는지 평가

즉 큰 흐름은 다음과 같다.

`pipeline completion -> support architecture -> interface behavior -> evaluation`

---

## 3. 작업 흐름(Workstreams)

## 3.1 Workstream A: Data Foundation

핵심 질문:

- 시스템이 장면과 챕터를 넘어서 이야기 상태를 기억할 수 있는가?

포함 내용:

- document-level memory schema
- event graph
- place graph
- relation timeline
- evidence index

## 3.2 Workstream B: Support Generation

핵심 질문:

- 공유된 구조에서 여러 support form을 안정적으로 만들 수 있는가?

포함 내용:

- shared support representation
- snapshot 생성
- delta chips
- causal bridge
- character / relation card
- re-entry support

## 3.3 Workstream C: VIS Repositioning

핵심 질문:

- visual support는 언제 유용하고, 어떻게 동작해야 하는가?

포함 내용:

- usefulness scoring
- visual metadata
- continuity 제어
- schematic fallback

## 3.4 Workstream D: Reader UI Policy

핵심 질문:

- 어떤 support를 기본 노출하고, 어떤 것은 hover / click / trigger-only로 둘 것인가?

포함 내용:

- support exposure rules
- trigger 정의
- 과도하지 않은 UI 조합
- `FINAL.1`, `ReaderScreen` 통합

## 3.5 Workstream E: Reliability and Operations

핵심 질문:

- 시스템이 grounding, debugging, 반복 실행 측면에서 충분히 안정적인가?

포함 내용:

- prompt versioning
- artifact validation
- regression review
- latency / cost 제어
- observability

## 3.6 Workstream F: Research Evaluation

핵심 질문:

- support가 실제로 recovery, continuity, re-entry를 개선하는가?

포함 내용:

- offline evaluation
- annotation task
- pilot user study
- logging / analysis

---

## 4. 권장 구현 순서

## Phase 0. 구현 전 결정 정리

산출물:

- 1차 support form 범위 확정
- doc-level memory schema 확정
- support branch stage 이름 확정

우선 결정할 것:

- 어떤 support를 1차 범위로 볼지
- support artifact를 run 단위로 둘지 canonical document memory로 둘지
- reader UI를 처음에는 chapter-local로 유지할지

권장 1차 범위:

- current-state snapshot
- boundary delta chips
- causal bridge
- character focus
- re-entry recap

## Phase 1. 문서 전역 memory 구축

우선순위:

- 최우선

이유:

- 이후 대부분의 support는 이전 장면/사건 retrieval이 필요함

작업:

- `documents/{docId}/memory/...` 컬렉션 추가
- scene ledger writer
- event node writer
- place graph writer
- relation timeline writer
- evidence index writer

완료 기준:

- 현재 scene에서 이전 place state, event, character history, relation history를 retrieval할 수 있어야 함

## Phase 2. shared support representation 구축

우선순위:

- memory 다음으로 가장 높음

이유:

- support form을 raw artifact에서 각각 직접 만들면 구조가 금방 흩어짐

작업:

- `SharedSupportUnit` 정의
- scene/subscene + retrieved memory를 하나의 support context로 합치기
- evidence와 confidence 연결

완료 기준:

- 한 scene/subscene이 UI 특정 형식에 묶이지 않은 support-ready unit으로 변환되어야 함

## Phase 3. 1차 support artifact 구축

작업:

- `Current-State Snapshot`
- `Boundary Delta Chips`
- `Causal Bridge`
- `Character Focus`
- `Reference Repair`

완료 기준:

- 각 support type이 evidence와 confidence를 가진 artifact로 생성되어야 함

## Phase 4. support policy를 final 조립에 연결

작업:

- support policy layer 추가
- `FINAL.1` 갱신
- reader UI 노출 규칙 적용

트리거 예시:

- scene boundary 진입
- 긴 휴지 후 복귀
- 큰 cast turnover
- 높은 reference ambiguity

완료 기준:

- 항상 보이는 support, 확장형 support, trigger-only support가 구분되어야 함

## Phase 5. VIS 재배치

작업:

- usefulness score
- visual metadata
- place continuity memory
- schematic fallback
- final display policy와 연결

완료 기준:

- 왜 image를 보여주는지 설명 가능해야 함
- low-value image는 suppress 가능해야 함

## Phase 6. 2차 support 확장

작업:

- relation delta card
- spatial continuity card
- goal-problem tracker
- evidence quote card
- retrospective 도구

## Phase 7. 평가와 실험 준비

작업:

- offline evaluation set 구성
- inspection screen 보강
- study condition 설계
- logging 추가

---

## 5. 마일스톤

## M1: Support Memory Exists

의미:

- 시스템이 이전 장면의 맥락을 retrieval할 수 있음

## M2: First Useful Supports Exist

의미:

- generic summary가 아니라 targeted support가 실제로 생성됨

## M3: Reader Policy Exists

의미:

- 어떤 support를 언제 보여줄지 시스템이 결정할 수 있음

## M4: VIS Becomes Optional but Smarter

의미:

- image가 항상 기본 답이 아니라 usefulness 기반으로 선택됨

## M5: Evaluation Readiness

의미:

- artifact quality와 UI가 pilot study로 갈 만큼 안정화됨

---

## 6. 당장 다음에 할 일

지금 바로 구현을 시작한다면 가장 좋은 순서는 다음과 같다.

1. doc-level memory schema 구현
2. `schema.ts`에 `SharedSupportUnit` 초안 추가
3. support branch skeleton 추가
   - `SUP.0`
   - `SUP.1`
   - `SUP.2`
   - `SUP.3`
4. `FINAL.1`이 support artifact를 받을 수 있도록 확장
5. VIS 대규모 재설계는 support branch 기초가 잡힌 뒤로 미루기

---

## 7. 지금 단계에서 너무 일찍 하지 말아야 할 것

- 거대한 global graph UI
- 과한 personalization logic
- support form을 한꺼번에 너무 많이 추가하는 것
- support policy 없이 VIS prompt만 과도하게 다듬는 것
- artifact 안정화 전에 user study로 바로 가는 것

---

## 8. 최종 권장 방향

가장 중요한 전략적 결정은 다음이다.

`support generation을 SUB나 FINAL의 얇은 확장이 아니라, 별도 파이프라인 브랜치로 취급한다.`

이 결정이 이후 구현, 문서화, 평가를 가장 깔끔하게 만든다.
