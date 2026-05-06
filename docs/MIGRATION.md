# Story-Decomposition -> Story-Visualization 마이그레이션 계획

## 배경

기존 `Story-Decomposition`은 소설 텍스트와 EPUB에서 장면 경계를 자동으로 추출하고 구조화하는 연구용 파이프라인이었다. 초기 구현은 Python과 Streamlit 중심이었고, 단일 사용자 실험과 stage 검증에는 적합했지만, 장기적으로는 다음 한계가 있었다.

- stage별 결과를 웹 서비스처럼 다루기 어렵다.
- 원문, 실행 이력, 중간 산출물, 최종 화면을 한 시스템 안에서 연결하기 어렵다.
- 독자 지원용 UI와 파이프라인 결과를 느슨하게 결합하기 어렵다.

이 문서는 그 구조를 `Story-Visualization` 저장소의 Next.js 기반 애플리케이션으로 옮기는 방향을 정리한 메모다.

---

## 아키텍처 결정

### 선택한 구조

현재 방향은 `Next.js + Route Handlers + Firebase` 조합이다.

```text
Next.js
├─ app/                  UI와 페이지
├─ app/api/pipeline/     stage 실행 API
├─ src/lib/pipeline/     stage 로직
└─ Firebase              문서, 실행 이력, 산출물 저장
```

### 이 구조를 택한 이유

- UI와 서버 로직을 한 저장소에서 함께 관리할 수 있다.
- stage 실행 API를 Next.js route handler로 바로 노출할 수 있다.
- Firestore와 결합해 run 단위 artifact 저장 구조를 만들기 쉽다.
- 별도 백엔드 서비스를 하나 더 운영하지 않아도 된다.

### 선택하지 않은 구조

`NestJS`나 별도 Python API 서버를 두는 구조도 가능하지만, 현재 연구 단계에서는 운영 복잡도만 늘릴 가능성이 크다. 지금 필요한 것은 마이크로서비스 분리가 아니라, stage 실행과 결과 검토를 빠르게 반복할 수 있는 일체형 구조다.

---

## 기술 스택 변화

| 영역 | 이전 | 현재 |
|------|------|------|
| UI | Streamlit | Next.js 16 / React 19 |
| 구현 언어 | Python | TypeScript |
| 서버 API | Streamlit 내부 처리 | Next.js Route Handlers |
| 데이터 저장 | 로컬 JSON | Firebase Firestore |
| 스키마 검증 | Pydantic | Zod |
| LLM 호출 | `openai` Python SDK | `openai` npm SDK |
| EPUB 파싱 | `ebooklib` | `epub2` 계열 |
| HTML 파싱 | BeautifulSoup | Cheerio |
| JSON 복구 | `json-repair` | `jsonrepair` |

핵심은 “기능 자체를 버린 것”이 아니라, 기존 파이프라인의 의미를 웹 애플리케이션 구조로 다시 배치한 것이다.

---

## 마이그레이션 범위

### 포함된 단계

이관 대상은 장면 분해와 reader package 생성에 필요한 단계 전반이다.

| Stage | 역할 |
|------|------|
| `PRE.1` | EPUB -> RawChapter 정규화 |
| `PRE.2` | 콘텐츠 분류 |
| `ENT.1` | mention 추출 |
| `ENT.2` | mention 검증 |
| `ENT.3` | entity 해소 및 정규화 |
| `STATE.1` | 상태 프레임 생성 |
| `STATE.2` | 상태 검증 |
| `STATE.3` | 장면 경계 계산 및 제목 생성 |
| `SCENE.1` | scene packet 구성 |
| `SCENE.2` | scene index 추출 |
| `SCENE.3` | scene grounding / validation |
| `SUB.1~4` | subscene 분해와 개입 패키지 구성 |
| `FINAL.1` | reader package 조립 |
| `FINAL.2` | visual overlay refinement |

`FINAL.3`은 별도 stage라기보다 `FINAL.1`과 `FINAL.2` 결과를 읽어 실제 화면으로 렌더링하는 UI 계층으로 보는 편이 맞다.

### 제외되거나 축소된 부분

- 과거 Python 쪽 보조 경로 중 일부는 현재 TS 구조에 그대로 옮기지 않았다.
- 별도 이미지 생성 백엔드나 외부 파이프라인은 현재 저장소의 핵심 범위가 아니다.
- 일부 실험용 경로는 문서화는 하되, 주 경로로 간주하지 않는다.

---

## 데이터 저장 구조 변화

이전에는 로컬 JSON 파일 중심이었다면, 현재는 Firestore 기준으로 다음 구조를 사용한다.

```text
documents/{docId}
└─ chapters/{chapterId}
   ├─ raw
   └─ runs/{runId}
      ├─ pre1
      ├─ ent1
      ├─ ent2
      ├─ state1
      ├─ ...
      └─ final2
```

이 구조의 장점은 다음과 같다.

- 같은 chapter를 여러 번 실행한 결과를 비교할 수 있다.
- stage별 artifact를 inspector에서 바로 확인할 수 있다.
- lineage를 `runId` 기준으로 추적할 수 있다.

반면 한계도 분명하다.

- chapter/run 중심 구조라 문서 전역 기억을 저장하기에는 약하다.
- 이후 고도화된 reader support를 위해서는 별도 doc-level memory 계층이 필요하다.

이 부분은 `docs/source/support/memory-schema.md`에서 별도로 다룬다.

---

## FINAL.2와 Reader Screen의 의미

### FINAL.2

`FINAL.2`는 `FINAL.1`에서 만든 coarse overlay를 실제 이미지 기준으로 조금 더 정교하게 맞추는 refinement 단계다. 즉 새로운 독자 지원을 생성하는 단계라기보다, 이미 만든 visual block을 더 잘 표시하기 위한 후처리다.

### Reader Screen

Reader Screen은 stage가 아니라 결과 표현 계층이다. 현재 구현에서는 다음을 한 화면에서 조합한다.

- scene 제목과 요약
- 본문 paragraph
- subscene 탐색 UI
- 이미지 및 캐릭터 overlay
- 세부 팝오버

즉 파이프라인의 끝은 `FINAL.1/FINAL.2`이고, 독자가 실제로 보게 되는 최종 경험은 UI에서 조립된다.

---

## 현재 기준에서의 재해석

이 마이그레이션은 단순한 언어 전환이 아니다. 더 정확히는 다음과 같이 재해석하는 편이 맞다.

1. `Story-Decomposition`의 분석 파이프라인을 유지한다.
2. 이를 `Story-Visualization`의 run/artifact 구조에 맞게 재배치한다.
3. 결과를 inspector와 reader screen에서 검토 가능한 상태로 연결한다.
4. 이후 reader support 고도화를 위한 기반으로 사용한다.

즉 현재 저장소는 “옮겨온 버전”에서 끝나는 것이 아니라, 다음 연구 단계의 기반 시스템 역할을 한다.

---

## 다음 단계에서 필요한 추가 작업

마이그레이션 이후의 핵심 과제는 아래와 같다.

- stage 결과와 문서 전역 기억을 연결하는 memory 계층 추가
- `SUM/IDX/CAU/VIS`를 넘는 support 생성 브랜치 추가
- prompt versioning, regression set, observability 같은 운영 장치 강화
- VIS를 단일 해답이 아니라 선택적 보조 수단으로 재배치

즉 이제 중요한 것은 “이전 시스템을 다 옮겼는가”보다, “옮겨온 구조 위에 어떤 독자 지원 시스템을 쌓을 것인가”다.
