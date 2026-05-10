# SUP / BOOK.0 / Knowledge Graph 시각화 구현

## 목적

미팅이나 데모에서 `SUP.*`, `BOOK.0`, Knowledge Graph의 역할을 말로만 설명하기 어렵기 때문에 Graph 탭에 발표용 시각화 계층을 추가했다.

이번 구현의 목표는 분석용 raw JSON을 더 많이 보여주는 것이 아니라, 다음 세 가지 질문에 바로 답할 수 있게 하는 것이다.

- `SUP.0~SUP.7`은 각각 무엇을 만들고 현재 run에서 어디까지 생성되었는가?
- `BOOK.0`은 여러 챕터를 어떻게 연결하고 어떤 cross-chapter memory를 만들었는가?
- Knowledge Graph projection은 `ENT.3`와 `SUP.0`을 어떤 node/edge 구조로 바꾸는가?

## 추가된 화면

### 1. Presentation Structure Map

위치:

```text
Graph tab -> top section
```

관련 파일:

```text
src/components/SupportSystemShowcase.tsx
src/lib/visualization-strings.ts
```

기능:

- 현재 선택한 `docId`, `chapterId`, `runId` 기준으로 `loadRunResults`, `loadBookMemory`, `loadKnowledgeGraph`를 호출한다.
- `SUP.0~SUP.7` stage card를 한 줄 흐름으로 보여준다.
- 각 stage가 생성되었는지, 몇 개의 scene/unit/packet이 있는지 live metric으로 보여준다.
- Knowledge Graph, BOOK.0, Reader Support를 별도 product card로 보여준다.

설명 포인트:

- `SUP.0`은 story memory 원천이다.
- `BOOK.0`은 챕터별 `SUP.0`과 선택적 `ENT.3`를 모아 책 단위 memory를 만든다.
- Knowledge Graph는 `ENT.3`와 `SUP.0`을 Firestore node/edge로 투영한다.
- `SUP.7`은 Reader display plan이므로, 최종 독자 UI와 연결되는 지점이다.

### 2. BOOK.0 Memory Map

위치:

```text
Graph tab -> Book Memory panel -> stats 아래
```

관련 파일:

```text
src/components/BookMemoryMap.tsx
src/components/BookMemoryPanel.tsx
```

기능:

- `BookMemorySnapshot.chapters`를 하나의 chapter lane으로 표시한다.
- `BookMemorySnapshot.edges`를 arc 형태로 표시한다.
- edge type별 색상과 개수를 legend로 보여준다.
- `entityThreads`는 chapter별 등장 여부가 보이는 ribbon 형태로 표시한다.

표시하는 edge type:

```text
chapter_sequence
cross_chapter_character_thread
cross_chapter_same_place
cross_chapter_place_shift
cross_chapter_causal_bridge
entity_reappearance
```

설명 포인트:

- `BOOK.0`은 전체 줄거리 요약이 아니라 현재 scene에 필요한 이전 thread를 찾기 위한 memory map이다.
- arc는 챕터 사이의 연결이고, ribbon은 반복 등장 entity의 흐름이다.
- 현재 구현은 book-level graph database가 아니라 snapshot 기반 memory다.

### 3. Knowledge Graph Canvas

위치:

```text
Graph tab -> Knowledge Graph Explorer -> search/filter 아래
```

관련 파일:

```text
src/components/KnowledgeGraphCanvas.tsx
src/components/KnowledgeGraphExplorer.tsx
```

기능:

- 현재 query 결과의 graph nodes를 kind별 column으로 배치한다.
- node kind는 `scene`, `event`, `character`, `place`, `entity`, `mention`이다.
- edge는 node 사이의 curve로 표시한다.
- node를 클릭하면 기존 graph API의 `nodeId + depth` query를 사용해 주변 hop을 다시 조회한다.
- node/edge가 너무 많은 경우 canvas는 node 96개, edge 180개까지만 그린다.

설명 포인트:

- 이 canvas는 graph DB viewer가 아니라 Firestore projection을 설명하기 위한 lightweight visualization이다.
- 현재 graph source는 `ENT.3`와 `SUP.0`이다.
- `SUP.0`에서 scene/event/place/character 관계가 나오고, `ENT.3`에서 entity/mention 관계가 나온다.

## 문자열 관리

새 시각화 UI의 한국어/영어 문구는 별도 catalog로 분리했다.

```text
src/lib/visualization-strings.ts
```

기존 `ui-strings.ts`를 과도하게 키우지 않기 위해, 발표용 시각화에 한정된 copy는 별도 파일에서 `UiLocale` 기준으로 관리한다.

## 검증

수행한 검증:

```text
npm run lint
npm run build
```

결과:

- `npm run lint` 통과.
- 기존 `PipelineRunner.tsx`의 `<img>` warning 3개는 남아 있음.
- `npm run build` 통과.
- build 중 Next.js가 상위 폴더 `C:\Users\HOONLAB\package-lock.json`을 root로 추론했다는 warning이 표시되지만 빌드는 성공한다.

## 현재 한계

- Knowledge Graph canvas는 force-directed graph가 아니라 deterministic column layout이다.
- BOOK.0 arc는 현재 snapshot edge를 설명하기 위한 개요 시각화이며, edge 클릭 drill-down은 아직 없다.
- SUP stage map은 current run의 artifact 존재 여부와 주요 count를 보여주지만, stage 내부 JSON inspector를 대체하지는 않는다.
- 향후에는 edge 클릭 시 `/api/support-context` 응답과 Reader support unit까지 연결하는 drill-down이 필요하다.
