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

`ReaderScreen`은 `FINAL.1` 안에 포함된 `support` 필드를 읽는다. 이 `support`는 `SUP.7`의 `ReaderSupportPackageLog`이며, 현재 구현에서는 chapter-local support와 `BOOK.0 -> NRG.0` claim에서 파생된 support가 함께 들어갈 수 있다.

기존처럼 `before_text`, `beside_visual`, `on_demand` slot을 화면에 크게 펼쳐 놓는 방식은 기본 UX에서 내려갔다. 현재 Reader는 본문을 먼저 보여주고, support는 본문 anchor를 누를 때 열리는 방식이다.

### Anchored support

현재 정책:

- support가 어울리는 범위를 paragraph, sentence, phrase, word 중에서 고른다.
- 같은 범위에 여러 support가 겹치면 작은 selector modal/popover에서 support 종류를 고른다.
- modal은 본문을 밀어내지 않고 위에 겹쳐서 뜬다.
- 빈 곳을 누르거나 닫기 버튼을 누르면 modal이 닫힌다.
- modal이 화면 밖으로 길어질 수 있으므로 전체 화면 스크롤이 가능해야 한다.

### Reader mode와 Researcher mode

Reader mode:

- anchor는 조용하게 보인다.
- support kind나 score 같은 내부 정보는 기본적으로 숨긴다.
- card copy는 선택한 본문과 직접 연결되는 짧은 설명을 우선한다.

Researcher mode:

- 같은 본문 화면을 사용하되 anchor를 더 분명하게 보여준다.
- support kind badge를 보여준다.
- provenance, source stage, raw body, evidence 같은 debug 정보를 확인할 수 있게 한다.

### Cross-chapter memory

`BOOK.0` raw edge를 Reader에 그대로 노출하는 것이 기본 목표는 아니다. 현재 독자에게 보이는 cross-chapter support는 `BOOK.0`에서 파생한 `NRG.0` claim이 `SUP.7`에서 `SupportUnit`으로 변환된 결과다.

Graph tab의 `BOOK.0` panel은 연구자/개발자가 cross-chapter memory snapshot을 확인하는 inspector 역할을 한다. Reader에서는 같은 정보를 직접 패널로 밀어 넣기보다, 필요한 순간에 anchored support로 작은 단위만 보여주는 방향을 기준으로 한다.

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
- 필요한 지원만 anchor interaction으로 노출
- 독자 모드와 연구자 모드의 표시 강도 분리

---

## 6. 아직 남은 UI 작업

다음 개선이 필요하다.

- 그래프 edge를 실제 선으로 시각화
- branch별 실행 버튼 추가
- stage 실패 시 downstream 영향 표시
- support evidence를 본문 paragraph highlight와 더 안정적으로 연결
- Reader 화면에서 support card 노출/열람 로그를 분석 화면으로 연결
- 모바일 reader 화면에서 support card 순서 재조정
- `SupportUnit.reader_copy` fallback 품질 개선

이번 구현은 전체 UI 재설계의 첫 단계이며, stage 구조와 support 노출의 기본 골격을 우선 만든 상태다.
