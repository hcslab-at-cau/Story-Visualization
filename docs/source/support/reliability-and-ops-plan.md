# Reliability and Operations 계획

## 1. 왜 중요한가

시스템이 extraction에서 reader support로 넘어갈수록 실패가 더 눈에 띄게 된다.

잘못된 mention cluster도 문제지만,
잘못된 causal bridge가 reader에게 직접 보이면 더 큰 문제다.

그래서 support branch에는 다음을 위한 명시적인 품질/운영 계층이 필요하다.

- grounding
- debugging
- prompt / version 추적
- cost / latency 관리
- regression 제어

---

## 2. 신뢰성 목표

시스템은 다음을 목표로 해야 한다.

- support claim을 evidence로 추적 가능
- causal / relation support에서 hallucination 최소화
- 과도하지 않은 길이
- 반복 실행 시 UI 동작 안정성
- uncertain support를 왜 숨겼는지 설명 가능

반대로 필요하지 않은 것:

- 완벽한 문학 해석
- 항상 최대 추론 깊이

목표는 literary criticism이 아니라 reader recovery다.

---

## 3. 실패 유형 정리

support-specific failure를 명시적으로 분류해야 한다.

### 3.1 Grounding failure

예:

- 잘못된 character를 가리킴
- 언급만 된 place를 current place처럼 사용
- causal parent가 실제로 현재 event를 지지하지 않음

### 3.2 Overreach failure

예:

- 근거 없는 motive 추가
- 약한 evidence로 강한 relation shift 주장
- 미래 중요도를 과하게 추론

### 3.3 Compression failure

예:

- support가 너무 김
- 이미 보이는 내용을 반복
- changed state를 강조하지 못함

### 3.4 Retrieval failure

예:

- relevant earlier event를 못 찾음
- 잘못된 prior scene을 가져옴
- stale place / relation state를 선택

### 3.5 UI policy failure

예:

- support가 한꺼번에 너무 많이 보임
- 중요한 support가 숨겨짐
- low-value image가 기본 노출됨

### 3.6 VIS-specific failure

예:

- image가 잘못된 current place를 암시
- 보기에는 그럴듯하지만 실제 도움은 없음
- overlay가 unsupported character presence를 암시

---

## 4. 검증 계층

support system은 여러 층에서 검증되어야 한다.

### 4.1 Schema validation

사용:

- 새 support artifact에 대한 zod schema
- 가능하면 strict enum

검사:

- 필수 필드 존재
- confidence 범위
- evidence reference 존재
- ID resolve 가능 여부

### 4.2 Rule validation

검사:

- mentioned place가 current place로 쓰이지 않았는지
- causal bridge가 실제 linked event를 참조하는지
- relation delta가 previous state와 비교되었는지
- snapshot field가 available memory와 맞는지

### 4.3 Prompt-output validation

LLM 생성 support에 대해:

- 짧은 출력 형식 강제
- unsupported field 제거
- overconfident output downgrade 또는 reject

### 4.4 UI validation

검사:

- support bundle 크기
- priority ordering
- 동일 메시지 중복 여부

---

## 5. Prompt Governance

support form이 늘어나면 prompting 관리가 더 어려워진다.

### 5.1 Prompt versioning

각 support prompt는 최소한 다음을 가져야 한다.

- template name
- template version
- prompt role
- output schema version

### 5.2 Prompt categories

purpose에 따라 prompt를 분리한다.

- extraction
- validation
- retrieval formatting
- support compression
- policy selection

### 5.3 Prompt 원칙

support prompt는 다음을 선호해야 한다.

- 짧은 출력
- 명시적 evidence 사용
- local scope
- contrastive framing

피해야 하는 것:

- whole-scene retelling
- literary commentary
- unsupported psychological explanation

---

## 6. Observability

support level에서도 system을 inspect할 수 있어야 한다.

### 6.1 무엇을 로그로 남길지

각 support artifact마다:

- source run ID
- memory retrieval input
- selected candidate record
- prompt template / version
- output
- validation warning
- suppression decision

### 6.2 UI에서 나중에 보고 싶은 것

- retrieved memory node
- causal edge path
- place continuity chain
- support usefulness score
- suppression reason

현재 `PipelineRunner`는 stage inspection에 강하다.
앞으로는 support-specific view가 추가될 필요가 있다.

---

## 7. Regression 전략

support generation을 확장하기 전에 작은 regression set가 필요하다.

### 7.1 샘플 구성

다음 유형을 포함:

- clear place shift
- 긴 dialogue와 ambiguous reference
- 중요한 causal linkage
- recurring location
- relation change
- re-entry difficulty

### 7.2 기대 출력

human-checked expectation으로 저장할 것:

- snapshot field
- chips
- causal bridge 유무
- reference repair
- VIS usefulness

### 7.3 regression 체크

prompt나 schema를 바꿀 때 다음을 본다.

- output 구조 안정성
- support 길이
- evidence integrity
- 중복 없는지

---

## 8. Cost / Latency 전략

모든 support를 LLM 생성으로 두면 branch가 금방 비싸진다.

권장 방향:

- retrieval과 diff logic은 deterministic 우선
- LLM은 compact wording이나 ambiguous case에만 사용

대략적인 배치:

- `SUP.0`, `SUP.1`, `SUP.3`, `SUP.7`: 기본적으로 non-LLM
- `SUP.2`, `SUP.5`, `SUP.6`: 소형 모델 가능
- `SUP.4`: 필요 시 stronger model

추가로:

- support memory cache
- upstream content가 안 바뀌면 support artifact를 재생성하지 않기

---

## 9. Human Review Workflow

정식 평가 전에 내부 리뷰가 쉬워야 한다.

추천 리뷰 기준:

- useful / not useful
- correct / partially correct / wrong
- too long / acceptable / too short
- redundant / distinct
- well-timed / poorly timed

리뷰 시 같이 볼 것:

- scene text
- support output
- evidence ref
- source memory node

---

## 10. User Study 전 신뢰성 게이트

다음 조건이 맞기 전에는 user study로 넘어가지 않는 것이 좋다.

- support memory retrieval이 안정적임
- first-wave support가 evidence link를 가짐
- 명백한 grounding failure가 드묾
- UI가 support overload 상태가 아님
- VIS usefulness suppression이 최소한 거칠게라도 작동함

---

## 11. 최종 권장 방향

이 프로젝트는 reliability를 별도 engineering detail이 아니라 핵심 설계 문제로 취급해야 한다.

가장 중요한 원칙은 다음이다.

`도움이 되기에는 신뢰할 수 없는 support라면, 더 길게 보여주기보다 짧게 만들거나 낮추거나 숨기는 편이 낫다.`
