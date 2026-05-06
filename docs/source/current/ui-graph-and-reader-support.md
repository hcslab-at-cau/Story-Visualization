# 그래프형 파이프라인 UI와 Reader Support UI

이 문서는 이번 구현 브랜치에서 바뀐 UI 구조를 정리한다.

관련 코드:

- `src/components/PipelineRunner.tsx`
- `src/components/ReaderScreen.tsx`
- `src/types/ui.ts`
- `src/config/pipeline-graph.ts`

---

## 1. 변경 배경

기존 `PipelineRunner`는 stage가 선형 목록으로 나열되어 있었다. 하지만 실제 파이프라인은 이미 선형이 아니다.

- `VIS`는 visual branch다.
- `SUB`는 subscene/intervention branch다.
- `SUP`는 reader-support branch다.
- `FINAL.1`은 여러 branch를 조립한다.

따라서 stage를 단순 리스트로만 보여주면, 어느 stage가 어떤 branch에 속하고 어디로 이어지는지 파악하기 어렵다.

---

## 2. 그래프형 Stage 선택 UI

새 UI는 `StageGraphNavigator`를 `PipelineRunner` 상단에 추가한다.

구성:

- Prep
- Entities
- State
- Scene
- Visual
- Subscene
- Support
- Final

각 열에는 해당 stage 노드가 들어간다. 노드는 다음 정보를 보여준다.

- stage id
- stage label
- 실행 상태
- 저장 여부
- upstream stage 목록
- 개별 실행 버튼

이 그래프 UI는 stage 실행 순서를 강제하는 엔진이 아니라, 사용자가 구조를 보며 선택하고 실행할 수 있는 navigation layer다. 실제 invalidation과 run fork는 기존 `pipeline-graph.ts`와 `PipelineRunner` 실행 로직을 그대로 사용한다.

---

## 3. 기존 리스트 유지 이유

그래프 UI를 추가했지만 기존 세로 stage list를 제거하지는 않았다.

이유:

- 개별 stage별 model 입력이 기존 리스트 안에 있다.
- delete stage result 기능이 기존 리스트에 안정적으로 붙어 있다.
- stage summary chip을 빠르게 훑기에는 리스트가 여전히 효율적이다.

따라서 현재 UI는 다음 두 층으로 구성된다.

- 상단: 그래프형 흐름 선택
- 좌측: 세부 stage 컨트롤
- 우측: stage inspector

---

## 4. Reader Support 표시 방식

`ReaderScreen`은 이제 `FINAL.1` 안에 포함된 `support` 필드를 읽는다.

지원물은 세 위치에 배치된다.

| Slot | 위치 | 목적 |
|---|---|---|
| `before_text` | 본문 위 | 읽기 전에 필요한 상태/변화/인과 복구 |
| `beside_visual` | 이미지 및 focus panel 아래 | 인물, 장소, 시각 cue 보조 |
| `on_demand` | 접이식 섹션 | 항상 보이면 부담되는 추가 정보 |

이 배치는 독자에게 모든 정보를 한 번에 밀어 넣지 않고, 본문 흐름을 방해하지 않는 범위에서 복구 정보를 제공하기 위한 것이다.

---

## 5. UX 방향

현재 목표 사용자는 두 종류다.

- 연구자/개발자: stage 결과와 오류를 빠르게 확인해야 한다.
- 독자/실험 참여자: 본문을 읽는 중 필요한 지원만 받아야 한다.

그래서 UI는 두 화면에서 다른 기준을 따른다.

Pipeline view:

- 구조 이해
- stage 실행
- artifact 검사
- 디버깅

Reader view:

- 본문 우선
- 필요한 지원만 노출
- 지원물은 카드와 접이식 섹션으로 분산

---

## 6. 아직 남은 UI 작업

다음 개선이 필요하다.

- 그래프 edge를 실제 선으로 시각화
- branch별 실행 버튼 추가
- stage 실패 시 downstream 영향 표시
- support evidence를 본문 paragraph에 하이라이트
- Reader 화면에서 support card 노출 로그 기록
- 모바일 reader 화면에서 support card 순서 재조정

이번 구현은 전체 UI 재설계의 첫 단계이며, stage 구조와 support 노출의 기본 골격을 우선 만든 상태다.
