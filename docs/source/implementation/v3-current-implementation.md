# V3 현재 구현 상태

Last updated: 2026-07-15

이 문서는 현재 코드베이스에 구현된 V3만 정리한다. V2는 비교 대상이 아니라, V3가 V2와 분리되어 접근 가능하게 유지되는 지점이나 기존 `current` 데이터를 읽는 지점에서만 언급한다.

## 1. 라우트와 화면 구조

V3는 파일 선택 화면과 작업 화면이 분리되어 있다.

### `/v3/library`

- 구현 파일: `src/app/v3/library/page.tsx`
- 주요 컴포넌트: `src/components/v3/V3LibraryPage.tsx`
- 역할:
  - 새 EPUB을 V3 소스로 업로드한다.
  - 기존 `current` 소스의 EPUB을 V3 작업 대상으로 열 수 있다.
  - V3에 이미 업로드된 EPUB도 다시 열 수 있다.
- 문서를 열면 `/v3?docId=...&chapterId=...&source=...` 형태로 이동한다.

### `/v3`

- 구현 파일: `src/app/v3/page.tsx`
- `docId`가 없으면 `/v3/library`로 리다이렉트한다.
- `docId`, `chapterId`, `source`를 `PreMentionWorkbench`에 전달한다.
- `source`는 `current`, `legacy`, `v3`를 지원한다.

### 공통 UI

- V2/V3 전환은 `AppVersionSwitcher`로 제공된다.
- V2는 별도 경로로 계속 접근 가능하다.
- 테마 스위처와 언어 스위처는 V3 화면에서도 공유된다.

## 2. 데이터 저장소 분리

V3는 V2/current 데이터와 같은 위치에 결과를 저장하지 않도록 `source` 기반 분리를 사용한다.

관련 파일:

- `src/lib/data-source.ts`
- `src/lib/firestore.ts`
- `src/lib/storage.ts`
- `src/lib/client-data.ts`

현재 소스별 저장 위치:

| Source | Firestore collection | Storage prefix |
| --- | --- | --- |
| `legacy` | `documents` | 기존 legacy prefix |
| `current` | `documents_v2` | current/V2 prefix |
| `v3` | `documents_v3` | `documents_v3` |

V3 작업 결과는 항상 `source: "v3"`로 저장된다. 다만 `seedSource`는 별도로 유지된다. 그래서 기존 `current` 문서의 원문 챕터를 읽어서 V3 run을 만들 수 있고, 그 결과물은 V3 저장소에 저장된다.

## 3. 메인 워크벤치

메인 컴포넌트는 `src/components/v3/PreMentionWorkbench.tsx`다.

화면 구성:

- 헤더:
  - 현재 문서, 챕터, run 상태를 보여준다.
  - `Change document`로 `/v3/library`에 돌아갈 수 있다.
- 사이드바:
  - 챕터 선택
  - 이전/다음 챕터 이동
  - run 선택
  - 새 run 생성
  - 저장된 결과 새로고침
- 메인 뷰:
  - `Pipeline`: 단계별 실행과 결과 확인
  - `Timeline graph`: EVENT/SCENE 결과를 타임라인 그래프로 확인
  - `Reading QA`: 읽은 위치를 지정하고 질문에 대한 검색 근거를 확인
- 단계 레일:
  - 현재 V3의 19개 주요 단계를 보여준다.
  - 선행 단계 결과가 없으면 다음 단계는 잠긴다.
  - LLM 단계는 stage별 모델 문자열을 수정할 수 있다.

## 4. V3 파이프라인 전체 구조

현재 노출된 V3 주요 단계는 18개다.

| 순서 | 단계 | 역할 |
| --- | --- | --- |
| 1 | `PRE.1` | EPUB 원문을 JSON/챕터 구조로 준비 |
| 2 | `PRE.2` | 서사 문단 추출과 정렬 |
| 3 | `EVID.1A` | `cast`, `place`, `time`, `object` 후보 추출 |
| 4 | `EVID.1B` | `action` 후보 추출 |
| 5 | `EVID.1C` | `goal` cue 후보 추출 |
| 6 | `EVID.1D` | `causality` cue 후보 추출 |
| 7 | `EVID.2` | 후보 정제, 타입 보정, 잘못된 후보 제거 |
| 8 | `EVID.3` | event 구성에 쓸 핵심 후보와 보조 후보 분리 |
| 9 | `EVID.4` | 같은 대상의 `cast`, `place`, `time`, `object` 묶기 |
| 10 | `EVENT.1` | 정제된 후보를 event 단위로 묶기 |
| 11 | `SCENE.0` | event를 scene 단위로 병합 |
| 12 | `MEM.0` | event-scene membership과 stable ref 계약 고정 |
| 13 | `MEM.1` | scene situation card 생성 |
| 14 | `EVENT.2` | event argument frame 정규화 |
| 15 | `GOAL.1` | goal cue를 event actor와 scene에 grounding |
| 16 | `CAUS.1` | explicit causal cue를 event-event edge 후보로 정리 |
| 17 | `MEM.2` | progressive narrative memory 생성 |
| 18 | `IDX.1` | QA 준비용 structured/graph retrieval index 생성 |
| 19 | `IDX.2` | text document embedding과 vector bundle 생성 |

`ENT.1`은 sidecar 단계로 남아 있다. scene boundary용 mention 정규화 단계이며, 현재 메인 19단계 레일에는 포함되어 있지 않다.

## 5. 후보 타입

V3의 evidence 후보 타입은 `src/lib/pipeline/v3-evidence-types.ts`에 정의되어 있다.

현재 사용하는 7가지 타입:

- `cast`
- `place`
- `time`
- `object`
- `action`
- `goal`
- `causality`

이 타입들은 처음부터 확정값으로 다루지 않고 candidate/cue로 추출한다. 이후 정제, 격하, 클러스터링, event grouping 단계에서 다시 사용한다.

## 6. 단계별 구현 요약

### `PRE.1`

- EPUB 원문과 챕터 메타데이터를 준비한다.
- V3 업로드일 경우 V3 source에 저장된다.

### `PRE.2`

- 챕터 본문에서 narrative paragraph를 정리한다.
- 이후 모든 V3 evidence 단계의 입력이 된다.

### `EVID.1A` to `EVID.1D`

구현 파일:

- `src/lib/pipeline/v3-evidence.ts`
- `src/lib/pipeline/v3-evidence-types.ts`

구성:

- `EVID.1A`: entity candidates, `cast/place/time/object`
- `EVID.1B`: action candidates
- `EVID.1C`: goal cues
- `EVID.1D`: causality cues

현재 배치 정책:

- 문단 4개 단위
- 최대 3000자
- 병렬도 4
- JSON 응답이 잘리는 경우 일부 복구 로직을 둔다.
- span 위치 검증을 수행한다.

### `EVID.2`

구현 파일:

- `src/lib/pipeline/v3-evidence-refinement.ts`

역할:

- 명백히 잘못된 후보 제거
- 타입 보정
- 같은 evidence pass 안에서 source 후보 누락 방지
- 보수적인 merge/correction 수행

상태값:

- `kept_core`
- `kept_context`
- `corrected`

중요한 제한:

- source type이 호환되지 않는 후보끼리는 강제로 합치지 않는다.

### `EVID.3`

구현 파일:

- `src/lib/pipeline/v3-evidence-gate.ts`
- `src/lib/pipeline/v3-evidence-gate-core.ts`
- `src/lib/pipeline/v3-evidence-gate-types.ts`

역할:

- event 구성에 직접 쓸 후보를 `core`로 둔다.
- 이야기 이해에는 도움이 되지만 event 축에는 약한 후보를 `support`로 둔다.
- 명백한 오탐이나 noise는 `drop`한다.

현재 중요한 규칙:

- 비참여자 placeholder cast는 강제 drop 대상이다.
- mental/cognitive place는 강제 drop 대상이다.
- `support`와 `drop` 후보는 timeline graph에 표시하지 않는다.

### `EVID.4`

구현 파일:

- `src/lib/pipeline/v3-evidence-clustering.ts`

역할:

- `cast`, `place`, `time`, `object`에서 같은 대상을 cluster로 묶는다.
- `action`, `goal`, `causality`는 현재 클러스터링하지 않는다.

현재 방식:

- LLM이 아니라 rule 기반이다.
- 관사, 지시어, 하이픈, 일부 수식어를 정규화한다.
- unresolved English pronoun만으로 cluster가 만들어지지 않도록 막는다.
- context-dependent time label은 별도로 유지한다.

### `EVENT.1`

구현 파일:

- `src/lib/pipeline/v3-event-grouping.ts`

역할:

- `EVID.4`까지 정리된 후보를 바탕으로 event candidate를 만든다.
- source occurrence 단위로 evidence를 확장해 사용한다.
- cluster 정보가 있으면 event evidence에 함께 붙인다.

현재 정책:

- `drop` evidence는 제외한다.
- `support` evidence는 event axis 구성에는 쓰지 않는다.
- LLM이 빠뜨린 action이 있으면 fallback event를 만든다.

### `SCENE.0`

구현 파일:

- `src/lib/pipeline/v3-scene-grouping.ts`

역할:

- `EVENT.1` 결과를 더 큰 scene 단위로 묶는다.
- 기준 축은 `time`, `place`, `action_focus`, `cast`다.

현재 해석:

- 여기서 `action_focus`는 단발 행동이 아니라 중심 행동, 장면의 의미적 초점, 큰 목표 변화에 가깝게 사용한다.
- LLM이 event를 누락하면 fallback scene으로 보존한다.

### `MEM.0`

구현 파일:

- `src/lib/pipeline/v3-memory-contract.ts`
- `src/lib/pipeline/v3-memory-contract-types.ts`

역할:

- `EVENT.1`과 `SCENE.0` 결과를 다음 단계가 안정적으로 쓸 수 있는 contract로 고정한다.
- 모든 event의 scene membership, paragraph span, core/context/drop evidence ref 분리를 보존한다.
- support/drop evidence가 event core axis로 흘러 들어가는 경우 diagnostics로 남긴다.

### `MEM.1`

구현 파일:

- `src/lib/pipeline/v3-memory-frames.ts`
- `src/lib/pipeline/v3-memory-frames-types.ts`

역할:

- `MEM.0` contract를 scene-level situation card로 바꾼다.
- scene card는 time, place, cast, action_focus, salient object, explicit goal/tension cue를 가진다.
- 기존 `SCENE.1` stage와 충돌하지 않도록 V3에서는 `MEM.1` 이름을 사용한다.

### `EVENT.2`

구현 파일:

- `src/lib/pipeline/v3-memory-frames.ts`
- `src/lib/pipeline/v3-memory-frames-types.ts`

역할:

- `MEM.0` event contract를 predicate-argument frame으로 정규화한다.
- action evidence의 `subject_hint` / `object_hint`가 기존 cast/object evidence와 정확히 맞을 때만 `actor`, `target_object` role을 붙인다.
- 불확실한 cast는 `mentioned_only`, object는 `theme_object`, place는 `location`, time은 `time_anchor`로 보수적으로 둔다.

### `GOAL.1`

구현 파일:

- `src/lib/pipeline/v3-narrative-memory.ts`
- `src/lib/pipeline/v3-narrative-memory-types.ts`

역할:

- `goal` cue를 가장 가까운 event, scene, holder 후보에 연결한다.
- goal을 cast 내부 속성으로 고정하지 않고 situation-model 계층의 intentionality cue로 둔다.
- holder가 event actor와 맞으면 `actor_goal`, 그 외에는 `scene_goal`로 보수적으로 분류한다.

### `CAUS.1`

구현 파일:

- `src/lib/pipeline/v3-narrative-memory.ts`
- `src/lib/pipeline/v3-narrative-memory-types.ts`

역할:

- `causality` cue를 event-event causal edge 후보로 변환한다.
- 문단 범위와 명시적 cue span으로 연결 가능한 경우에만 edge를 만든다.
- temporal adjacency는 causal edge로 승격하지 않는다.

### `MEM.2`

구현 파일:

- `src/lib/pipeline/v3-narrative-memory.ts`
- `src/lib/pipeline/v3-narrative-memory-types.ts`

역할:

- scene card, event frame, grounded goal, causal edge를 묶어 progressive narrative memory를 만든다.
- 현재는 QA 이전의 deterministic memory layer이며, character/place/object/goal/timeline/causal graph summary를 제공한다.

### `IDX.1`

구현 파일:

- `src/lib/pipeline/v3-narrative-memory.ts`
- `src/lib/pipeline/v3-narrative-memory-types.ts`

역할:

- QA retrieval이 바로 사용할 수 있는 structured records와 graph edges를 만든다.
- semantic index의 canonical source text를 제공한다.

### `IDX.2`

구현 파일:

- `src/lib/pipeline/v3-semantic-index.ts`
- `src/lib/pipeline/v3-semantic-index-types.ts`
- `src/lib/embedding-client.ts`
- `src/app/api/pipeline/v3-semantic-index/route.ts`

역할:

- `IDX.1.text_documents`를 `openai/text-embedding-3-small`로 임베딩한다.
- Firestore artifact에는 model, dimensions, source fingerprint, Storage pointer만 저장한다.
- 실제 vector 배열은 V3 Firebase Storage namespace에 gzip blob으로 저장한다.
- semantic index write API는 `source: "v3"`만 허용하며 current/legacy namespace 쓰기를 거부한다.
- blob hash와 source fingerprint를 query 시 검증해 stale vector 사용을 막는다.

### Query-time `Reading QA`

구현 파일:

- `src/lib/pipeline/v3-qa-retrieval.ts`
- `src/lib/pipeline/v3-qa-retrieval-types.ts`
- `src/lib/pipeline/v3-qa-answer.ts`
- `src/lib/pipeline/v3-qa-answer-types.ts`
- `src/lib/server/v3-qa-retrieval-service.ts`
- `src/lib/server/v3-qa-history.ts`
- `src/lib/v3-qa-history-types.ts`
- `src/app/api/pipeline/v3-qa-retrieve/route.ts`
- `src/app/api/pipeline/v3-qa-answer/route.ts`
- `src/app/api/v3/qa-history/route.ts`
- `src/components/v3/V3ReadingQAView.tsx`
- `src/components/v3/V3QAHistoryPanel.tsx`

역할:

- 사용자가 V3 워크벤치 안에서 질문을 입력하고, 현재 읽은 문단 위치를 선택한다.
- `IDX.1`, optional `IDX.2`, `MEM.1`, `EVENT.2`, `MEM.0`을 읽어 reader-progress-bounded evidence search를 수행한다.
- `progressEndPid`는 필수이며, 읽지 않은 paragraph span과 진행 위치를 확인할 수 없는 record를 먼저 제거한다.
- lexical rank와 semantic rank를 Reciprocal Rank Fusion으로 결합한 뒤, 허용된 record 사이에서만 graph neighbor를 확장한다.
- character record에는 첫 등장 event/scene을 연결해 reader-progress span을 복원한다.
- `IDX.2`가 없는 기존 run은 lexical + graph fallback으로 계속 동작한다.
- 답변 생성에는 검색 결과가 가리키는 PRE.1 원문 문단만 전달하며 `progressEndPid` 이후 문단은 포함하지 않는다. LLM용 evidence text도 retrieval summary를 재사용하지 않고 선택된 원문 문단으로 다시 만든다.
- LLM은 답변, paragraph PID, retrieval evidence ID를 반환한다. 서버는 존재하지 않거나 서로 연결되지 않은 PID/evidence ID가 하나라도 있으면 전체 답변을 거부한다.
- 검증된 문단 인용과 retrieval evidence가 모두 일치하지 않으면 답변을 `insufficient_evidence`로 낮춘다. 이 상태의 모델 생성 문장은 폐기하고 UI의 고정 문구를 사용한다.
- 질문이나 진행 위치가 바뀌면 진행 중인 이전 요청의 응답은 UI에 반영하지 않는다. document/chapter/run 변경 시에는 QA view를 재마운트한다.
- 검색 근거 카드도 UI에서 span을 다시 검사하고 `end_pid <= progressEndPid`인 record만 표시한다.
- Reading QA의 P# 인용 버튼은 해당 원문 문단으로 이동한다. 검색 결과 카드는 답변 아래에서 근거 확인용으로 유지한다.
- 검증된 답변은 document/chapter/run scope의 V3 전용 Firestore 하위 컬렉션에 자동 저장한다.
- 기록 패널은 최신 20개를 먼저 읽고, `Load more`로 20개씩 추가한다.
- 저장 기록을 선택하면 LLM을 다시 호출하지 않고 질문, 답변, 인용, retrieval hit snapshot을 복원한다.
- 개별 기록을 삭제할 수 있으며, 기록 저장·조회 오류는 현재 QA 답변 흐름을 막지 않는다.

## 7. 프롬프트 구성

현재 V3에서 사용하는 주요 prompt id:

| 단계 | Prompt id |
| --- | --- |
| `EVID.1A` | `v3_evid1a_entity_candidates` |
| `EVID.1B` | `v3_evid1b_action_candidates` |
| `EVID.1C` | `v3_evid1c_goal_cues` |
| `EVID.1D` | `v3_evid1d_causal_cues` |
| `EVID.2` | `v3_evid2_candidate_refine` |
| `EVID.3` | `v3_evid3_candidate_gate` |
| `EVENT.1` | `v3_event1_group_events` |
| `SCENE.0` | `v3_scene0_group_scenes` |
| `ENT.1` | `v3_scene_boundary_mentions` |
| `QA.A1` | `v3_qa_grounded_answer` |

## 8. 결과 표시 UI

관련 파일:

- `src/components/v3/PreStageViews.tsx`
- `src/components/v3/V3BodyResultView.tsx`
- `src/components/v3/V3EvidenceStageView.tsx`
- `src/components/v3/V3EvidenceRefinementStageView.tsx`
- `src/components/v3/V3EvidenceGateStageView.tsx`
- `src/components/v3/V3EvidenceClusteringStageView.tsx`
- `src/components/v3/V3EventGroupingStageView.tsx`
- `src/components/v3/V3SceneGroupingStageView.tsx`
- `src/components/v3/V3MentionStageView.tsx`
- `src/components/v3/V3SceneCardsStageView.tsx`
- `src/components/v3/V3EventFramesStageView.tsx`
- `src/components/v3/V3GoalGroundingStageView.tsx`
- `src/components/v3/V3CausalEdgesStageView.tsx`
- `src/components/v3/V3ProgressiveMemoryStageView.tsx`
- `src/components/v3/V3RetrievalIndexStageView.tsx`

현재 결과 UI는 원문 기반 확인을 중심으로 구성되어 있다.

- 본문 위에 evidence span을 하이라이트한다.
- 선택한 결과의 세부 정보를 사이드 패널에서 확인한다.
- 단계별 summary와 counters를 제공한다.
- 결과가 많아질수록 아래로 밀리는 문제를 줄이기 위해 파일 선택은 `/v3/library`로 분리했다.

## 9. Timeline Graph View

관련 파일:

- `src/components/v3/V3TimelineGraphView.tsx`
- `src/components/v3/v3-timeline-graph-utils.ts`

입력:

- `EVENT.1`의 event candidates와 evidence occurrences
- `SCENE.0`의 scene candidates

현재 시각화 구조:

- 상단에 scene band를 가로로 보여준다.
- event card를 시간 순서로 가로 배치한다.
- 아래 축에는 `cast`, `place`, `time`, `object`, `goal`, `causality`를 표시한다.
- 같은 요소가 여러 event에 등장하면 연결선으로 이어준다.
- event footprint bar로 event 범위를 빠르게 볼 수 있다.
- 선택한 event/scene/node 정보는 detail panel에서 확인한다.

현재 graph filtering:

- `support`와 `drop` evidence는 graph에 표시하지 않는다.
- `cast`는 가능하면 `entity_cluster_id`를 사용한다.
- `place`, `time`, `object`는 graph 내부에서 다시 label을 정규화한다.
- `object`는 같은 정규화 key가 둘 이상의 event에 나올 때 graph에 표시한다.
- `time`은 concrete anchor 중심으로 표시하고, `this time`, `a moment`, `afterwards` 같은 context-dependent label은 제외한다.
- `place`는 `air`, `down here`, `here`, `there` 같은 약한 label을 제외한다.

## 10. 의존성과 재실행 규칙

단계 의존성:

- `PRE.2` requires `PRE.1`
- `EVID.1A-D` requires `PRE.2`
- `ENT.1` requires `PRE.2`
- `EVID.2` requires all `EVID.1A-D`
- `EVID.3` requires `EVID.2`
- `EVID.4` requires `EVID.3`
- `EVENT.1` requires `EVID.4`
- `SCENE.0` requires `EVENT.1`
- `MEM.0` requires `SCENE.0`
- `MEM.1` requires `MEM.0`
- `EVENT.2` requires `MEM.1`
- `GOAL.1` requires `EVENT.2`, `MEM.0`, `MEM.1`
- `CAUS.1` requires `EVENT.2`, `GOAL.1`, `MEM.0`
- `MEM.2` requires `MEM.1`, `EVENT.2`, `GOAL.1`, `CAUS.1`
- `IDX.1` requires `MEM.1`, `EVENT.2`, `GOAL.1`, `CAUS.1`, `MEM.2`
- `IDX.2` requires `IDX.1`

재실행 시 downstream 결과는 삭제된다.

- `PRE.1` 재실행: 사실상 전체 downstream 삭제
- `PRE.2` 재실행: evidence 이후 삭제
- `EVID.1*` 재실행: `EVID.2` 이후 삭제
- `EVID.2` 재실행: `EVID.3` 이후 삭제
- `EVID.3` 재실행: `EVID.4` 이후 삭제
- `EVID.4` 재실행: `EVENT.1`부터 `IDX.2`까지 downstream 삭제
- `EVENT.1` 재실행: `SCENE.0`부터 `IDX.2`까지 downstream 삭제
- `SCENE.0` 재실행: `MEM.0`부터 `IDX.2`까지 downstream 삭제
- `MEM.0` 재실행: `MEM.1`부터 `IDX.2`까지 downstream 삭제
- `MEM.1` 재실행: `EVENT.2`부터 `IDX.2`까지 downstream 삭제
- `EVENT.2` 재실행: `GOAL.1`부터 `IDX.2`까지 downstream 삭제
- `GOAL.1` 재실행: `CAUS.1`부터 `IDX.2`까지 downstream 삭제
- `CAUS.1` 재실행: `MEM.2`, `IDX.1`, `IDX.2` 삭제
- `MEM.2` 재실행: `IDX.1`, `IDX.2` 삭제
- `IDX.1` 재실행: `IDX.2` 삭제

## 11. 모델 기본값

관련 파일:

- `src/config/pipeline-models.ts`

현재 기본값:

| 단계 | 기본 모델 |
| --- | --- |
| `PRE.2` | `openai/gpt-4o-mini` |
| `EVID.1A-D` | `google/gemini-3.5-flash` |
| `EVID.2` | `google/gemini-3.5-flash` |
| `EVID.3` | `google/gemini-3.5-flash` |
| `EVENT.1` | `google/gemini-3.5-flash` |
| `SCENE.0` | `google/gemini-3.5-flash` |
| `ENT.1` | `google/gemini-3.5-flash` |

`EVID.4`, `MEM.0`, `MEM.1`, `EVENT.2`, `GOAL.1`, `CAUS.1`, `MEM.2`, `IDX.1`은 rule-only라 모델을 사용하지 않는다. `IDX.2`는 기본적으로 OpenRouter의 `openai/text-embedding-3-small`을 사용한다.

## 12. API 요약

V3에서 직접 사용하거나 V3 source를 지원하는 endpoint:

- `POST /api/epub`
  - `source`를 받는다.
  - V3 업로드는 V3 source에 저장된다.
- `GET /api/runs?docId=...&chapterId=...&source=v3`
  - V3 run 목록을 읽는다.
- `GET /api/run-results?docId=...&chapterId=...&runId=...&source=v3`
  - V3 run의 모든 stage result를 읽는다.
- `GET /api/stage-result?...&source=v3`
  - 단일 stage result를 읽는다.
- `DELETE /api/stage-result`
  - `source: "v3"`일 때 V3 stage result를 삭제한다.
- `POST /api/run-stage-models`
  - stage별 모델 선택값을 저장한다.
- `POST /api/pipeline/v3-evidence`
  - `EVID.1A-D` 실행
- `POST /api/pipeline/v3-evidence-refine`
  - `EVID.2` 실행
- `POST /api/pipeline/v3-evidence-gate`
  - `EVID.3` 실행
- `POST /api/pipeline/v3-evidence-cluster`
  - `EVID.4` 실행
- `POST /api/pipeline/v3-events`
  - `EVENT.1` 실행
- `POST /api/pipeline/v3-scenes`
  - `SCENE.0` 실행
- `POST /api/pipeline/v3-memory-contract`
  - `MEM.0` 실행
- `POST /api/pipeline/v3-scene-cards`
  - `MEM.1` 실행
- `POST /api/pipeline/v3-event-frames`
  - `EVENT.2` 실행
- `POST /api/pipeline/v3-goals`
  - `GOAL.1` 실행
- `POST /api/pipeline/v3-causality`
  - `CAUS.1` 실행
- `POST /api/pipeline/v3-progressive-memory`
  - `MEM.2` 실행
- `POST /api/pipeline/v3-retrieval-index`
  - `IDX.1` 실행
- `POST /api/pipeline/v3-semantic-index`
  - `source: "v3"`에서만 `IDX.2` embedding과 vector Storage 저장 실행
- `POST /api/pipeline/v3-qa-retrieve`
  - 필수 `progressEndPid` 경계 안에서 query-time Reading QA evidence retrieval 실행
- `POST /api/pipeline/v3-qa-answer`
  - 동일한 progress-safe retrieval을 사용해 원문 근거 답변과 서버 검증 인용을 생성
- `GET|POST|DELETE /api/v3/qa-history`
  - V3 document/chapter/run scope의 QA 기록을 20개 단위로 조회·저장·삭제
- `POST /api/pipeline/v3-mentions`
  - sidecar `ENT.1` 실행

## 13. 테스트

현재 V3 관련 테스트 파일:

- `tests/v3-body-result-utils.test.ts`
- `tests/v3-event-axis-core.test.ts`
- `tests/v3-evidence-clustering.test.ts`
- `tests/v3-evidence-gate.test.ts`
- `tests/v3-evidence-refinement.test.ts`
- `tests/v3-memory-contract.test.ts`
- `tests/v3-memory-frames.test.ts`
- `tests/v3-narrative-memory.test.ts`
- `tests/v3-qa-answer.test.ts`
- `tests/v3-qa-history.test.ts`
- `tests/v3-qa-retrieval.test.ts`
- `tests/v3-semantic-index.test.ts`
- `tests/v3-semantic-stage-registration.test.ts`
- `tests/v3-navigation.test.ts`
- `tests/v3-timeline-graph-utils.test.ts`

테스트가 다루는 범위:

- 본문 하이라이트 segment 생성
- event axis에서 `support/drop` 제외
- evidence refinement source-type compatibility
- evidence gate artifact guard와 forced drop rule
- entity clustering normalization
- MEM.0 contract 생성과 support/drop 차단
- MEM.1 scene card 생성
- EVENT.2 argument frame role 생성
- GOAL.1 goal grounding
- CAUS.1 causal edge 생성
- MEM.2 progressive memory와 IDX.1 retrieval record 생성
- IDX.2 source fingerprint, vector validation, cosine similarity, compact metadata
- Reading QA retrieval의 필수 progress cutoff, unknown-span fail-closed, semantic/lexical RRF, lexical fallback, graph neighbor expansion
- Reading QA answer context의 progress cutoff와 원문 문단 budget
- 존재하지 않거나 서로 연결되지 않은 paragraph/evidence 인용의 fail-closed downgrade
- insufficient-evidence 모델 문장 폐기
- QA 기록의 V3-only scope, cursor pagination, 20개 page size, payload validation
- Reading QA 표시 hit의 progress span 재검증
- IDX.2 write source의 V3-only 제약
- V3 navigation query 생성과 parsing
- timeline graph node filtering, repeated links, lane packing, selection helper

## 14. 현재 한계와 주의점

- V3는 현재 chapter/run 단위다. full-book orchestration은 아직 없다.
- Reading QA 답변은 저장되지만 각 항목은 독립된 단일 질문이다. 후속 질문 문맥과 streaming은 아직 없다.
- `EVID.4`는 rule 기반이며, 완전한 LLM coreference 단계는 아니다.
- `action`, `goal`, `causality`는 entity clustering 대상이 아니다.
- `IDX.2`는 현재 chapter/run 단위의 Storage blob이며 전용 vector database나 ANN index는 사용하지 않는다.
- Reading QA는 semantic + lexical RRF와 graph expansion까지 구현되어 있지만 cross-encoder reranker는 아직 없다.
- 답변 검증은 인용 ID와 source span의 구조적 일치까지 담당한다. 자연어 답변의 entailment를 별도 verifier 모델로 재판정하지는 않는다.
- timeline graph는 전체 후보 dump가 아니라, event/scene 이해에 필요한 요소를 선별해서 보여주는 curated view다.
- `support` 후보는 artifact에는 남지만 graph에서는 숨긴다.
- object는 반복 등장하지 않으면 graph에서 숨기는 정책이 들어가 있다.
- place는 object보다 덜 강하게 필터링한다. 약한 label은 제외하지만, 현재 setting으로 판단되는 place는 반복되지 않아도 표시될 수 있다.
- `/v3?...` 직접 URL 진입과 Reading QA 화면은 production build에서 Alice V3 run으로 검증했다.
