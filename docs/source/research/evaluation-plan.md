# Reader Support 평가 계획

## 1. 왜 평가를 일찍 시작해야 하는가

프로젝트는 이제 "가능한 support form이 많아지는 단계"에 들어왔다.

평가 없이 가면 다음에 최적화하기 쉽다.

- novelty
- visual appeal
- prompt cleverness

대신 정말 봐야 하는 것은

- 실제 독해 복구에 도움이 되는가

이다.

그래서 모든 support form이 완성되기 전부터 평가 계획을 잡는 편이 맞다.

---

## 2. 메인 연구 질문

핵심 질문:

`어떤 support form이 독자의 현재 scene state를 가장 적은 방해로 복구해 주는가?`

세부 질문으로 나누면:

- confusion 상황에서 어떤 form이 가장 유용한가?
- re-entry 상황에서 어떤 form이 가장 유용한가?
- image support는 언제 실제로 도움이 되는가?
- causal support는 언제 visual support보다 가치가 큰가?
- generic summary 하나보다 selective support가 더 나은가?

---

## 3. 평가 층위

평가는 세 층으로 나누는 것이 좋다.

### 3.1 Artifact Quality Evaluation

질문:

- support output 자체가 grounded하고 useful한가?

평가 주체:

- 내부 annotator / expert reviewer

### 3.2 Interface Usefulness Evaluation

질문:

- support의 위치와 timing이 실제 reading 중 도움이 되는가?

평가 주체:

- prototype 사용자 또는 pilot 참여자

### 3.3 End-Task Reading Evaluation

질문:

- 시스템이 recovery, continuity, re-entry를 실제로 개선하는가?

평가 주체:

- comprehension / recovery task 기반 평가

---

## 4. 층위별 지표

### 4.1 Artifact quality 지표

각 support artifact마다 평가:

- grounding correctness
- usefulness
- brevity appropriateness
- distinctiveness
- timing appropriateness

권장 척도:

- 1 ~ 5

추가 binary check:

- factual error가 있는가?
- unsupported inference인가?
- 다른 support와 redundant한가?

### 4.2 Interface-level 지표

예시:

- support open rate
- first useful support click까지 걸린 시간
- abandonment rate
- support overload complaint
- support condition 선호도

### 4.3 Reading outcome 지표

예시:

- scene-state reconstruction accuracy
- causal linkage recall
- place continuity accuracy
- character-role recovery
- re-entry time
- "지금 무슨 일이 벌어지고 있는지 안다"는 자기 확신 정도

---

## 5. 권장 실험 조건

처음부터 조건을 너무 많이 두지 않는 편이 좋다.

### Study A. 최소 support 비교

조건:

- no support
- generic summary
- current-state snapshot + chips

목표:

- targeted local repair가 generic summary보다 나은지 확인

### Study B. modality 비교

조건:

- text support only
- VIS only
- text + VIS

목표:

- image가 언제 도움이 되고 언제 아닌지 확인

### Study C. causal support 비교

조건:

- snapshot only
- snapshot + causal bridge

목표:

- "왜 이렇게 됐지?" 유형 scene에서 causal repair 효과 측정

### Study D. re-entry 비교

조건:

- no recap
- generic recap
- re-entry recap

목표:

- present-anchored recap이 일반 retrospective summary보다 나은지 확인

---

## 6. scene sampling 전략

평가용 scene은 무작위로만 뽑으면 안 된다.

다음 failure type을 골고루 포함해야 한다.

- place shift scene
- time shift scene
- cast-heavy scene
- dialogue-heavy scene
- reflective scene
- strongly causal scene
- recurring location scene
- image usefulness가 낮을 가능성이 큰 scene

이유:

- support usefulness는 scene type에 따라 크게 달라지기 때문이다.

---

## 7. 내부 annotation task

formal user study 전에 내부 annotation task를 먼저 만드는 것이 좋다.

### 7.1 Support usefulness annotation

질문:

- 독자가 여기서 헷갈렸다면 이 support가 recovery에 도움이 되는가?

평가:

- useful / partly useful / not useful

### 7.2 Causal validity annotation

질문:

- 이 causal bridge가 현재 상태를 설명하는 올바른 earlier event를 연결하는가?

평가:

- correct / weak / wrong

### 7.3 VIS usefulness annotation

질문:

- 이 image가 현재 scene state 복구에 도움이 되는가?

평가:

- high / medium / low / misleading

### 7.4 Timing annotation

질문:

- 이 support는 always-visible, optional, trigger-only 중 어디에 두는 것이 맞는가?

이 annotation은 나중 support policy 설계에도 직접 도움을 준다.

---

## 8. Logging 권장 사항

나중 평가를 위해 최소한 다음은 로그로 남겨야 한다.

- scene / subscene ID
- available support artifact
- 실제로 노출된 support artifact
- user interaction with support
- pause 후 resume 여부
- 다음 navigation까지 걸린 시간

중요한 점:

- generic analytics가 아니라 평가 질문과 맞닿은 로그여야 한다.

---

## 9. 1차 prototype 성공 기준

다음 정도가 보이면 1차 prototype은 유망하다고 볼 수 있다.

- targeted support가 generic summary보다 scene-state recovery에서 더 좋음
- causally difficult scene에서 causal bridge가 추가 이득을 줌
- VIS는 일부 scene type에서 유의미하지만 모든 장면에서 강제되지 않음
- 사용자들이 interface overload를 강하게 느끼지 않음

---

## 10. 지금 단계에서 과장하면 안 되는 주장

처음부터 다음을 크게 주장하는 것은 피하는 편이 낫다.

- 전반적 reading comprehension 향상
- literacy 자체 향상
- image support의 보편적 유용성

초기 단계에서 가장 방어 가능한 주장은 더 좁다.

- 현재 상태 복구 속도 개선
- re-entry support 개선
- 특정 유형 장면에서 causal continuity recovery 개선

---

## 11. 최종 권장 방향

support는 "얼마나 인상적인가"보다
"독자가 이야기의 현재에 다시 접속하는 비용을 얼마나 줄여주는가"로 평가해야 한다.

이 기준이 artifact 설계, UI 설계, user study 설계를 모두 묶는 중심축이 되어야 한다.
