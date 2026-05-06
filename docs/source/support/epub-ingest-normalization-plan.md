# EPUB Ingest Normalization 계획

## 문제 정의

현재 EPUB 업로드는 `src/lib/epub.ts`의 `parseEpub`에서 spine 문서를 읽고 `RawChapter[]`로 저장한다. 기본 동작은 다음과 같다.

- EPUB spine item을 읽는다.
- HTML에서 paragraph 후보를 추출한다.
- `1 spine document = 1 chapter candidate`로 본다.
- 짧은 candidate는 이전 candidate에 merge한다.
- 너무 긴 candidate는 글자 수 기준으로 split한다.
- 결과를 `ch01`, `ch02` 형태의 `RawChapter`로 저장한다.

이 방식은 단순하고 빠르지만, EPUB 구조가 불안정하면 파이프라인 전체 품질을 오염시킨다.

## 현재 한계

1. Header, footer, front matter가 chapter로 잡힌다.
   - cover, title page, copyright, TOC, dedication, publisher note, blank page가 실제 내용처럼 저장될 수 있다.
   - 첫 번째 짧은 항목은 이전 chapter가 없기 때문에 merge되지 않고 살아남을 수 있다.

2. 짧은 non-content item이 실제 chapter에 붙는다.
   - 현재 `MIN_CHARS`보다 짧으면 이전 candidate에 붙인다.
   - 이때 footer, advertisement, end note가 이전 실제 chapter의 본문으로 섞일 수 있다.

3. chapter가 나뉘지 않은 EPUB은 의미 단위로 분할되지 않는다.
   - spine 하나에 책 전체가 들어간 EPUB은 `MAX_CHARS` 기준으로만 잘린다.
   - 결과는 chapter가 아니라 임의 길이 chunk가 되며, 이후 scene/chapter/cross-chapter memory 품질이 낮아진다.

4. TOC를 실제 분할 근거로 쓰지 않는다.
   - 현재 코드는 TOC 존재 여부를 확인하지만 anchor/href 기반으로 문서를 다시 자르지는 않는다.

5. ingest decision을 검수하기 어렵다.
   - 왜 어떤 spine item이 chapter가 되었는지, 왜 merge/split 되었는지 저장하지 않는다.
   - 잘못된 chapter 구조를 사람이 수정하거나 재처리하기 어렵다.

## 목표

`PRE.1` 이전에 `INGEST.1` 성격의 normalization layer를 둔다. 목표는 EPUB의 물리 구조를 그대로 믿지 않고, reader-facing chapter 후보를 재구성하는 것이다.

핵심 원칙은 다음과 같다.

- 원본 spine/nav 구조는 보존한다.
- 실제 본문 후보와 non-content 후보를 분리한다.
- chapter가 없거나 과하게 큰 경우 의미 단위로 재분할한다.
- 모든 자동 판단은 manifest로 저장해 UI에서 검수 가능하게 한다.
- 자동 판단이 애매하면 삭제하지 않고 excluded/pending 상태로 보관한다.

## 제안 파이프라인

```txt
EPUB file
-> source unit extraction
-> non-content classification
-> chapter candidate construction
-> semantic re-splitting
-> merge/split decision logging
-> RawChapter[] + IngestManifest 저장
```

## 1. Source Unit Extraction

EPUB에서 다음 단위들을 먼저 추출한다.

- spine item
- nav/toc item
- manifest metadata
- href, id, media type
- title 후보
- html heading 후보
- paragraph 후보
- text length, paragraph count
- link count, image count
- epub type, class/id hint

이 단계의 산출물은 `EpubSourceUnit[]`이다.

```ts
interface EpubSourceUnit {
  unitId: string
  spineIndex: number
  href?: string
  manifestId?: string
  title: string
  headings: string[]
  paragraphs: string[]
  textLength: number
  linkTextLength: number
  imageCount: number
  epubType?: string
  htmlClassHints: string[]
}
```

## 2. Non-Content Classification

각 source unit에 content type을 붙인다.

```ts
type SourceUnitKind =
  | "content"
  | "front_matter"
  | "back_matter"
  | "toc"
  | "copyright"
  | "cover"
  | "dedication"
  | "acknowledgment"
  | "publisher_note"
  | "nav"
  | "blank"
  | "unknown"
```

판단 근거는 rule 기반으로 시작한다.

- title/href/class에 `cover`, `copyright`, `toc`, `nav`, `contents`, `dedication`, `acknowledg` 등이 포함되는지
- text length가 지나치게 짧은지
- link text 비율이 높은지
- image만 있고 본문이 거의 없는지
- ISBN, publisher, rights, all rights reserved 같은 문구가 있는지
- page number, running header/footer처럼 반복되는 짧은 문구인지
- heading은 chapter처럼 보이지만 본문 paragraph가 없는지

애매한 경우는 `unknown` 또는 `front_matter`로 두고 삭제하지 않는다.

## 3. Chapter Candidate Construction

`content`로 판단된 source unit만 이용해 chapter candidate를 만든다.

기본 전략은 다음과 같다.

- TOC anchor가 신뢰 가능하면 TOC anchor 기준으로 chapter를 만든다.
- spine item이 충분히 크고 heading이 chapter-like이면 spine item을 chapter로 둔다.
- 짧은 source unit은 무조건 이전 chapter에 붙이지 않고, 다음 조건을 봐서 결정한다.
  - 앞/뒤 chapter와 같은 href 내부 fragment인지
  - chapter title/heading이 있는지
  - 본문 paragraph가 실제 서술인지
  - non-content classifier score가 낮은지

merge decision은 항상 manifest에 남긴다.

## 4. Semantic Re-Splitting

chapter가 하나로 뭉친 EPUB 또는 너무 긴 chapter candidate는 의미 단위로 다시 나눈다.

분할 신호 우선순위는 다음과 같다.

1. TOC anchor/href
2. HTML heading hierarchy: `h1`, `h2`, `h3`
3. 텍스트 heading pattern
   - `Chapter 1`, `CHAPTER I`, `1.`, `I.`
   - `제1장`, `제 1 장`, `1장`, `프롤로그`, `에필로그`
4. EPUB pagebreak/landmark
5. 큰 빈 줄/section divider
6. LLM boundary proposal
7. fallback paragraph-window split

LLM은 본문 전체를 다시 쓰게 하지 않는다. boundary 후보만 JSON으로 받는다.

```ts
interface BoundaryProposal {
  beforeParagraphIndex: number
  title: string
  confidence: "high" | "medium" | "low"
  reason: string
}
```

## 5. Ingest Manifest 저장

`RawChapter[]`만 저장하지 말고 ingest manifest를 같이 저장한다.

저장 위치 제안:

```txt
documents_v2/{docId}/ingest/manifests/current
```

또는 버전 관리를 위해:

```txt
documents_v2/{docId}/ingest_runs/{ingestRunId}
```

Manifest에는 다음이 들어간다.

```ts
interface EpubIngestManifest {
  ingestRunId: string
  docId: string
  sourceFileName: string
  sourceUnits: EpubSourceUnitSummary[]
  decisions: IngestDecision[]
  chapters: IngestChapterCandidate[]
  excludedUnits: ExcludedSourceUnit[]
  warnings: string[]
}
```

결정 로그 예시:

```ts
interface IngestDecision {
  decisionId: string
  type: "classify" | "merge" | "split" | "exclude" | "keep"
  targetUnitIds: string[]
  result: string
  confidence: number
  reason: string
}
```

## UI 요구사항

업로드 직후 또는 문서 선택 화면에서 ingest preview를 볼 수 있어야 한다.

필요한 화면:

- source unit 목록
- 각 unit의 classifier 결과
- excluded unit 목록
- 최종 chapter 후보 목록
- 각 chapter가 어떤 source unit/paragraph 범위에서 왔는지
- warning 목록

수동 조정은 2차 기능으로 둔다.

- excluded unit 복구
- chapter merge
- chapter split point 추가
- chapter title 수정
- manifest 기준으로 RawChapter 재생성

## 구현 단계

### Step 1. Rule-based manifest

- `src/lib/epub.ts` 내부 로직을 `extractSourceUnits`, `classifySourceUnits`, `buildChapterCandidates`로 분리한다.
- `parseEpub`는 기존처럼 `RawChapter[]`를 반환하되, 내부적으로 manifest 생성이 가능하게 만든다.
- Firestore에 ingest manifest 저장 함수를 추가한다.

### Step 2. Upload API 연결

- `/api/epub`에서 `parseEpubWithManifest`를 호출한다.
- `RawChapter[]`와 `EpubIngestManifest`를 함께 저장한다.
- 응답에 warnings와 excluded count를 포함한다.

### Step 3. UI preview

- 업로드 후 ingest summary를 보여준다.
- 문서 목록에서도 ingest warning이 있는 문서를 표시한다.

### Step 4. Semantic split 강화

- TOC anchor 기반 split을 먼저 구현한다.
- heading pattern split을 추가한다.
- 마지막으로 LLM boundary proposal을 선택 기능으로 붙인다.

### Step 5. 수동 보정

- manifest edit API를 만든다.
- 수정된 manifest로 `RawChapter[]`를 재생성한다.
- 재생성 시 기존 pipeline run은 invalidated/fork 처리한다.

## 파이프라인 영향

이 단계가 안정화되면 다음 문제가 줄어든다.

- header/footer chapter 때문에 ENT/STATE/SCENE이 불필요하게 실행되는 문제
- 잘못 합쳐진 front matter가 본문 chapter를 오염시키는 문제
- 의미 없는 chunk split 때문에 scene boundary와 cross-chapter memory가 흔들리는 문제
- 독자 화면에서 실제 본문이 아닌 항목이 chapter로 보이는 문제

따라서 `INGEST.1`은 단순 전처리가 아니라 전체 reader-support 품질을 결정하는 foundation 단계로 보는 것이 맞다.

