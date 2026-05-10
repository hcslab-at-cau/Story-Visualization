# SUP 브랜치 구현 문서

이 문서는 이번 구현 브랜치에서 실제로 추가한 reader-support 파이프라인을 정리한다. 기존 계획 문서가 방향과 아이데이션 중심이었다면, 이 문서는 현재 코드에 반영된 stage, 입력, 출력, UI 연결을 기준으로 한다.

관련 코드:

- `src/types/schema.ts`
- `src/lib/pipeline/support.ts`
- `src/app/api/pipeline/sup0/route.ts` ~ `src/app/api/pipeline/sup7/route.ts`
- `src/app/api/pipeline/final1/route.ts`
- `src/lib/pipeline/final1.ts`
- `src/components/PipelineRunner.tsx`
- `src/components/ReaderScreen.tsx`
- `src/types/ui.ts`
- `src/config/pipeline-graph.ts`

---

## 1. 구현 목표

이번 구현의 목표는 raw summary를 하나 더 만드는 것이 아니라, 기존 파이프라인 산출물을 독자 지원용 artifact로 다시 조립하는 별도 브랜치를 만드는 것이다.

핵심 원칙은 다음과 같다.

- 각 substep은 독립 stage로 실행되고 저장된다.
- 각 stage 산출물은 웹 inspector에서 확인할 수 있다.
- `SUP.7`은 `FINAL.1`에 연결되어 최종 reader 화면에서도 노출된다.
- 첫 버전은 rule-based로 구현해 실행 가능성과 추적성을 우선 확보한다.
- 나중에 특정 stage를 LLM 기반으로 교체하더라도 API와 artifact 계약은 유지한다.

---

## 2. Stage 구성

현재 추가된 stage는 `SUP.0`부터 `SUP.7`까지다.

| Stage | 이름 | 역할 |
|---|---|---|
| `SUP.0` | Support Memory | scene, event, edge 기반 support memory 생성 |
| `SUP.1` | Shared Support Context | 장면별 현재 상태, 변화, prior thread, 후보 support 종류 생성 |
| `SUP.2` | Snapshot and Boundary | current-state snapshot과 boundary delta 지원물 생성 |
| `SUP.3` | Causal Bridges | 이전 사건과 현재 장면을 잇는 causal/thread bridge 생성 |
| `SUP.4` | Character and Relation | 현재 인물, 관계 변화 중심 지원물 생성 |
| `SUP.5` | Reentry and Reference | 재진입 recap, reference repair, spatial/visual cue 생성 |
| `SUP.6` | Support Policy | 생성된 support unit을 선별하고 deferred unit 분리 |
| `SUP.7` | Reader Support Package | reader 화면에서 쓸 display slot으로 패키징 |

이번 구현에서는 계획 문서의 일부 항목을 병합했다. 예를 들어 boundary delta는 `SUP.2`에, character/relation은 `SUP.4`에, re-entry/reference/spatial/visual cue는 `SUP.5`에 들어간다. 이유는 첫 구현에서 stage 수는 유지하되, 산출물의 성격이 가까운 것들을 하나의 실행 단위로 묶는 편이 UI와 디버깅에 더 명확하기 때문이다.

---

## 3. 입력과 출력

### `SUP.0`

입력:

- `SCENE.1`
- `STATE.3`
- `SCENE.3`
- 선택적으로 `SUB.3`

출력:

- `SupportMemoryLog`
- 내부에는 `scenes`, `events`, `edges`가 들어간다.

주요 생성 내용:

- scene ledger
- action/subscene event node
- place shift edge
- cast change edge
- same-character thread edge
- subscene causal result 기반 causal bridge edge

### `SUP.1`

입력:

- `SUP.0`

출력:

- `SharedSupportRepresentation`

주요 생성 내용:

- 현재 장면 상태
- 이전 장면 대비 변화
- 현재 장면으로 들어오는 prior thread
- 생성 후보 support 종류
- evidence reference

### `SUP.2` ~ `SUP.5`

입력:

- `SUP.1`
- 필요 시 `SUP.0`

출력:

- scene별 `SupportUnit[]`

`SupportUnit`은 실제 독자 지원 단위다. 공통 필드는 다음과 같다.

- `kind`
- `label`
- `title`
- `body`
- `priority`
- `display_mode`
- `evidence`
- `source_stage_ids`

### `SUP.6`

입력:

- `SUP.2`
- `SUP.3`
- `SUP.4`
- `SUP.5`

출력:

- `SupportPolicySelection`
- scene별 `selected_units`, `deferred_units`, `policy_notes`

### `SUP.7`

입력:

- `SUP.6`
- `SUP.1`

출력:

- `ReaderSupportPackageLog`
- scene별 `ReaderSupportPacket`

`ReaderSupportPacket`은 다음 display slot을 가진다.

- `before_text`
- `beside_visual`
- `on_demand`

---

## 4. FINAL.1 연결

`FINAL.1` route는 이제 선택적으로 `SUP.7`을 읽는다.

`SUP.7`이 있으면 `runSceneReaderPackage`가 각 `SceneReaderPacket`에 `support` 필드를 추가한다. `SUP.7`이 없어도 기존 FINAL.1은 그대로 동작한다.

이 방식의 장점은 다음과 같다.

- 기존 reader package 구조를 깨지 않는다.
- support branch를 실행하지 않아도 기존 파이프라인은 동작한다.
- support 결과가 있으면 reader 화면에 자연스럽게 합쳐진다.

---

## 5. Reader 화면 연결

`ReaderScreen`은 `SceneReaderPacket.support`를 읽어 다음 위치에 표시한다.

- `before_text`: 본문 위의 주요 복구 카드
- `beside_visual`: 이미지/캐릭터 패널 아래의 보조 카드
- `on_demand`: 접을 수 있는 추가 지원 섹션

첫 구현에서는 지원물을 별도 복잡한 인터랙션으로 만들지 않고 카드 형태로 표시한다. 이유는 독자가 본문 흐름을 읽는 중에 지나치게 많은 조작을 요구하지 않기 위해서다.

---

## 6. Inspector

`PipelineRunner`는 `SUP.0`부터 `SUP.7`까지 모두 전용 inspector를 제공한다.

표시 방식:

- `SUP.0`: scene memory, event, edge
- `SUP.1`: shared context, boundary delta, prior thread
- `SUP.2` ~ `SUP.5`: 생성된 support unit
- `SUP.6`: selected/deferred unit
- `SUP.7`: display slot별 reader support packet

따라서 각 substep의 산출물이 raw JSON으로만 보이지 않고, 웹에서 구조적으로 확인 가능하다.

---

## 7. 현재 한계

이번 구현은 문서 전역 DB를 별도 컬렉션으로 materialize하지 않고, run artifact 안에 `SUP.0` memory를 저장한다. 그래서 현재는 같은 chapter/run 내부에서의 support memory가 중심이다.

다음 단계에서 확장해야 할 부분:

- `documents/{docId}/memory/...` 형태의 doc-level memory 저장
- chapter 간 retrieval
- support unit의 중복 제거 강화
- evidence span UI 강조
- LLM 기반 compression/generation 옵션
- reader session 기반 re-entry trigger

---

## 8. 다음 구현 우선순위

1. `SUP.0`을 Firestore doc-level memory에도 저장하도록 확장
2. `SUP.3` causal bridge를 단순 이전 장면이 아니라 event graph retrieval 기반으로 개선
3. `SUP.6` policy에 VIS usefulness와 reader state를 반영
4. Reader 화면에서 support card를 독자 행동 로그와 연결
5. evaluation plan에 맞춰 support 노출 조건별 비교 실험 추가
