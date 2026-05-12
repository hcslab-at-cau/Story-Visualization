# UI language mode 구현

## 2026-05-08 update

웹 UI에 영어/한국어 전환 모드를 추가했다.

구현 범위:

- 오른쪽 상단 헤더에 `KO` / `EN` 언어 전환 버튼을 추가했다.
- 선택한 언어는 `localStorage`의 `story-visualization:ui-locale`에 저장된다.
- 선택 언어에 따라 `document.documentElement.lang`도 `ko` 또는 `en`으로 갱신된다.
- 앱 자체의 안내 문구, 버튼, 라벨, 빈 상태 메시지는 `src/lib/ui-strings.ts`에서 관리한다.
- 책 본문, 챕터 제목, LLM이 생성한 support 본문, stage artifact 내부 데이터는 번역하지 않는다. 이 데이터는 원문/산출물의 의미 보존이 우선이다.

주요 파일:

- `src/lib/ui-strings.ts`: 영어/한국어 string catalog와 stage 이름 매핑.
- `src/components/LanguageProvider.tsx`: 전역 언어 context, 저장/복원, 언어 전환 버튼.
- `src/app/page.tsx`: 헤더 언어 전환 버튼, navigation, pipeline/graph/reader/legacy wrapper 문구.
- `src/components/EpubUploader.tsx`: 업로드 안내 문구.
- `src/components/ExistingDocumentsPicker.tsx`: 기존 문서 목록 안내 문구.
- `src/components/BookMemoryPanel.tsx`: BOOK.0 / cross-chapter memory 관리 문구.
- `src/components/KnowledgeGraphExplorer.tsx`: graph query 문구.
- `src/components/ReaderScreen.tsx`: reader-facing support UI 문구.
- `src/components/PipelineRunner.tsx`: pipeline 실행/삭제/graph navigator의 주요 운영 문구.

설계 원칙:

- UI copy는 code에 직접 박지 않고 `ui-strings.ts`에 추가한다.
- 새 UI 문구를 추가할 때는 `ko`와 `en`을 동시에 추가한다.
- 책 내용이나 LLM 산출물은 i18n 대상이 아니다.
- stage 이름은 `StageId` 기준으로 catalog에서 관리한다. 저장된 artifact key나 API path는 바꾸지 않는다.

현재 한계:

- `PipelineRunner`의 stage별 artifact inspector에는 산출물 필드명을 그대로 드러내는 기술 라벨이 많다. 이번 변경은 운영 흐름에서 자주 보이는 안내 문구를 우선 catalog화했고, artifact schema field label까지 완전 번역하는 작업은 별도 pass로 분리하는 것이 안전하다.
