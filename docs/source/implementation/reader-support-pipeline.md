# Reader Support Pipeline 현재 구현

이 문서는 현재 코드에 맞는 reader support 파이프라인을 한 곳에서 설명한다. 오래된 설계 문서의 `BOOK.0 edge 직접 주입`, `SUP.* proposal`, `reader support plan` 내용은 이 문서를 기준으로 읽으면 된다.

## 한 줄 요약

현재 최종 Reader support는 다음 경로로 만들어진다.

```text
chapter-local stages
-> SUP.0~SUP.7
-> BOOK.0
-> NRG.0 claim view
-> NRG claim 기반 SupportUnit 보강
-> FINAL.1.support
-> ReaderScreen
```

`Knowledge Graph`는 이 흐름의 핵심 입력이 아니라, `ENT.3`와 `SUP.0`을 탐색하기 위한 Firestore projection이다.

## 전체 흐름

```text
PRE / ENT / STATE / SCENE / SUB / VIS
        |
        v
SUP.0  Support Memory
SUP.1  Shared Support Representation
SUP.2  Snapshot + Boundary
SUP.3  Causal Bridges
SUP.4  Character + Relation
SUP.5  Reentry + Reference + Spatial + Visual Cue
SUP.6  Support Policy
SUP.7  Reader Support Package
        |
        +-- reads latest BOOK.0
        +-- derives NRG.0 claims from BOOK.0
        +-- injects NRG-derived support candidates
        |
        v
FINAL.1 Scene Reader Package
FINAL.2 Overlay Refinement
ReaderScreen
```

중요한 점:

- `FINAL.1`은 `SUP.7`을 읽어서 scene별 `support`를 포함한다.
- `FINAL.2`는 graph를 사용하지 않는다. `FINAL.2`는 image/overlay refinement 단계다.
- `ReaderScreen`은 `FINAL.1`과 optional `FINAL.2`를 합쳐 최종 화면을 만든다.

## KG, BOOK.0, NRG의 역할

| Layer | 입력 | 목적 | Reader support 반영 |
|---|---|---|---|
| `Knowledge Graph` | `ENT.3`, `SUP.0` | Graph 탭 탐색/디버깅용 node/edge projection | 직접 반영하지 않음 |
| `BOOK.0` | 여러 chapter의 `SUP.0`, 선택적 `ENT.3` | cross-chapter memory snapshot | NRG 원천으로 사용 |
| `NRG.0` | `BOOK.0` | reader-position-safe claim/relation view | `SUP.7`에서 SupportUnit으로 변환 |

현재 구조에서 `Knowledge Graph`와 `NRG.0`은 중복이 아니다.

- `Knowledge Graph`: “무엇이 추출되었는가?”를 확인한다.
- `NRG.0`: “현재 독자 위치에서 무엇을 support로 써도 되는가?”를 판단한다.

## SUP branch

현재 `SUP.0`부터 `SUP.7`까지는 `src/lib/pipeline/support.ts`에 구현되어 있다.

| Stage | 역할 | 주요 출력 |
|---|---|---|
| `SUP.0` | scene/event/edge memory 생성 | `SupportMemoryLog` |
| `SUP.1` | 현재 scene 상태, boundary, prior thread 정리 | `SharedSupportRepresentation` |
| `SUP.2` | snapshot, boundary support 생성 | `SupportSnapshots` |
| `SUP.3` | causal/thread bridge 생성 | `SupportCausalBridges` |
| `SUP.4` | character/relation support 생성 | `SupportCharacterRelations` |
| `SUP.5` | reentry/reference/spatial/visual support 생성 | `SupportReentryReference` |
| `SUP.6` | support 후보 선별, suppressed/deferred 분리 | `SupportPolicySelection` |
| `SUP.7` | Reader display slot 패키징, BOOK.0/NRG 보강 | `ReaderSupportPackageLog` |

`SupportUnit`은 다음 필드를 통해 독자용 표시 품질을 제어한다.

- `reader_problem`
- `confidence`
- `grounding_score`
- `usefulness_score`
- `intrusion_cost`
- `spoiler_risk`
- `reader_copy`
- `anchor_hint`
- `claims`

## BOOK.0

`BOOK.0`은 여러 chapter run의 `SUP.0`을 모아 document-level memory snapshot을 만든다.

저장 위치:

```text
documents_v2/{docId}/book_memories/{bookRunId}
```

포함하는 내용:

- `chapters`
- `sceneRefs`
- `edges`
- `entityThreads`
- `chapterRunIds`
- `missingChapters`

주요 edge type:

- `chapter_sequence`
- `cross_chapter_character_thread`
- `cross_chapter_same_place`
- `cross_chapter_place_shift`
- `cross_chapter_causal_bridge`
- `entity_reappearance`

## NRG.0

현재 `NRG.0`은 별도 Firestore artifact로 저장하지 않고, `BOOK.0`에서 deterministic하게 파생하는 view다.

구현 위치:

- `src/lib/narrative-graph.ts`
- `src/app/api/narrative-graph/route.ts`

주요 claim type:

- `state`
- `event`
- `relation`
- `causal`
- `place`
- `goal`

모든 claim은 다음 정보를 가진다.

- evidence refs
- reveal position
- spoiler risk
- support level
- narrative scope
- source run id

`queryNarrativeGraphSnapshot()`은 현재 `chapterId`, `sceneId`, `supportKind`를 기준으로 reader-position-safe claim만 반환한다.

## NRG -> SupportUnit 변환

`SUP.7` 보강은 `src/lib/support-context.ts`에서 수행한다.

현재 기본 경로:

```text
buildSupportContext()
-> queryNarrativeGraphSnapshot()
-> context.narrativeClaims
-> supportUnitFromNarrativeClaim()
-> mergePacketWithBookUnits()
```

변환 규칙:

| NRG claim | SupportUnit kind |
|---|---|
| `causal` | `causal_bridge` |
| `place` | `spatial_continuity` |
| `relation` | `character_focus` |

현재 scene을 대상으로 하는 claim만 support로 변환한다. 즉 `claim.objectRefs`가 현재 `sceneKey`를 포함해야 한다.

NRG support가 생성되지 않는 경우에는 기존 `BOOK.0 incomingEdges -> SupportUnit` 변환이 fallback으로 동작한다.

## Reader 표시

`ReaderScreen`은 `FINAL.1`의 `SceneReaderPacket.support`를 읽는다.

현재 표시 방식:

- 본문 anchor를 클릭하면 해당 위치와 관련된 support 후보가 열린다.
- 여러 support가 겹치면 작은 popover에서 support kind를 고른다.
- 독자 모드는 anchor와 surface를 조용하게 표시한다.
- 연구자 모드는 anchor badge, support kind, provenance/debug 정보를 더 명확히 표시한다.
- support 설명은 `reader_copy`가 있으면 우선 사용하고, 없으면 legacy `body` parser fallback을 사용한다.

표시 surface:

- desktop: 오른쪽 side view
- mobile: bottom sheet
- full modal은 기본 support 설명에는 사용하지 않는다.

## 실행 순서

chapter-local 결과만 볼 때:

```text
PRE.1 -> PRE.2
ENT.1 -> ENT.2 -> ENT.3
STATE.1 -> STATE.2 -> STATE.3
SCENE.1 -> SCENE.2 -> SCENE.3
SUB.1 -> SUB.2 -> SUB.3
SUP.0 -> SUP.1 -> SUP.2~SUP.5 -> SUP.6 -> SUP.7
FINAL.1 -> FINAL.2
```

cross-chapter / NRG support까지 최종 Reader에 반영할 때:

```text
1. 각 chapter에서 SUP.0까지 실행
2. Graph 탭에서 BOOK.0 build
3. 해당 chapter/run에서 SUP.7 rerun
4. FINAL.1 rerun
5. Reader 화면 확인
```

`Knowledge Graph Projection rebuild`는 Graph 탭 탐색을 위한 작업이다. NRG support 생성에는 필수 단계가 아니다.

## Readiness

`/api/run-readiness`는 현재 run에 대해 다음을 점검한다.

- `ENT.3` 존재 여부
- `SUP.0` 존재 여부
- Knowledge Graph projection 존재 여부
- 최신 `BOOK.0` 존재 여부
- `BOOK.0.chapterRunIds[chapterId]`가 선택 run과 맞는지
- `NRG.0 reader-safe claims`가 파생되는지
- Reader가 사용할 effective run에 `FINAL.1`이 있는지

UI에서는 `RunReadinessPanel`에서 확인한다.

## 주요 코드 위치

- `src/lib/pipeline/support.ts`: `SUP.0~SUP.7`
- `src/lib/book-memory.ts`: `BOOK.0`
- `src/lib/narrative-graph.ts`: `NRG.0` claim/relation view
- `src/lib/support-context.ts`: BOOK.0/NRG retrieval과 SupportUnit 보강
- `src/lib/support-realization.ts`: SupportUnit 독자용 문구 변환
- `src/components/ReaderScreen.tsx`: anchored support UI
- `src/app/api/run-readiness/route.ts`: readiness check
- `src/app/api/narrative-graph/route.ts`: NRG query API
- `src/app/api/book-memory/route.ts`: BOOK.0 build/load API

## 현재 한계

- `NRG.0`은 아직 별도 저장 artifact가 아니라 `BOOK.0`에서 파생되는 view다.
- NRG support는 현재 `SUP.7`에서 보강된다. 장기적으로는 `SUP.6` policy selection 이전 후보 생성 단계로 올리는 편이 더 깔끔하다.
- `Knowledge Graph`는 아직 chapter/run projection이며, document-level traversal engine이 아니다.
- `FINAL.2`는 support policy와 분리되어 있고, overlay refinement에만 관여한다.
- evidence paragraph highlight는 아직 완성되지 않았다.
