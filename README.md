# Story Visualization

EPUB 문서를 업로드한 뒤, 챕터 단위 파이프라인(PRE → ENT → STATE → SCENE → VIS → SUB → FINAL)을 실행하고 결과를 Reader UI로 확인하는 Next.js 16 기반 도구입니다.

## 주요 기능

- EPUB 업로드 및 챕터 파싱 (`/api/epub`)
- 기존 문서/챕터 재선택 후 파이프라인 재실행
- Run ID 기반 결과 저장/불러오기, 즐겨찾기, 삭제
- 21개 stage 실행/디버깅(모델별 개별 설정 포함)
- FINAL.1 + FINAL.2 결과를 Reader 화면에서 검토

## 기술 스택

- Next.js 16 (App Router), React 19, TypeScript
- Firebase Firestore (문서/챕터/run/artifact 저장)
- Firebase Storage (원본 EPUB/생성 이미지 저장)
- OpenRouter + OpenAI SDK (`openai` 패키지)

## 프로젝트 구조

- `src/app/page.tsx`: Upload / Pipeline / Reader 3개 메인 뷰
- `src/components/PipelineRunner.tsx`: stage 실행, 요약, 결과 inspector
- `src/components/ReaderScreen.tsx`: FINAL 결과 리더 렌더러
- `src/app/api/pipeline/*/route.ts`: stage별 API 엔드포인트
- `src/lib/pipeline/*.ts`: stage 실행 로직
- `src/lib/firestore.ts`: Firestore 접근 계층
- `src/lib/storage.ts`: Firebase Storage 업로드 계층
- `prompts/*.txt`: LLM 템플릿 프롬프트

## 환경 변수

`.env.local`에 아래 값을 설정하세요.

```bash
# Firebase (client SDK)
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=

# OpenRouter
OPENROUTER_API_KEY=

# POST /api/epub 전용 서버 측 관리자 자격 증명
# 32 random bytes 이상을 사용하고 NEXT_PUBLIC_* 변수로 노출하지 마세요.
EPUB_INGEST_ADMIN_TOKEN=
```

> `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`가 비어 있으면 코드 기본 버킷 값으로 동작할 수 있지만, 명시 설정을 권장합니다.

## 실행 방법

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:3000`을 열어 확인합니다.

### 보호된 EPUB 업로드

프로덕션의 `POST /api/epub`은 `EPUB_INGEST_ADMIN_TOKEN`이 없거나 32 UTF-8 byte보다 짧으면 `503 ingest_not_configured`로 닫힌 상태를 유지합니다. 토큰이 설정된 경우 `Authorization: Bearer <token>`이 필요합니다. 현재 브라우저 업로더는 서버 비밀값을 번들에 포함하지 않으므로, 프로덕션에서는 인증된 연구자 UI나 신뢰할 수 있는 서버 프록시가 이 헤더를 추가해야 합니다.

PowerShell에서는 비밀값을 명령 기록에 직접 쓰지 않고 환경 변수에서 읽어 호출할 수 있습니다.

```powershell
$headers = @{ Authorization = "Bearer $env:EPUB_INGEST_ADMIN_TOKEN" }
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/epub -Headers $headers -Form @{ file = Get-Item .\book.epub }
```

`npm run dev`에서 토큰을 설정하지 않은 경우에만 기존 로컬 업로드 흐름을 위해 인증을 생략합니다. 이는 개발 편의 동작이며 배포 가능한 보안 설정이 아닙니다. 프로덕션 노출 전에는 HTTPS, 호스트 수준의 원시 요청 크기·요청률 제한, 느린 클라이언트 타임아웃도 함께 구성해야 합니다.

## 파이프라인 스테이지

현재 구현된 stage:

- PRE: `PRE.1`, `PRE.2`
- ENT: `ENT.1`, `ENT.2`, `ENT.3`
- STATE: `STATE.1`, `STATE.2`, `STATE.3`
- SCENE: `SCENE.1`, `SCENE.2`, `SCENE.3`
- VIS: `VIS.1`, `VIS.2`, `VIS.3`, `VIS.4`
- SUB: `SUB.1`, `SUB.2`, `SUB.3`, `SUB.4`
- FINAL: `FINAL.1`, `FINAL.2`

## 데이터 저장 구조(요약)

- `/documents/{docId}`
  - 문서 메타데이터 + source file
  - `/chapters/{chapterId}`
    - `raw` (파싱된 원본 챕터)
    - `/runs/{runId}`
      - `updatedAt`, `favorite`, `stageModels`
      - `/artifacts/{stageKey}` (stage별 산출물)

## 참고 문서

- `docs/source/README.md`: 문서 인덱스와 읽는 순서
- `docs/source/current/ui.md`: 현재 UI 동작 방식
- `docs/source/pipeline/*.md`: stage별 파이프라인 설명
- `docs/source/review/current-implementation-vs-docs.md`: 현재 구현과 제안 문서 비교
- `docs/MIGRATION.md`: 이전 이식/마이그레이션 메모
