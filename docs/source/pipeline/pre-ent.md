# Pipeline: PRE, ENT

이 문서는 현재 `Story-Visualization` 저장소에서 `PRE.1 ~ ENT.3`이 실제로 어떻게 구현되어 있는지 정리한다.

관련 구현 파일:

- `src/lib/pipeline/pre1.ts`
- `src/lib/pipeline/pre2.ts`
- `src/lib/pipeline/ent1.ts`
- `src/lib/pipeline/ent2.ts`
- `src/lib/pipeline/ent3.ts`
- `src/app/api/pipeline/pre1/route.ts`
- `src/app/api/pipeline/pre2/route.ts`
- `src/app/api/pipeline/ent1/route.ts`
- `src/app/api/pipeline/ent2/route.ts`
- `src/app/api/pipeline/ent3/route.ts`

---

## 현재 상태

| Stage | 구현 위치 | 현재 상태 | 비고 |
|---|---|---|---|
| PRE.1 | `src/lib/pipeline/pre1.ts` | 구현 완료 | 업로드된 `RawChapter`를 현재 run artifact로 materialize |
| PRE.2 | `src/lib/pipeline/pre2.ts` | 구현 완료 | paragraph content classification |
| ENT.1 | `src/lib/pipeline/ent1.ts` | 구현 완료 | mention extraction |
| ENT.2 | `src/lib/pipeline/ent2.ts` | 구현 완료 | mention validation |
| ENT.3 | `src/lib/pipeline/ent3.ts` | 구현 완료 | rule-based clustering + optional LLM pronoun/alias resolution |

핵심 포인트:

- PRE.1은 EPUB 파싱 자체가 아니라, 업로드/API 단계에서 만든 `RawChapter`를 현재 run 기준 artifact로 저장하는 단계다.
- EPUB 파싱은 `src/app/api/epub/route.ts`, `src/lib/epub.ts`에서 처리된다.
- ENT 단계는 모두 실제 API route와 파이프라인 로직이 연결되어 있다.

---

## PRE.1 - Raw Chapter Preparation

### 역할

- 업로드/API 단계에서 만들어진 `RawChapter`를 현재 run의 첫 artifact로 materialize
- 이후 단계가 참조할 chapter-level source artifact를 통일

### 입력

- `RawChapter`

### 출력

- `PreparedChapter`

주요 필드:

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

### 역할

- paragraph를 `narrative / non-narrative` 계열로 분류
- 이후 단계가 어떤 pid를 story text로 다룰지 결정

### 입력

- `PreparedChapter` 또는 `RawChapter`

### 출력

- `ContentUnits`

주요 필드:

- `units[].pid`
- `units[].content_type`
- `units[].is_story_text`

### run_id

```ts
const runId = `classify__${docId}__${chapterId}`
```

---

## ENT.1 - Mention Extraction

### 역할

- story text paragraph를 대상으로 cast / place / time mention 후보를 high-recall로 추출

### 입력

- `RawChapter`
- `ContentUnits`

### 출력

- `MentionCandidates`

### run_id

```ts
const runId = `mentions_llm__${docId}__${chapterId}`
```

---

## ENT.2 - Mention Validation

### 역할

- ENT.1 후보를 검증하여 false positive를 줄임

### 입력

- `RawChapter`
- `MentionCandidates`

### 출력

- `FilteredMentions`

추가 유틸:

- `toFilteredCandidates(log)`가 `valid === true` mention만 다시 `MentionCandidates` 형태로 변환

### run_id

```ts
const runId = `validated_llm__${docId}__${chapterId}`
```

---

## ENT.3 - Entity Resolution

### 역할

- mention을 entity cluster로 묶고 unresolved mention을 처리

### 현재 구현 방식

1. 규칙 기반 1차 클러스터링
   - span normalization
   - trigram 유사도 기반 alias 흡수
   - cast pronoun은 unresolved로 분리
2. unresolved pronoun이 있으면 LLM 호출
   - pronoun resolution
   - alias merge

### 입력

- `RawChapter`
- `MentionCandidates`

### 출력

- `EntityGraph`

주요 필드:

- `entities`
- `unresolved_mentions`
- `method`

### run_id

```ts
const runId = `entities_rule__${docId}__${chapterId}`
const runId = `entities_llm__${docId}__${chapterId}`
```

---

## 현재 구현 메모

- `PipelineRunner`에는 PRE/ENT 결과를 위한 전용 view가 연결되어 있다.
- PRE.1은 paragraph preview를 보여준다.
- ENT.1 / ENT.2 / ENT.3은 raw JSON만이 아니라 stage-specific inspector를 일부 갖고 있다.

---

## 개선 필요 지점

### 1. ENT.3의 2차 정규화 범위가 좁다

현재 `ENT.3`의 LLM 보정은 사실상 pronoun resolution과 일부 alias merge 중심이다.
즉, pronoun이 없으면 rule 결과가 그대로 확정되기 쉽다.

문제:

- 비-pronoun alias 오류가 남아도 LLM 2차 정규화가 충분히 작동하지 않을 수 있음
- 긴 이름/호칭/별칭의 통합 품질이 scene 이후 단계에 직접 영향

권장 개선:

- pronoun 유무와 별개로 low-confidence cluster만 골라 LLM review pass 추가
- `canonical_name` 재선정 로직을 merge 이후 한 번 더 수행

### 2. ENT.3 LLM 분기에서 residual unresolved 추적이 약하다

현재 구현은 LLM resolution 후 `unresolved_mentions: []`로 끝난다.

문제:

- 실제로 해결되지 않은 mention이 남아도 후속 단계가 그 사실을 잃을 수 있음

권장 개선:

- 해결 실패 mention을 별도로 남기기
- `resolved / unresolved / ambiguous`를 구분하는 편이 안전

### 3. PRE/ENT 단계의 신뢰도 정보가 후속 단계에 약하게 전달된다

현재 후속 단계는 validation을 거치지만, mention/entity confidence를 풍부하게 전달하지는 않는다.

권장 개선:

- mention/entity 단위 confidence 또는 review flag 도입
- 후속 단계에서 weak evidence를 더 보수적으로 다루도록 연결
