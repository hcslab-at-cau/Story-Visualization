# QA-grounded Reader Support Plan

## 1. 목적

지금 프로젝트에서 "도움", "힌트", "support"라고 부르는 목록은 이미 좋은 방향으로 가고 있지만, 일부 항목은 우리가 직관적으로 만든 것이다. 다음 단계에서는 이 목록을 QA / reading comprehension 문헌에서 사람들이 실제로 묻는 질문 유형과 맞춘 뒤, 각 support가 언제 필요한지 판단하는 scoring / policy를 더 체계적으로 개발해야 한다.

이 문서는 다음 두 가지를 정한다.

1. QA 논문에서 반복적으로 나타나는 질문 유형을 근거로 reader support taxonomy를 재정의한다.
2. 현재 rule-based scoring / policy를 어떻게 데이터 기반 policy로 발전시킬지 계획한다.

중요한 전제는 하나다. 이 시스템의 목표는 "질문에 답하는 QA 챗봇"이 아니라, 독자가 현재 독서 위치에서 놓친 situation model을 가장 작은 방해로 복구하도록 돕는 것이다. 따라서 QA taxonomy는 그대로 UI 메뉴가 되면 안 되고, "독자가 지금 어떤 이해 문제를 겪을 가능성이 있는가"를 정의하는 축으로 변환되어야 한다.

## 2. 현재 구현 기준점

현재 구현은 이미 다음 구조를 갖고 있다.

- `src/types/schema.ts`
  - `SupportUnitKind`
  - `ReaderProblem`
  - `SupportUnit`
  - `ReaderSupportPlan`
  - `ReaderSession`
  - `ReaderSupportEvent`
- `src/lib/pipeline/support.ts`
  - `SUP.0~SUP.7`
  - `supportFinalScore()`
  - `suppressionReasonFor()`
  - `buildReaderSupportPlan()`
- `src/lib/support-verifier.ts`
  - evidence grounding, confidence, usefulness, intrusion, redundancy, spoiler risk 기반 검증
- `src/lib/support-governor.ts`
  - runtime에서 기본 노출, on-demand, trigger-only, visual usefulness, reentry gap, support fatigue를 처리
- `src/lib/support-context.ts`
  - `BOOK.0` / `NRG.0`에서 reader-safe claim을 가져와 `SupportUnit`으로 보강

현재 `ReaderProblem`은 다음 여덟 가지다.

```ts
type ReaderProblem =
  | "boundary_update"
  | "state_recovery"
  | "causal_gap"
  | "reference_ambiguity"
  | "character_reentry"
  | "relation_delta"
  | "spatial_disorientation"
  | "session_reentry";
```

현재 점수는 대략 다음 철학을 따른다.

```text
final_score =
  usefulness * grounding * confidence
  - intrusion penalty
  - redundancy penalty
  - spoiler penalty
```

이 방향은 유지할 가치가 있다. 다만 지금은 `usefulness_score`, `intrusion_cost`, `default_display`, `trigger_preconditions`가 대부분 support kind와 간단한 rule에서 나온다. 다음 단계는 "이 support가 어떤 질문 유형 / reader problem에 답하는가"와 "이 장면에서 그 질문이 생길 확률이 높은가"를 명시적으로 넣는 것이다.

## 3. QA 문헌에서 보이는 질문 유형

### 3.1 NarrativeQA

[NarrativeQA](https://arxiv.org/abs/1712.07040)는 full book / movie script 이해를 평가하기 위해 만든 narrative QA benchmark다. 논문은 story 이해가 events, entities, places, relations를 문서 전체에 걸쳐 통합하는 문제라고 본다. 이 점은 우리 프로젝트의 `SUP.0 -> BOOK.0 -> NRG.0 -> support` 방향과 잘 맞는다.

NarrativeQA training set의 question first token 분포는 다음과 같다.

| First token | Frequency |
|---|---:|
| What | 38.04% |
| Who | 23.37% |
| Why | 9.78% |
| How | 8.85% |
| Where | 7.53% |
| Which | 2.21% |
| How many/much | 1.80% |
| When | 1.67% |

논문이 300개 validation question sample에 붙인 category는 다음과 같다.

| Category | Frequency |
|---|---:|
| Person | 30.54% |
| Description | 24.50% |
| Location | 9.73% |
| Why/reason | 9.40% |
| How/method | 8.05% |
| Event | 4.36% |
| Entity | 4.03% |
| Object | 3.36% |
| Numeric | 3.02% |
| Duration | 1.68% |
| Relation | 1.34% |

시사점:

- 인물, 설명, 현재 상태, 장소가 매우 큰 축이다.
- why/reason은 단일 빈도로는 10% 내외지만, long-form narrative에서는 여러 문장 / 여러 장면에 걸친 통합이 필요해서 support 가치가 크다.
- relation은 분포상 작지만, 긴 소설에서는 relation delta가 한 번 무너지면 다음 장면 이해 비용이 커진다. 빈도만으로 낮게 두면 안 된다.

### 3.2 FairytaleQA

[FairytaleQA](https://arxiv.org/abs/2203.13947)는 narrative comprehension을 교육적 reading skill에 맞춰 세분화한 dataset이다. 278개 story에서 10,580개의 explicit / implicit question을 만들고, 일곱 가지 narrative element / relation으로 분류한다.

| Type | Count | Percent |
|---|---:|---:|
| Action | 3342 | 31.59% |
| Causal relationship | 2940 | 27.79% |
| Character | 1172 | 11.08% |
| Feeling | 1024 | 9.68% |
| Outcome resolution | 986 | 9.32% |
| Setting | 630 | 5.95% |
| Prediction | 486 | 4.59% |

시사점:

- narrative support의 중심은 "무슨 일이 일어났는가"와 "왜 그렇게 되었는가"다.
- 우리 현재 list에는 `snapshot`, `boundary_delta`, `causal_bridge`가 있지만, "action/event tracking" 자체가 별도 reader problem으로 충분히 명시되어 있지 않다.
- feeling / motivation은 `character_focus` 안에 들어가 있지만, QA 관점에서는 character identity와 다른 문제다.
- outcome resolution은 causal bridge와 비슷하지만 방향이 다르다. "앞 사건이 지금 무엇으로 귀결되었는가"를 복구하는 support가 필요하다.

### 3.3 TellMeWhy

[TellMeWhy](https://aclanthology.org/2021.findings-acl.53/)는 narrative에서 character action에 대한 why-question만 집중적으로 모은 dataset이다. 총 30,519개의 why question과 free-form answer를 제공한다. 논문은 why question이 종종 text에 직접 없는 implicit gap을 채워야 한다고 본다.

시사점:

- causal support는 단순히 "앞 sentence를 찾는 것"이 아니다.
- action, intention, goal, commonsense plan을 연결해야 한다.
- 따라서 `causal_bridge`는 evidence-grounded earlier event와 current action을 연결하되, inference strength를 표시해야 한다.
- `support_level = explicit | strong_inference | weak_inference`와 `scope`는 핵심 metadata다.

### 3.4 INQUISITIVE

[INQUISITIVE](https://aclanthology.org/2020.emnlp-main.530/)는 사람이 문서를 읽는 도중 실제로 어떤 질문을 떠올리는지 수집한 dataset이다. 독자는 다음 문장을 보기 전에 현재 sentence의 span을 highlight하고, 이해를 높이기 위한 질문을 적는다.

수동 분석에서 나타난 주요 pragmatic function은 다음과 같다.

| Question function | Percent |
|---|---:|
| Why / causal | 38.7% |
| Elaboration | 21.6% |
| Definition | 12.6% |
| Background information | 10.0% |
| Instantiation | 8.1% |
| Forward-looking | 4.5% |

시사점:

- 독서 중 질문은 post-hoc comprehension test보다 더 support policy와 가깝다.
- 독자는 "이 단어/개념/행동이 정확히 무엇을 뜻하지?", "왜 그런 일이 생겼지?", "이 맥락의 배경은 뭐지?"를 자주 묻는다.
- 현재 `reference_repair`는 pronoun/entity ambiguity에 가까운데, 실제로는 definition, elaboration, background, instantiation까지 포함하는 넓은 repair category가 필요하다.
- forward-looking question은 future spoiler를 유발할 수 있으므로 기본 노출하면 안 된다. 대신 "이 장면에서 열린 tension"을 표시하는 spoiler-safe support로 변환해야 한다.

### 3.5 TORQUE

[TORQUE](https://aclanthology.org/2020.emnlp-main.88/)는 temporal ordering question을 집중적으로 다룬다. 논문은 "what happened before/after some event?" 같은 시간 관계 이해가 reading comprehension의 중요한 일부라고 본다.

시사점:

- 현재 list에는 `spatial_continuity`는 있지만 temporal continuity가 명시적이지 않다.
- `boundary_delta`가 time change label을 일부 품고 있지만, long-form fiction에서는 flashback, memory, narration order, storyworld chronology를 구분해야 한다.
- `setting` support는 place만이 아니라 time / order / narrative scope까지 포함해야 한다.

### 3.6 MultiRC와 HotpotQA

[MultiRC](https://cogcomp.seas.upenn.edu/multirc/)는 multi-sentence reasoning이 필요한 reading comprehension dataset이다. 논문은 single-sentence question보다 multi-sentence question이 훨씬 어렵고, coreference resolution이 자주 필요하다고 분석한다.

[HotpotQA](https://arxiv.org/abs/1809.09600)는 multi-hop QA에서 supporting facts를 함께 제공한다. 질문에 답하려면 여러 문서의 supporting facts를 찾아 연결해야 하고, comparison question도 포함한다.

시사점:

- support unit은 prose만 있으면 안 되고, evidence refs와 claim refs를 가져야 한다.
- reader support policy는 "이 카드가 맞는가"뿐 아니라 "이 카드가 어떤 evidence chain을 줄여 주는가"를 봐야 한다.
- `NRG.0`과 `BOOK.0`의 역할은 단순 graph visualization이 아니라 multi-hop support chain을 만드는 것이다.

### 3.7 SQuAD 2.0

[SQuAD 2.0](https://nlp.stanford.edu/pubs/rajpurkar2018squad.pdf)는 unanswerable question을 추가하여, 시스템이 답이 없을 때 abstain해야 함을 강조한다.

시사점:

- reader support에서도 "모르면 보여주지 않기"가 필요하다.
- low confidence support, unsupported inference, future spoiler, narrative scope가 불명확한 claim은 더 긴 설명으로 보완할 문제가 아니라 suppress / on-demand로 내려야 할 문제다.
- support policy의 핵심은 좋은 것을 많이 보여주는 것이 아니라, plausible하지만 틀린 support를 막는 것이다.

## 4. QA 근거 기반 support taxonomy

현재 list를 완전히 버릴 필요는 없다. 다만 이름과 axis를 "UI 형태"가 아니라 "reader question / reader problem" 기준으로 재정렬해야 한다.

### 4.1 권장 ReaderProblem V2

```ts
type ReaderProblemV2 =
  | "current_action_state"
  | "causal_motivation"
  | "character_identity_role"
  | "character_feeling_goal"
  | "relation_social_delta"
  | "setting_spacetime_continuity"
  | "reference_elaboration"
  | "outcome_thread_resolution"
  | "session_reentry";
```

이 taxonomy는 현재 구현과 다음처럼 매핑된다.

| QA-derived reader question | ReaderProblem V2 | Current support kind | 정책상 의미 |
|---|---|---|---|
| 지금 무슨 일이 일어나고 있지? | `current_action_state` | `snapshot`, `boundary_delta` | 가장 낮은 intrusion으로 기본 노출 후보 |
| 왜 이 행동/사건이 생겼지? | `causal_motivation` | `causal_bridge` | high value, but evidence / inference 관리 필요 |
| 이 인물은 누구고 지금 어떤 역할이지? | `character_identity_role` | `character_focus` | 인물 재등장, 대화 장면에서 on-demand 또는 side |
| 이 인물은 왜 이렇게 느끼거나 행동하지? | `character_feeling_goal` | `character_focus`, `causal_bridge` | feeling / goal을 별도 subproblem으로 표시 |
| 두 인물 관계가 어떻게 바뀌었지? | `relation_social_delta` | `relation_delta` | relation shift가 있을 때만 강하게 노출 |
| 지금 어디/언제이고 앞뒤 순서는? | `setting_spacetime_continuity` | `spatial_continuity`, `boundary_delta` | place + time + order를 함께 다룸 |
| 이 말/대명사/개념은 뭘 가리키지? | `reference_elaboration` | `reference_repair` | definition, elaboration, background까지 확장 |
| 앞 사건은 지금 무엇으로 이어졌지? | `outcome_thread_resolution` | `causal_bridge`, NRG claim | spoiler-safe outcome만 허용 |
| 오래 쉬었다가 돌아왔는데 어디였지? | `session_reentry` | `reentry_recap` | reader state trigger 기반 |

### 4.2 SupportUnitKind는 조금 다르게 봐야 한다

`SupportUnitKind`는 "무슨 문제를 해결하는가"와 "어떤 형태로 보여주는가"가 섞여 있다. 다음처럼 분리하는 것이 더 낫다.

```ts
type SupportNeed = ReaderProblemV2;

type SupportForm =
  | "snapshot"
  | "delta_chip"
  | "bridge_card"
  | "focus_card"
  | "evidence_popover"
  | "mini_recap"
  | "visual_grounding";

type SupportModality = "text" | "visual" | "mixed";
```

실제 구현은 당장 `SupportUnitKind`를 갈아엎지 않아도 된다. 먼저 metadata를 추가하고, `kind`는 backward compatibility를 위해 유지한다.

권장 해석:

- `visual_context`는 독립 reader problem이 아니라 modality / form이다.
- `boundary_delta`는 독립 problem이 아니라 `current_action_state` 또는 `setting_spacetime_continuity`를 압축해 보여주는 form이다.
- `character_focus`는 identity/role과 feeling/goal로 내부 label을 나눠야 한다.
- `reference_repair`는 entity/pronoun만이 아니라 definition, elaboration, background, instantiation repair를 포함해야 한다.
- `causal_bridge`는 backward-looking cause와 forward-looking outcome resolution을 구분해야 한다.

## 5. 재정의된 도움 리스트

### A. Current Action / State Snapshot

답하는 질문:

- 지금 무슨 일이 일어나고 있지?
- 누가 있고, 어디이며, 현재 local problem은 무엇이지?
- 방금 무엇이 바뀌었지?

근거:

- FairytaleQA에서 action이 31.59%로 가장 많다.
- NarrativeQA에서 what/person/description이 큰 비중을 차지한다.

출력:

- 1~3줄의 scene-local state
- active action, place, active cast, immediate goal/problem
- 필요하면 boundary delta chip 1개

정책:

- 기본 노출 가능성이 가장 높다.
- scene boundary 직후 또는 long pause / backscroll 후에만 visible.
- 한 scene에서 항상 1개 이하.

### B. Causal / Motivation Bridge

답하는 질문:

- 왜 지금 이런 일이 생겼지?
- 이 인물이 왜 그렇게 행동하지?
- 앞에서 어떤 사건이 지금 장면으로 이어졌지?

근거:

- FairytaleQA에서 causal relationship이 27.79%다.
- TellMeWhy는 narrative action의 why-question이 독립 benchmark가 될 만큼 중요하다는 점을 보여준다.
- INQUISITIVE에서도 why / causal function이 38.7%로 가장 크다.

출력:

- `Earlier -> So now` 구조
- evidence paragraph 1~2개
- inference strength 표시

정책:

- 높은 value를 주되, unsupported inference는 suppress.
- `strong_inference`는 기본 visible보다 expandable이 기본.
- user가 causal anchor를 열거나 backscroll / pause signal이 있을 때 promotion.

### C. Character Identity / Role Focus

답하는 질문:

- 이 인물은 누구지?
- 이 장면에서 이 인물의 역할은 무엇이지?
- 오랜만에 다시 나온 인물인가?

근거:

- NarrativeQA에서 Who가 23.37%, Person category가 30.54%다.
- FairytaleQA에서도 character question이 11.08%다.

출력:

- active character별 role in this beat
- previous known thread
- current constraint

정책:

- default visible로 두면 과하다.
- character reentry, high cast churn, dialogue-heavy scene, reader character tap에서 on-demand.
- Reader UI에서는 side card / popover가 적절하다.

### D. Character Feeling / Goal Repair

답하는 질문:

- 왜 이 인물이 이렇게 느끼지?
- 지금 이 인물이 원하는 것은 무엇이지?
- 감정 반응이 앞 사건과 어떻게 연결되지?

근거:

- FairytaleQA에서 feeling이 9.68%다.
- TellMeWhy의 why-action answer는 goal / motivation과 자주 얽힌다.

출력:

- emotion / goal / trigger event
- explicit evidence가 없으면 "가능한 해석"으로 낮은 confidence 표시

정책:

- feeling은 hallucination 위험이 높으므로 hard evidence 또는 strong prior가 필요하다.
- 기본 visible 금지.
- character card 안의 expandable point로 둔다.

### E. Relation / Social Delta

답하는 질문:

- 두 인물 관계가 어떻게 바뀌었지?
- 누가 누구 편이지?
- 이전 장면과 현재 alignment가 다른가?

근거:

- NarrativeQA category에서 relation 자체는 작지만, long narrative에서는 relation state가 다음 행동 이해를 좌우한다.
- MultiRC / HotpotQA 관점에서는 relation은 multi-sentence / multi-hop evidence chain으로 다뤄야 한다.

출력:

- `before -> now -> why it matters`
- relation change evidence

정책:

- relation edge가 새로 생기거나 polarity가 바뀔 때만 candidate.
- 기본은 expandable.
- relation delta가 current action 이해에 직접 필요하면 before-text promotion 가능.

### F. Setting / Spacetime Continuity

답하는 질문:

- 지금 어디지?
- 언제 일어난 일이지?
- 이 장면은 앞/뒤 사건과 어떤 순서지?
- 회상, 상상, 실제 storyworld 중 무엇이지?

근거:

- FairytaleQA의 setting은 5.95%지만, TORQUE는 temporal ordering 자체가 별도 reading comprehension challenge임을 보여준다.
- NarrativeQA에서도 location, where, when, duration이 반복된다.

출력:

- place chain
- time / order cue
- narrative scope label: actual, memory, imagination, hypothetical 등

정책:

- place/time shift가 큰 boundary에서는 short chip 가능.
- full card는 on-demand.
- visual support는 이 problem을 돕는 modality로만 연결한다.

### G. Reference / Elaboration Repair

답하는 질문:

- 이 대명사는 누구를 가리키지?
- 이 이름/사물/개념은 무엇이지?
- 이 표현의 맥락상 의미는 무엇이지?
- 예시는 무엇이지?

근거:

- MultiRC는 coreference가 multi-sentence question에서 매우 흔하다고 분석한다.
- INQUISITIVE에서 elaboration 21.6%, definition 12.6%, background 10.0%, instantiation 8.1%가 나온다.

출력:

- local referent
- short definition / contextual elaboration
- background는 현재 scene 이해에 필요한 최소량만

정책:

- reader_request, reference_tap, long pause signal에서 활성화.
- background는 spoiler와 외부지식 drift가 생기므로 evidence / source를 표시.
- 기본 visible 금지.

### H. Outcome / Thread Resolution

답하는 질문:

- 앞 사건은 결국 무엇으로 이어졌지?
- 이전 tension이 지금 해결되었나?
- 이 장면은 어떤 결과를 닫고 있나?

근거:

- FairytaleQA에서 outcome resolution이 9.32%, prediction이 4.59%다.
- INQUISITIVE도 forward-looking question을 관찰한다.

출력:

- already-revealed outcome만 요약
- unresolved tension은 "아직 열린 문제"로만 표시

정책:

- future prediction을 답처럼 보여주면 안 된다.
- `reveal_start <= reader_position`인 claim만 사용.
- `prediction`은 support answer가 아니라 reader-safe open question / tension marker로 변환.

### I. Session Re-entry Recap

답하는 질문:

- 쉬었다 돌아왔는데 지금 어디였지?
- 마지막으로 중요한 전환점은 무엇이었지?

근거:

- QA benchmark의 core category는 아니지만, 실제 reader support product에서는 명확한 runtime need다.
- 현재 `support-governor`도 resume gap 기반으로 `reentry_recap`을 다룬다.

출력:

- current state
- recent turning point
- unresolved tension

정책:

- session gap, chapter switch, tab restore에서만 trigger.
- 평소에는 숨긴다.

### J. Visual Grounding

답하는 질문:

- 장면의 공간 배치가 어떻게 생겼지?
- 현재 위치 / object / movement를 그림으로 보면 빨리 복구되는가?

근거:

- QA taxonomy에서 visual은 질문 유형이 아니다.
- 그러나 setting, spatial continuity, action state를 낮은 언어 비용으로 복구하는 modality가 될 수 있다.

출력:

- scene image
- spatial cue overlay
- cast / object anchors

정책:

- visual은 default help가 아니라 modality다.
- `visual_usefulness_score`가 높을 때만 눈에 띄게 노출한다.
- unsupported object/place detail이 많으면 minimized 또는 suppress.

## 6. Policy는 어떤 질문으로 바뀌어야 하는가

현재 policy 질문:

```text
이 support kind의 priority가 높은가?
```

권장 policy 질문:

```text
현재 reader position에서 이 reader problem이 발생했을 가능성이 높은가?
이 support가 그 problem을 evidence-grounded하게 해결하는가?
지금 보여주는 이득이 intrusion / spoiler / redundancy cost보다 큰가?
```

따라서 최종 decision은 다음처럼 모델링한다.

```text
expected_gain =
  need_probability
  * answer_usefulness
  * grounding
  * confidence
  * novelty

expected_cost =
  intrusion_cost
  + redundancy_cost
  + spoiler_risk
  + unsupported_inference_risk
  + fatigue_cost

decision_score = expected_gain - expected_cost
```

여기서 `need_probability`가 새로 들어가는 핵심이다. 현재 구현은 support 자체의 quality는 어느 정도 보지만, "이 장면에서 독자가 이 문제를 겪을 확률"을 충분히 분리하지 않는다.

## 7. Feature 설계

### 7.1 Need probability features

장면/텍스트 기반:

- place shift 발생
- time shift / flashback / memory scope 발생
- cast enter / exit 수
- active cast count
- dialogue density
- pronoun / definite description density
- new entity introduction
- entity reappearance after long gap
- causal edge into current scene
- unresolved prior thread into current scene
- relation polarity change
- outcome edge closing prior event
- scene title / summary의 movement, confusion, conflict signal

pipeline artifact 기반:

- `SUP.0.edges`
- `BOOK.0.edges`
- `NRG.0.claims`
- `STATE.3` boundary / place / cast change
- `SCENE.3` goals, main actions, relations, environment
- `SUB.2` causal input / result
- `SUB.4` character / pair hints
- `VIS.2` visual usefulness fields

reader runtime 기반:

- resume gap
- long pause
- backscroll
- repeated same-scene navigation
- support anchor tap
- character tap
- evidence request
- recent dismissals
- recent opens by support kind
- support fatigue score

### 7.2 Answer usefulness features

- support directly answers one high-priority reader problem
- body length is short enough for current display mode
- has current-scene anchor
- has contrastive before/now structure when relevant
- includes evidence label
- claim is reader-position-safe
- avoids duplicate support in same scene

### 7.3 Risk / cost features

- spoiler risk
- claim scope is not `actual`
- support level is `weak_inference`
- no evidence text
- generated visual contains unsupported details
- support duplicates default visible information
- support requires leaving narrative flow
- card count already high
- user recently dismissed same kind

## 8. Policy matrix

| ReaderProblem V2 | Default placement | Trigger conditions | Hard suppress conditions |
|---|---|---|---|
| `current_action_state` | visible max 1 | scene boundary, long pause, backscroll | low grounding, duplicate snapshot |
| `causal_motivation` | expandable | causal edge, reader request, backscroll, evidence request | weak inference without evidence, future reveal |
| `character_identity_role` | on-demand / side | character reentry, character tap, cast-heavy scene | no current-scene participation |
| `character_feeling_goal` | expandable inside character card | explicit emotion/goal cue, why-action cue | inferred emotion with weak evidence |
| `relation_social_delta` | expandable | relation change, dialogue-heavy scene, pair tap | no before/now contrast |
| `setting_spacetime_continuity` | chip or expandable | place/time shift, visual usefulness high | scope confusion, unsupported place |
| `reference_elaboration` | trigger-only | reference tap, high pronoun density, definition request | generic background unrelated to current scene |
| `outcome_thread_resolution` | expandable | prior thread closes at current scene | any unrevealed future content |
| `session_reentry` | trigger-only, promoted visible | resume gap, tab restore, chapter return | no meaningful gap |

## 9. Development plan

### M0. Taxonomy alignment

Goal:

- current support list를 QA-derived taxonomy에 맞춘다.

Tasks:

- `ReaderProblemV2`를 문서 기준으로 확정한다.
- 기존 `ReaderProblem`과 compatibility mapping을 만든다.
- `visual_context`를 reader problem이 아니라 modality로 취급하는 방침을 정한다.
- `reference_repair`의 범위를 entity reference에서 elaboration / definition / background까지 넓힌다.

Deliverable:

- schema proposal
- support kind / reader problem mapping table

### M1. Decision trace logging

Goal:

- 지금 rule이 왜 어떤 support를 보였는지 나중에 분석 가능하게 만든다.

Add:

```ts
interface SupportDecisionTrace {
  unit_id: string;
  scene_id: string;
  reader_problem: ReaderProblemV2;
  need_features: Record<string, number | boolean | string>;
  quality_features: Record<string, number | boolean | string>;
  cost_features: Record<string, number | boolean | string>;
  need_probability: number;
  expected_gain: number;
  expected_cost: number;
  decision_score: number;
  decision: "visible" | "expandable" | "trigger_only" | "suppressed";
  decision_reason: string[];
}
```

현재 `score_notes`는 사람이 읽기 좋은 문자열이다. 다음 단계에서는 structured trace가 필요하다.

Deliverable:

- `SUP.6` 또는 `SUP.V` artifact에 decision trace 저장
- Pipeline inspector에서 trace 확인

### M2. QA-derived reader-question bank

Goal:

- support candidate를 "질문에 대한 답"으로 검증할 수 있게 한다.

새 stage 후보:

```text
SUP.Q Reader Question Need Estimation
```

입력:

- current scene packet
- previous scene state
- `SUP.0`
- `BOOK.0`
- `NRG.0`
- reader position

출력:

```ts
interface ReaderQuestionNeed {
  question_id: string;
  scene_id: string;
  reader_problem: ReaderProblemV2;
  question_template: string;
  natural_question: string;
  evidence_expected_from:
    | "current_scene"
    | "prior_scene"
    | "cross_chapter_memory"
    | "reader_runtime"
    | "external_background_not_allowed";
  need_probability: number;
  trigger_evidence: string[];
  spoiler_sensitive: boolean;
}
```

예:

- "Why did X do Y?" -> `causal_motivation`
- "Who is X in this scene?" -> `character_identity_role`
- "What changed when the scene moved to place P?" -> `setting_spacetime_continuity`
- "What happened after earlier event E?" -> `outcome_thread_resolution`

중요:

- 이 stage는 사용자에게 질문을 보여주기 위한 것이 아니라, support 후보가 어떤 reader need를 해결하는지 평가하기 위한 internal representation이다.
- QA question generator는 LLM을 써도 되지만, final support는 evidence-grounded verifier를 통과해야 한다.

### M3. Annotation protocol

Goal:

- rule 기반 score를 학습 가능한 label로 바꿀 수 있게 한다.

Annotation unit:

```text
(reader position, support candidate, decision context)
```

Label:

- reader problem: taxonomy label
- answerability: supported / partially supported / unsupported / spoiler
- usefulness: 1~5
- timing: visible / expandable / trigger-only / suppress
- intrusion: low / medium / high
- evidence adequacy: explicit / inferred / weak / missing

Annotation questions:

- 이 support가 어떤 reader question에 답하는가?
- 그 question은 이 scene에서 실제로 생길 법한가?
- support가 답을 text/graph evidence로 충분히 뒷받침하는가?
- 지금 기본 노출하면 도움이 되는가, 방해되는가?
- 같은 장면의 다른 support와 중복되는가?

Deliverable:

- 100~200 scene-candidate pilot annotation
- support kind별 confusion matrix
- visible / expandable / suppress threshold 초안

### M4. Rule-based scorer V2

Goal:

- 학습 모델 전에 deterministic policy를 강하게 만든다.

권장 구조:

```text
1. hard guards
   - future spoiler
   - unsupported
   - low confidence
   - duplicate

2. need estimation
   - scene features
   - graph features
   - reader runtime features

3. quality estimation
   - grounding
   - claim confidence
   - brevity
   - contrastiveness

4. cost estimation
   - intrusion
   - redundancy
   - fatigue
   - visual unreliability

5. placement decision
   - visible max 1
   - expandable for high-value but intrusive support
   - trigger-only for runtime-dependent support
   - suppress when uncertain
```

Rule 예시:

```text
If reader_problem=current_action_state
and scene_boundary_active=true
and grounding>=0.6
and support_fatigue<0.65
then candidate for visible.
```

```text
If reader_problem=causal_motivation
and has_nrg_causal_claim=true
and support_level in {explicit,strong_inference}
and spoiler_risk=none
then expandable.
Promote to visible only when backscroll/long_pause/evidence_request is active.
```

```text
If reader_problem=outcome_thread_resolution
and reveal_start > reader_position
then suppress as spoiler.
```

### M5. Learning-to-rank / calibrated gate

Goal:

- rule score를 유지하되, threshold와 weighting을 annotation / logs로 보정한다.

추천 접근:

- 먼저 logistic regression 또는 gradient boosted trees로 시작한다.
- label은 `should_show_visible`, `should_enable_on_demand`, `should_suppress`처럼 작게 나눈다.
- hard guard는 모델 밖에 둔다.
- 모델은 `need_probability`, `expected_gain`, `expected_cost` calibration에만 사용한다.

왜 바로 LLM policy가 아닌가:

- LLM은 explanation은 잘하지만 threshold 안정성이 낮을 수 있다.
- UI intervention policy는 재현 가능성과 ablation이 중요하다.
- 작은 feature-based model이 논문 contribution과 evaluation에 더 방어 가능하다.

Deliverable:

- scorer v2와 learned gate 비교
- annotation set에서 calibration curve
- support kind별 false positive / false negative analysis

### M6. Runtime personalization

Goal:

- 같은 support라도 독자 상태에 따라 노출 방식을 바꾼다.

초기 personalization은 복잡하게 가지 않는다.

Use:

- recent support opens by kind
- recent dismissals
- long pause
- backscroll
- resume gap
- support fatigue score

Do not use initially:

- detailed reading speed inference
- opaque user profiling
- sensitive behavioral inference

Policy:

- 자주 열어본 kind는 on-demand rank를 올린다.
- 자주 dismiss한 kind는 visible에서 제외한다.
- fatigue가 높으면 visible을 0개로 줄인다.
- reentry gap이 크면 recap을 visible 후보로 올린다.

### M7. Evaluation and ablation

Goal:

- "더 많은 support"가 아니라 "필요한 순간의 정확한 support"가 좋아졌는지 검증한다.

Offline:

- support usefulness annotation
- grounding correctness
- timing appropriateness
- spoiler / unsupported error rate

Runtime logs:

- candidate generated
- candidate suppressed
- support shown
- support opened
- support dismissed
- evidence requested
- scene revisit / backscroll after support

User study:

- no support
- generic summary
- QA-taxonomy targeted support
- targeted support + visual only when useful

Outcome:

- current scene state reconstruction accuracy
- causal linkage recall
- character role recovery
- place/time continuity accuracy
- reentry time
- perceived interruption

## 10. Concrete implementation sequence

### Step 1. Documentation and schema proposal

- 이 문서를 기준으로 `reader-support-design.md`와 `reader-position-aware-recovery-plan.md`의 taxonomy 표현을 맞춘다.
- `ReaderProblemV2`, `SupportNeed`, `SupportForm`, `SupportModality`를 proposal로 적는다.

### Step 2. Non-breaking metadata addition

기존 artifacts를 깨지 않기 위해 먼저 optional field로 추가한다.

```ts
interface SupportUnit {
  reader_problem_v2?: ReaderProblemV2;
  support_form?: SupportForm;
  support_modality?: SupportModality;
  need_probability?: number;
  decision_trace?: SupportDecisionTrace;
}
```

### Step 3. SUP.V / scorer 분리

현재 `supportFinalScore()`와 `verifySupportUnits()`에 나뉜 scoring logic을 `SUP.V` 또는 `support-policy-scorer.ts`로 분리한다.

분리 이유:

- generator는 후보를 만든다.
- verifier는 grounded / unsupported / spoiler를 본다.
- scorer는 need와 cost를 본다.
- governor는 runtime state로 placement를 조정한다.

### Step 4. Question need estimation 추가

처음에는 rule-based로 충분하다.

예:

- place_changed -> `setting_spacetime_continuity` need +0.25
- cast_entered after absence -> `character_identity_role` need +0.25
- causal_edge into current scene -> `causal_motivation` need +0.35
- pronoun density high -> `reference_elaboration` need +0.2
- resume gap > 10min -> `session_reentry` need +0.5

나중에는 LLM-generated question bank와 annotation으로 보정한다.

### Step 5. UI policy guard 유지

Reader UI rule은 계속 단순해야 한다.

- visible support max 1
- visual default minimized unless high usefulness
- uncertain support hidden
- evidence available on demand
- research mode can expose provenance; reader mode should not

## 11. 논문 contribution으로 정리할 때의 주장

약한 주장:

- "우리는 소설에 여러 종류의 도움을 제공한다."
- "우리는 QA를 사용해서 support를 만든다."
- "우리는 이미지와 요약을 함께 보여준다."

강한 주장:

- "QA-derived reader problem taxonomy를 사용해 long-form fiction의 support need를 정의한다."
- "Narrative graph / reader-safe claim layer에서 support candidates를 만들고, answerability, spoiler risk, intrusion cost를 고려해 runtime intervention을 결정한다."
- "Support generation을 UI card 생성 문제가 아니라 reader-position-aware need estimation + evidence-grounded policy selection 문제로 재정의한다."

최종 framing:

```text
QA-derived, reader-position-aware support policy for long-form narrative comprehension:
from narrative question types to evidence-grounded, spoiler-safe, low-intrusion reading support.
```

## 12. 당장 바꿔야 할 우선순위

1. support taxonomy를 `ReaderProblem` 중심으로 재정리한다.
2. `visual_context`를 독립 help type이 아니라 support modality로 낮춘다.
3. `current_action_state`, `character_feeling_goal`, `reference_elaboration`, `outcome_thread_resolution`, `setting_spacetime_continuity`를 명시한다.
4. `need_probability`를 scoring의 독립 항으로 추가한다.
5. `SUP.6` 또는 새 `SUP.V`에 structured decision trace를 저장한다.
6. visible support는 계속 최대 1개로 제한한다.
7. future spoiler, unsupported inference, low grounding은 더 긴 설명이 아니라 suppress로 처리한다.

## 13. 참고 문헌

- [The NarrativeQA Reading Comprehension Challenge](https://arxiv.org/abs/1712.07040)
- [Fantastic Questions and Where to Find Them: FairytaleQA](https://arxiv.org/abs/2203.13947)
- [TellMeWhy: A Dataset for Answering Why-Questions in Narratives](https://aclanthology.org/2021.findings-acl.53/)
- [Inquisitive Question Generation for High Level Text Comprehension](https://aclanthology.org/2020.emnlp-main.530/)
- [TORQUE: A Reading Comprehension Dataset of Temporal Ordering Questions](https://aclanthology.org/2020.emnlp-main.88/)
- [MultiRC: Reading Comprehension over Multiple Sentences](https://cogcomp.seas.upenn.edu/multirc/)
- [HotpotQA: A Dataset for Diverse, Explainable Multi-hop Question Answering](https://arxiv.org/abs/1809.09600)
- [Know What You Don't Know: Unanswerable Questions for SQuAD](https://nlp.stanford.edu/pubs/rajpurkar2018squad.pdf)
