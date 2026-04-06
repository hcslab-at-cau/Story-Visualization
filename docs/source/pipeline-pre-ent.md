# Pipeline: PRE, ENT

`Story-Visualization` 현재 기준에서 실제로 가장 안정적으로 사용되는 구간은 PRE 쪽이다.  
이 문서는 PRE를 "현재 운영 기준"으로, ENT는 "포트된 후속 단계"로 나눠서 정리한다.

---

## 현재 상태

| Stage | 현재 위치 | 상태 | 비고 |
|---|---|---|---|
| PRE.1 | `src/lib/pipeline/pre1.ts` | 사용 중 | raw chapter materialization |
| PRE.2 | `src/lib/pipeline/pre2.ts` | 사용 중 | content classification |
| ENT.1 | `src/lib/pipeline/ent1.ts` | 포트됨 | 후속 단계 |
| ENT.2 | `src/lib/pipeline/ent2.ts` | 포트됨 | 후속 단계 |
| ENT.3 | `src/lib/pipeline/ent3.ts` | 포트됨 | rule + llm |

중요한 점은 현재 PRE.1이 원본 Python의 `epub.py + io.py`를 그대로 다시 수행하는 단계는 아니라는 것이다.

## 단계별 이전 결과

| Stage | 필요 입력 | 이전 단계 기준 |
|---|---|---|
| PRE.1 | `RawChapter` | 파이프라인 이전 단계 없음. 업로드/API에서 만들어진 raw chapter 사용 |
| PRE.2 | `PreparedChapter.raw_chapter` 또는 `RawChapter` | 실질적으로 PRE.1 결과를 사용 |
| ENT.1 | `RawChapter`, `ContentUnits` | PRE.2 필요 |
| ENT.2 | `RawChapter`, `MentionCandidates` | ENT.1 필요 |
| ENT.3 | `FilteredMentions`, `RawChapter` | ENT.2 필요 |

---

## PRE.1 - Raw Chapter Preparation

### 현재 구현 파일

`src/lib/pipeline/pre1.ts`

### 역할

이미 업로드 과정에서 정규화된 `RawChapter`를 현재 run의 첫 artifact로 감싼다.  
즉 "EPUB 파싱 단계"라기보다 "chapter-level raw 데이터를 PRE.1 artifact로 materialize하는 단계"다.

### EPUB 파싱이 실제로 일어나는 곳

- 업로드 및 EPUB 처리: `src/app/api/epub/route.ts`
- parser 유틸: `src/lib/epub.ts`

### 시그니처

```ts
export async function runRawChapterPreparation(
  chapter: RawChapter,
  docId: string,
  chapterId: string,
  parents: Record<string, string> = {},
  onProgress?: (msg: string) => void,
): Promise<PreparedChapter>
```

### 출력

`PreparedChapter`

핵심 필드:

- `chapter_title`
- `source_type`
- `paragraph_count`
- `char_count`
- `raw_chapter`

### run_id

```ts
const runId = `raw_chapter__${docId}__${chapterId}`
```

---

## PRE.2 - Content Classification

### 현재 구현 파일

`src/lib/pipeline/pre2.ts`

### 역할

paragraph를 narrative / non-narrative로 나눠 이후 단계가 어떤 pid를 처리할지 결정한다.

### 출력

`ContentUnits`

핵심 필드:

- `units[].pid`
- `units[].content_type`
- `units[].is_story_text`

### run_id

```ts
const runId = `classify__${docId}__${chapterId}`
```

---

## ENT.1 - Mention Extraction

### 현재 구현 파일

`src/lib/pipeline/ent1.ts`

### 역할

story text paragraph만 대상으로 cast / place / time mention 후보를 high-recall로 추출한다.

### 출력

`MentionCandidates`

### run_id

```ts
const runId = `mentions_llm__${docId}__${chapterId}`
```

---

## ENT.2 - Mention Validation

### 현재 구현 파일

`src/lib/pipeline/ent2.ts`

### 역할

ENT.1 후보를 검증해 false positive를 줄인다.

### 출력

`FilteredMentions`

### 추가 유틸

`toFilteredCandidates(log)`가 `valid === true` mention만 다시 `MentionCandidates` 형태로 돌려준다.

### run_id

```ts
const runId = `validated_llm__${docId}__${chapterId}`
```

---

## ENT.3 - Entity Resolution

### 현재 구현 파일

`src/lib/pipeline/ent3.ts`

### 역할

mention을 entity cluster로 묶고 unresolved mention을 분리한다.

### 메서드

- rule 기반: `entities_rule__...`
- LLM 기반: `entities_llm__...`

### 출력

`EntityGraph`

핵심 필드:

- `entities`
- `unresolved_mentions`
- `method`

### run_id

```ts
const runId = `entities_rule__${docId}__${chapterId}`
const runId = `entities_llm__${docId}__${chapterId}`
```

---

## 운영 기준 메모

현재 프로젝트 문맥에서는 PRE가 가장 직접적으로 UI와 연결된다.

- `PipelineRunner`에서 PRE.1은 paragraph preview를 따로 보여 준다.
- PRE.1 / PRE.2는 현재 업로드 흐름과 가장 자연스럽게 이어진다.
- ENT 이후 단계는 포트돼 있지만, 결과 확인 화면은 원본 Streamlit처럼 전용 viewer가 아니라 공통 JSON 패널이다.
