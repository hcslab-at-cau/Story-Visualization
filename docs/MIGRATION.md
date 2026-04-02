# Story-Decomposition → Story-Visualization Migration Plan

## 배경

Story-Decomposition은 소설 텍스트(EPUB)에서 장면 경계를 자동으로 탐지하는 연구용 파이프라인으로, Streamlit(Python)으로 구현되어 있다. Streamlit은 실험/프로토타이핑에는 편리하지만 실제 웹 서비스로 발전시키기에는 한계가 있어, Story-Visualization 레포지토리에서 Next.js 기반의 웹 애플리케이션으로 재구현한다.

---

## 아키텍처 결정

### 선택: Next.js 풀스택 (별도 백엔드 없음)

```
Next.js (Vercel)
├── app/                  ← UI (React, App Router)
├── app/api/pipeline/     ← 파이프라인 Stage API (Route Handlers)
└── lib/pipeline/         ← Stage 로직 (TypeScript)
    ↕
Firebase Firestore         ← 결과 저장 및 DB
```

**결정 근거:**
- Next.js의 Route Handlers는 서버에서 실행되는 코드로, 별도 백엔드 없이 LLM 호출, Firebase 읽기/쓰기 등 모든 서버 로직을 처리할 수 있다.
- NestJS 등 별도 백엔드를 두면 배포가 두 곳으로 나뉘고 관리 비용이 늘어난다.
- Firebase를 DB로 사용하면 Next.js + Firebase만으로 인프라가 완결된다.

**고려했으나 선택하지 않은 방식:**
- NestJS 백엔드: Vercel에 배포 불가 (long-running server), 별도 호스팅 필요 (Railway 등)
- Python 백엔드 유지 (FastAPI): 언어 혼용, 두 레포 동시 관리 부담

### 배포
- **개발/테스트**: 로컬 (`npm run dev`)
- **프로덕션**: Vercel (Next.js) + Firebase

---

## 기술 스택

| 역할 | Story-Decomposition | Story-Visualization |
|------|---------------------|---------------------|
| UI 프레임워크 | Streamlit (Python) | Next.js 16 (React 19) |
| 언어 | Python 3 | TypeScript |
| 백엔드 API | Streamlit 내장 | Next.js Route Handlers |
| 데이터베이스 | 로컬 JSON 파일 | Firebase Firestore |
| 스키마/유효성 검사 | Pydantic | Zod |
| LLM API | openai (Python) | openai (npm) |
| EPUB 파싱 | ebooklib | epub2 또는 epubjs |
| HTML 파싱 | beautifulsoup4 | cheerio |
| 한국어 문장 분리 | kss (Python) | @kss (npm) |
| JSON 복구 | json-repair | jsonrepair |
| 스타일링 | Streamlit 내장 | Tailwind CSS v4 |

---

## 마이그레이션 범위

### 포함 (구현 예정)

Story-Decomposition의 7단계 파이프라인 전체:

| Stage | 설명 | 방식 |
|-------|------|------|
| PRE.1 | EPUB → RawChapter JSON 변환 | 규칙 기반 |
| PRE.2 | Content Classification (콘텐츠 분류) | LLM |
| ENT.1 | Mention Extraction (멘션 추출) | LLM |
| ENT.2 | Mention Validation (멘션 검증) | LLM |
| ENT.3 | Entity Resolution (엔티티 클러스터링) | LLM |
| STATE.1 | State Tracking (상태 추적) | 규칙 기반 |
| STATE.2 | State Validation (상태 검증) | LLM |
| STATE.3 | Boundary Detection (경계 탐지) | 규칙 기반 |
| SCENE.1 | Scene Packet Building | 규칙 기반 |
| SCENE.2 | Scene Indexing | LLM |
| SCENE.3 | Scene Validation | LLM |
| SUB.1~4 | Subscene Analysis | LLM |
| FINAL.1 | Reader Package — SceneReaderPacket 생성 (subscene nav, visual block, character panels) | 규칙 기반 |
| FINAL.2 | Overlay Refinement — Vision API로 캐릭터 버튼 anchor 위치 정제 | Vision LLM |
| FINAL.3 | Reader Screen — FINAL.1 + FINAL.2 결과를 합쳐 최종 독자 화면 렌더링 | **UI 전용 (Stage 없음)** |

EPUB 업로드 및 챕터 파싱, Lineage 기반 실행 이력 관리도 포함.

### FINAL.2 — Overlay Refinement 상세

**역할**: FINAL.1에서 coarse 방식으로 지정된 캐릭터 버튼 위치(anchor_x, anchor_y)를, Vision API를 사용해 실제 이미지 기반으로 정제한다.

**입력**: FINAL.1 (`SceneReaderPackageLog`) + VIS.2 blueprint + VIS.4 이미지  
**출력**: `OverlayRefinementResult` — 씬별 캐릭터 위치 (anchor_x, anchor_y, bbox_norm, visibility, confidence)

**동작 방식**:
1. 각 씬의 이미지를 base64로 인코딩해 Vision 모델에 전달
2. 모델이 캐릭터별 anchor 위치(0~100%), bounding box, visibility, confidence 반환
3. confidence가 threshold(0.45) 이상이고 source가 coarse_fallback이 아닌 경우에만 정제된 위치 채택
4. 그 외에는 FINAL.1의 coarse anchor를 fallback으로 유지
5. Vision API 없이도 실행 가능 (전체 fallback_only 모드)

**TS 구현 위치**: `src/lib/pipeline/final2.ts`  
**API Route**: `app/api/pipeline/final2/route.ts`

### FINAL.3 — Reader Screen 상세

**역할**: FINAL.1 + FINAL.2 결과를 merge하여 debug 정보 없이 깔끔한 최종 독자 화면을 렌더링한다. 별도 파이프라인 실행 없이 UI 컴포넌트만 존재한다.

**필요 데이터**: FINAL.1 (`SceneReaderPackageLog`), FINAL.2 (`OverlayRefinementResult`, optional)  
**UI 구성**:
- 씬 선택 드롭다운
- 씬 제목 + 요약
- 좌측: 서브씬 본문 (`body_paragraphs`) + ← → 네비게이션
- 우측: 씬 이미지 + 캐릭터 overlay 버튼 (popover) + 서브씬 detail (headline + expander 패널)

**캐릭터 필터링 규칙** (FINAL.2 결과 기반):
- `visibility == "not_visible"` AND `confidence >= 0.5` → 버튼 제거
- 그 외 → anchor 위치에 버튼 표시 (정제 anchor 우선, fallback은 coarse 사용)

**TS 구현 위치**: `src/components/tabs/TabFinal3.tsx` (파이프라인 로직 없음)

### 제외 (이번 마이그레이션 범위 밖)

- **spaCy NLP 경로**: mention extraction의 NLP 기반 경로 제거. LLM 경로만 유지.
- **ComfyUI 이미지 생성 (VIS 브랜치)**: 별도 레포지토리 소관. Stage VIS.1~4 미포함.

---

## 데이터 저장 구조 (Firebase Storage + Firestore)

기존 로컬 JSON 파일 + lineage 파일명 방식을 Firebase Storage + Firestore 구조로 전환.

```
/documents/{docId}/
    sourceFile: {
        storagePath: "documents/{docId}/source/{fileName}",
        gsUri: "gs://story-visualization-cb0e2.firebasestorage.app/...",
        fileName: "...",
        contentType: "application/epub+zip",
        sizeBytes: 123456
    }
    /chapters/{chapterId}/
        raw: { paragraphs: [...] }
        /runs/{runId}/
            pre1: { ... }
            ent1: { ... }
            ent2: { ... }
            state1: { ... }
            ...
```

Lineage는 `runId` 필드로 추적 (각 Stage 실행마다 새 run 문서 생성).

---

## 주의사항

- Vercel 배포 시 LLM 호출이 오래 걸리는 Stage는 `maxDuration` 설정 필요 (Vercel Pro 기준 최대 5분)
- 스트리밍 응답(`ReadableStream`)으로 긴 작업의 진행 상황을 UI에 실시간 표시하는 방식 고려
