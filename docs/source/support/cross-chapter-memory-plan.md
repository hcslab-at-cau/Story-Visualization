# Cross-Chapter Memory 계획

## 현재 판단

현재 `PRE`부터 `SUP`까지의 파이프라인은 챕터 단위로 유지하는 것이 맞다. 각 챕터 안에서 scene, entity, state, subscene, reader-support 결과를 안정적으로 만든 뒤, 그 결과를 책 전체 단위로 다시 묶는 별도 계층을 둔다.

이유는 다음과 같다.

- 챕터 단위 실행은 실패 범위가 작고, 특정 챕터만 재실행하기 쉽다.
- `SUP.0`은 이미 scene/event/edge 형태의 memory를 만들기 때문에 book-level aggregation의 좋은 입력이 된다.
- cross-chapter 연결은 모든 stage를 다시 book-level로 바꾸지 않고도 `SUP.0`, `ENT.3`, `SCENE.3`, `SUB.3` 결과 위에서 만들 수 있다.
- 독자에게 필요한 이전 맥락은 항상 전체 책 요약이 아니라 현재 scene과 연결되는 일부 thread만 필요하다.

## 목표 구조

```txt
Chapter-local pipeline
PRE -> ENT -> STATE -> SCENE -> SUB -> SUP

Book-level memory
각 챕터의 ENT.3 + SUP.0 수집
-> BOOK.0 cross-chapter memory snapshot
-> 추후 SUP enrichment / reader retrieval에 주입
```

`BOOK.0`은 정식 pipeline stage라기보다 document-level projection이다. 저장 위치는 챕터 run 하위가 아니라 문서 하위에 둔다.

```txt
documents_v2/{docId}/book_memories/{bookRunId}
```

## 1차 구현 범위

이번 구현은 다음을 MVP로 둔다.

- 같은 `runId`를 모든 챕터에 적용하거나, 챕터별 `runId` map을 받아서 book memory를 만든다.
- 각 챕터에서 `SUP.0`을 읽어 scene/event/edge를 수집한다.
- 각 챕터에서 `ENT.3`을 읽어 같은 canonical entity가 여러 챕터에 반복 등장하는 thread를 만든다.
- 인접 챕터 사이의 마지막 scene과 첫 scene을 연결한다.
- shared cast, place continuity/shift, causal bridge, entity reappearance edge를 만든다.
- 생성 결과를 API와 Graph 화면에서 확인할 수 있게 한다.

## 데이터 형태

`BookMemorySnapshot`은 다음 정보를 가진다.

- `bookRunId`: book memory snapshot id
- `docId`
- `chapterRunIds`: 각 챕터가 어떤 run 결과를 사용했는지
- `chapters`: 포함된 챕터 목록과 scene/event/entity count
- `sceneRefs`: chapter id가 포함된 scene reference
- `edges`: chapter 경계를 넘는 연결
- `entityThreads`: 여러 챕터에 걸쳐 등장한 entity thread
- `missingChapters`: 필요한 stage 결과가 없어 제외된 챕터

중요한 점은 scene id가 챕터마다 겹칠 수 있으므로, book-level에서는 항상 `chapterId:sceneId` 형태의 `sceneKey`를 사용한다.

## Edge 종류

1차 edge type은 다음으로 제한한다.

- `chapter_sequence`: 이전 챕터 마지막 scene -> 현재 챕터 첫 scene
- `cross_chapter_character_thread`: 챕터 경계 양쪽에 같은 active cast가 이어짐
- `cross_chapter_same_place`: 같은 장소가 챕터 경계를 넘어 유지됨
- `cross_chapter_place_shift`: 챕터 경계에서 장소가 바뀜
- `cross_chapter_causal_bridge`: 이전 챕터 말미의 causal result가 현재 챕터 첫 사건과 이어질 가능성
- `entity_reappearance`: 같은 canonical entity가 여러 챕터에 반복 등장

## 이후 확장

1차 구현 이후에는 다음 단계가 필요하다.

- `SUP.1` 이후 단계가 `BOOK.0`에서 현재 scene에 필요한 thread만 retrieval하도록 연결한다.
- `ReaderScreen`에서 scene별 cross-chapter recap card를 보여준다.
- entity alias merge 품질을 올리기 위해 `ENT.3` canonical name만 쓰지 않고 mention context와 relation evidence를 함께 사용한다.
- book memory를 graph projection과 통합해 chapter filter 없이 document-level query를 제공한다.
- 긴 책에서는 전체 챕터를 매번 다시 aggregate하지 않고 변경된 챕터만 incremental update한다.

