# Cross-chapter Reader Experience 설계

## 목적

`BOOK.0` cross-chapter memory가 만들어졌기 때문에 다음 단계는 이 정보를 독자 화면에서 "필요할 때만" 보여주는 것이다. 핵심은 전체 줄거리 요약을 다시 제공하는 것이 아니라, 현재 장면을 이해하는 데 필요한 이전/이후 연결만 골라서 제공하는 것이다.

Reader 화면의 역할은 다음 세 가지로 정리한다.

- 지금 장면이 이전 챕터의 어떤 결과에서 이어졌는지 보여준다.
- 반복 등장 인물, 장소, 사건 thread를 현재 장면과 연결해서 보여준다.
- 독자가 흐름을 잃었을 때만 자세한 근거와 경로를 펼쳐볼 수 있게 한다.

## 단계 정제안

현재 구현된 `BOOK.0`은 문서 전체의 memory snapshot이다. Reader에 바로 모든 정보를 보여주면 과하므로, 다음 단계는 아래처럼 나누는 것이 좋다.

### BOOK.0: Cross-chapter Memory Snapshot

이미 구현된 단계다.

- 입력: 각 챕터의 `SUP.0`, `ENT.3`
- 출력: `BookMemorySnapshot`
- 포함 정보: `sceneRefs`, `edges`, `entityThreads`, `missingChapters`, `chapterRunIds`

이 단계는 저장과 재사용의 기준이 된다. 독자 화면에서는 원본 snapshot을 그대로 보여주지 않고, 현재 scene에 맞춰 retrieval 한다.

### BOOK.1: Reader Memory Retrieval

아직 별도 저장 stage로 만들지는 않고, 1차 구현에서는 Reader 클라이언트에서 deterministic하게 계산한다.

- 입력: `BOOK.0`, 현재 `chapterId`, 현재 `sceneId`, 현재 `FINAL.1` packet
- 출력: 현재 scene 중심의 memory context
- 선택 정보: incoming/outgoing bridge edge, 현재 챕터에 등장하는 entity thread, 주변 scene path

나중에 이 로직이 커지면 `/api/book-memory/context` 같은 API나 저장 stage로 분리한다.

### BOOK.2: Reader Display Policy

독자에게 어떤 형태로 보여줄지 결정하는 단계다.

- `causal_bridge`, `place_shift`, `same_place`, `character_thread`는 현재 장면 옆의 "Memory Bridge" 카드로 보여준다.
- `entity_reappearance`는 반복 등장 인물/장소 thread chip으로 보여준다.
- 전체 `chapter_sequence`는 작은 timeline으로 보여준다.
- 근거가 많은 정보는 기본 접힘 상태로 두고, 상세 근거는 필요할 때만 펼친다.

이 단계도 1차 구현에서는 컴포넌트 내부 정책으로 두고, 추후 별도 support policy로 승격한다.

## Reader UI 제안

### 1. Memory Bridge

현재 scene과 직접 연결된 cross-chapter edge를 보여준다.

- 이전 챕터에서 넘어온 원인: `cross_chapter_causal_bridge`
- 장소가 이어지거나 바뀌는 정보: `cross_chapter_same_place`, `cross_chapter_place_shift`
- 같은 인물이 계속 등장하는 정보: `cross_chapter_character_thread`
- 단순 순서 연결: `chapter_sequence`

이 카드는 오른쪽 support rail에 배치한다. 본문 위에 크게 두면 독서 흐름을 방해할 수 있으므로, 기본은 보조 패널이 적절하다.

### 2. Thread Chips

여러 챕터에 반복 등장하는 entity를 칩 형태로 보여준다.

- 인물: Alice, the Queen, the Hatter 등
- 장소: the garden, the court 등
- 각 칩은 총 mention 수와 등장 챕터 수를 함께 보여준다.

칩을 누르는 상세 인터랙션은 추후 과제다. 1차 구현에서는 현재 챕터에 연결된 주요 thread를 정렬해서 보여준다.

### 3. Mini Book Path

현재 scene이 책 전체 장면 경로 중 어디에 있는지 보여준다.

- 이전 scene
- 현재 scene
- 다음 scene

전체 그래프를 Reader 안에 넣는 것은 과하다. 독자에게 필요한 것은 "내가 지금 어디에 있는가"이므로 주변 3개 정도의 path가 적절하다.

### 4. Evidence Drawer

각 edge에는 evidence가 있다. 그러나 근거 문장을 모두 펼치면 Reader가 복잡해진다.

- 기본 카드에는 label과 연결 방향만 보여준다.
- evidence count만 작은 숫자로 표시한다.
- 필요하면 다음 구현에서 카드별 details로 evidence text를 펼친다.

## 1차 구현 범위

이번 구현에서는 다음을 완료한다.

- `ReaderView`가 최신 `BOOK.0` snapshot을 함께 로드한다.
- `ReaderScreen`이 `bookMemory` prop을 받아 현재 `chapterId:sceneId` 기준으로 context를 계산한다.
- 오른쪽 support rail에 `Cross-chapter Memory` 패널을 추가한다.
- 패널은 `Bridges`, `Threads`, `Path` 세 탭을 제공한다.
- `Bridges`는 현재 scene으로 들어오거나 나가는 edge를 보여준다.
- `Threads`는 현재 챕터에 등장하는 반복 entity thread를 보여준다.
- `Path`는 현재 scene 주변의 book-level scene path를 보여준다.

## 후속 구현 후보

다음 단계에서 구현할 가치가 있는 항목은 다음과 같다.

- `BOOK.1` API: 특정 scene에 대한 memory context를 서버에서 계산해 반환한다.
- `BOOK.0` graph projection: book-level edge도 `KnowledgeGraphExplorer`에서 query 가능하게 한다.
- entity thread disambiguation: canonical name만으로 묶는 현재 방식은 동명이인/일반명사에 취약하므로 alias evidence를 보강한다.
- Reader jump: memory card에서 이전/다음 챕터 Reader로 바로 이동한다.
- LLM polishing: deterministic edge label을 독자 친화적인 한 문장 설명으로 재작성한다.

## 점검 기준

구현 후 다음을 확인한다.

- `BOOK.0`이 없어도 Reader는 깨지지 않아야 한다.
- legacy reader에서는 book memory를 요구하지 않아야 한다.
- scene id가 맞지 않아도 빈 상태를 안전하게 보여줘야 한다.
- 현재 scene과 무관한 전체 book 정보가 과도하게 노출되지 않아야 한다.
- `tsc`, `lint`, `next build`를 통과해야 한다.
