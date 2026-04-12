# UI 문서 (현재 구현 기준)

이 문서는 현재 `Story-Visualization` UI가 실제 코드에서 어떻게 동작하는지 정리합니다.

## 상위 화면 구성

메인 화면은 아래 3개 뷰를 탭으로 전환합니다.

1. `upload`
2. `pipeline`
3. `reader`

구현 위치: `src/app/page.tsx`

---

## 1) Upload 뷰

구성 컴포넌트:

- `EpubUploader`: EPUB 파일 드래그앤드롭/선택 업로드
- `ExistingDocumentsPicker`: 기존 문서 목록 조회 후 재진입

동작 요약:

- 새 파일 업로드 시 `/api/epub` 호출
- 기존 문서 선택 시 `/api/documents`, `/api/chapters` 호출
- 문서/챕터가 정해지면 pipeline 뷰로 이동

---

## 2) Pipeline 뷰

구성 컴포넌트:

- `PipelineRunner`

핵심 기능:

- 챕터 선택(Prev/Next + select)
- Run ID 생성/수정
- 저장된 run 목록 로드
- run 즐겨찾기 토글 / 삭제
- stage별 모델 선택
- stage 단건 실행 + 하위 stage 정리
- stage 결과 요약 chip + raw JSON inspector

### stage 상태

- `idle`
- `running`
- `done`
- `error`

### VIS 브랜치 상태

이제 VIS.1~VIS.4는 실제 구현/실행됩니다.

- VIS.1: semantic clarification
- VIS.2: stage blueprint
- VIS.3: render package
- VIS.4: image generation + storage 업로드

---

## 3) Reader 뷰

구성 컴포넌트:

- `ReaderScreen`

입력 데이터:

- 필수: `FINAL.1` 결과(`SceneReaderPackageLog`)
- 선택: `FINAL.2` 결과(`OverlayRefinementResult`)

화면 기능:

- scene/subscene 네비게이션
- 본문 문단 표시
- 시각 블록(image/placeholder)
- 캐릭터 오버레이 버튼
- focus context(global/character/pair) 패널
- FINAL.2 confidence 기반 overlay 병합

---

## 저장(run) UX 규칙

- reader 진입 시 챕터의 저장 run 중 `favorite=true`가 우선 선택됩니다.
- favorite이 없으면 최신 정렬 결과의 첫 run을 선택합니다.
- run 삭제 후에는 남은 run 첫 항목 또는 새 timestamp run ID로 이동합니다.

---

## API 연결 요약

- 업로드/문서
  - `POST /api/epub`
  - `GET /api/documents`
  - `GET /api/chapters?docId=...`
- 파이프라인
  - `POST /api/pipeline/pre1` ~ `POST /api/pipeline/final2`

---

## 구현 관점 결론

현재 UI는 더 이상 “일부 stage만 동작하는 mock 형태”가 아닙니다.

- PRE/ENT/STATE/SCENE/VIS/SUB/FINAL 전체 파이프라인 실행 가능
- 중간 산출물은 PipelineRunner에서 요약 + JSON으로 점검
- 최종 산출물은 ReaderScreen에서 사용자 관점으로 검증
