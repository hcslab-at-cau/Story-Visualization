# UI 문서

이 문서는 현재 `Story-Visualization` 코드에서 제공하는 UI 흐름과 구현 상태를 정리한다.

관련 파일:

- `src/app/page.tsx`
- `src/components/EpubUploader.tsx`
- `src/components/ExistingDocumentsPicker.tsx`
- `src/components/PipelineRunner.tsx`
- `src/components/ReaderScreen.tsx`
- `src/types/ui.ts`

## 상위 화면 구조

메인 화면은 세 개의 view를 전환한다.

1. `upload`
2. `pipeline`
3. `reader`

상단 네비게이션은 `src/app/page.tsx`에서 관리한다. EPUB 업로드 또는 기존 문서 선택 후 `docId`, chapter 목록, 선택 chapter가 설정되면 pipeline view로 이동한다.

## 1. Upload View

구성 컴포넌트:

- `EpubUploader`: EPUB 파일 업로드
- `ExistingDocumentsPicker`: 저장된 문서 목록 조회 및 선택

동작:

- 새 파일 업로드는 `POST /api/epub`을 호출한다.
- 기존 문서 선택은 `GET /api/documents`, `GET /api/chapters?docId=...`를 사용한다.
- 문서와 chapter가 정해지면 첫 chapter를 선택하고 새 timestamp run ID를 만든 뒤 pipeline view로 이동한다.

## 2. Pipeline View

구성 컴포넌트:

- `PipelineRunner`

상단 컨트롤:

- chapter 선택: Prev/Next 버튼과 select
- Run ID 입력 및 새 run 생성
- 저장된 run 목록 선택
- run favorite 토글
- run 삭제

`PipelineRunner` 기능:

- 전체 stage 실행
- 개별 stage 실행
- 저장된 run 결과 새로고침
- stage별 model 입력 및 저장
- stage 결과 summary chip 표시
- stage별 inspector 표시
- LLM prompt/response debug panel 표시
- raw JSON fallback 표시
- 최신 저장 stage 결과 삭제

stage 상태:

- `idle`
- `running`
- `done`
- `error`

현재 등록된 stage 그룹:

- PRE: `PRE.1`, `PRE.2`
- ENT: `ENT.1`, `ENT.2`, `ENT.3`
- STATE: `STATE.1`, `STATE.2`, `STATE.3`
- SCENE: `SCENE.1`, `SCENE.2`, `SCENE.3`
- VIS: `VIS.1`, `VIS.2`, `VIS.3`, `VIS.4`
- SUB: `SUB.1`, `SUB.2`, `SUB.3`, `SUB.4`
- SUP: `SUP.0`, `SUP.1`, `SUP.2`, `SUP.3`, `SUP.4`, `SUP.5`, `SUP.6`, `SUP.7`
- FINAL: `FINAL.1`, `FINAL.2`

이번 구현 브랜치에서는 `SUP` branch도 추가되었다. `PipelineRunner` 상단에는 그래프형 stage navigator가 있고, 각 `SUP` stage는 전용 inspector에서 memory, context, support unit, policy, reader package를 확인할 수 있다.

VIS branch는 더 이상 pending placeholder가 아니다. `VIS.1`부터 `VIS.4`까지 API route와 pipeline implementation이 연결되어 있고, `PipelineRunner`에는 각 VIS artifact를 확인하는 전용 view가 있다.

## 3. Reader View

구성 컴포넌트:

- `ReaderView` (`src/app/page.tsx` 내부)
- `ReaderScreen`

입력 데이터:

- 필수: `FINAL.1` 결과 (`SceneReaderPackageLog`)
- 선택: `FINAL.2` 결과 (`OverlayRefinementResult`)

동작:

- reader view 진입 시 현재 chapter의 저장 run 목록을 읽는다.
- `favorite=true`인 run을 우선 선택한다.
- favorite run이 없으면 저장 run 목록의 첫 번째 run을 선택한다.
- run이 없으면 "No saved runs for this chapter." 상태를 표시한다.
- `FINAL.1`이 없으면 reader를 렌더링하지 않고 결과 없음 상태를 표시한다.

ReaderScreen 기능:

- chapter control을 상단에 표시
- scene selector
- scene summary 토글
- subscene navigation
- 본문 paragraph 표시
- 이전/다음 scene 또는 subscene 이동
- generated image 또는 placeholder 표시
- character overlay button 표시
- `FINAL.2` confidence 기반 overlay refinement 병합
- global / character / pair focus context panel
- Goal, Problem, Change, Impact, Object, Action, Event panel button
- 다음/이전 scene 이미지 preload

## Run 관리 규칙

- pipeline view에서 chapter를 바꾸면 새 timestamp run ID를 만든다.
- reader view에서 chapter를 바꾸면 run 목록을 다시 로드하고 preferred run을 다시 선택한다.
- 저장된 run만 favorite으로 지정할 수 있다.
- run 삭제 후에는 남은 run 목록의 첫 번째 run으로 이동한다. 남은 run이 없으면 새 timestamp run ID를 만든다.
- stage 결과 삭제는 현재 run에서 가장 마지막으로 저장된 stage에 대해서만 허용된다.

## API 연결 요약

문서/업로드:

- `POST /api/epub`
- `GET /api/documents`
- `GET /api/chapters?docId=...`

파이프라인 API:

- `POST /api/pipeline/pre1`
- `POST /api/pipeline/pre2`
- `POST /api/pipeline/ent1`
- `POST /api/pipeline/ent2`
- `POST /api/pipeline/ent3`
- `POST /api/pipeline/state1`
- `POST /api/pipeline/state2`
- `POST /api/pipeline/state3`
- `POST /api/pipeline/scene1`
- `POST /api/pipeline/scene2`
- `POST /api/pipeline/scene3`
- `POST /api/pipeline/vis1`
- `POST /api/pipeline/vis2`
- `POST /api/pipeline/vis3`
- `POST /api/pipeline/vis4`
- `POST /api/pipeline/sub1`
- `POST /api/pipeline/sub2`
- `POST /api/pipeline/sub3`
- `POST /api/pipeline/sub4`
- `POST /api/pipeline/sup0`
- `POST /api/pipeline/sup1`
- `POST /api/pipeline/sup2`
- `POST /api/pipeline/sup3`
- `POST /api/pipeline/sup4`
- `POST /api/pipeline/sup5`
- `POST /api/pipeline/sup6`
- `POST /api/pipeline/sup7`
- `POST /api/pipeline/final1`
- `POST /api/pipeline/final2`

## 구현 관련 결론

현재 UI는 mock preview가 아니라 저장된 pipeline artifact를 기준으로 작동한다.

- PipelineRunner에서 PRE/ENT/STATE/SCENE/VIS/SUB/FINAL stage를 실행하고 결과를 검증할 수 있다.
- VIS.1~VIS.4는 구현 및 UI inspection이 연결되어 있다.
- ReaderScreen은 FINAL.1과 선택적 FINAL.2를 기반으로 최종 reader experience를 표시한다.
- 향후 support branch가 추가되면 별도의 support artifact inspector와 provenance trace view가 필요하다.
