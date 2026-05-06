# Knowledge Graph Query Layer

## 현재 결정

전용 graph database를 바로 도입하지 않고, Firestore 안에 query 가능한 graph projection layer를 둔다.

기존 `SUP.0`과 `ENT.3`는 여전히 stage artifact로 보존한다. 추가로 이 artifact를 작은 node/edge 문서로 투영해서 UI와 API가 graph query처럼 사용할 수 있게 한다.

이 방식은 Neo4j 같은 graph DB보다 기능은 제한적이지만, 현재 pipeline 구조와 Firebase 저장소를 유지하면서 빠르게 검증할 수 있다.

## 저장 위치

새 graph projection은 `documents_v2` 아래에 저장한다.

```txt
documents_v2/{docId}/graph_nodes/{nodeId}
documents_v2/{docId}/graph_edges/{edgeId}
```

각 node/edge에는 다음 scope가 들어간다.

```ts
{
  docId,
  chapterId,
  runId,
  sourceStageId,
  sourceArtifactId
}
```

따라서 같은 문서라도 chapter/run 별로 graph를 분리해서 조회할 수 있다.

## Projection 대상

현재 projection 대상은 두 단계다.

| Stage | Projection 역할 |
| --- | --- |
| `ENT.3` | entity node, mention node, entity-to-mention edge |
| `SUP.0` | scene node, event node, character/place node, scene/event edge |

`SUP.0`에서 만드는 주요 edge type은 다음과 같다.

- `scene_sequence`
- `contains_event`
- `active_cast`
- `actor`
- `located_at`
- `same_character_thread`
- `same_place_thread`
- `place_shift`
- `cast_change`
- `causal_bridge`
- `relation_change`

## 저장 타이밍

`saveStageResult`가 stage artifact를 저장한 뒤, 해당 artifact가 `ENT.3` 또는 `SUP.0`이면 graph projection을 자동으로 갱신한다.

중간 stage를 다시 실행해서 새 run이 fork되는 경우에도 보존된 `ENT.3`/`SUP.0` artifact를 새 run scope로 다시 projection한다. artifact payload 자체는 복사하지 않고, graph projection만 run query를 위해 재생성한다.

## API

### 조회

```txt
GET /api/knowledge-graph?docId=...&chapterId=...&runId=...
```

선택 query:

```txt
q=alice
kind=scene|event|character|place|entity|mention
nodeId=kg_node_xxx
depth=0|1|2|3
```

`nodeId`가 있으면 해당 node 주변 hop을 반환한다. `nodeId`가 없으면 `q`와 `kind`로 node를 필터링한다.

### 재생성

```txt
POST /api/knowledge-graph
```

body:

```json
{
  "docId": "...",
  "chapterId": "...",
  "runId": "..."
}
```

이미 저장된 `ENT.3`/`SUP.0` artifact를 다시 읽어서 graph projection을 재생성한다. 과거에 stage는 실행했지만 graph projection이 없는 run을 복구할 때 사용한다.

## UI

상단 navigation에 `graph` 탭을 추가했다.

이 화면에서 할 수 있는 일:

- 현재 chapter/run의 graph projection 조회
- node kind별 필터링
- label/tag 기반 검색
- node 선택 후 0-3 hop 주변 edge 조회
- projection 수동 rebuild

## 현재 한계

이 구현은 “GraphDB 도입 전 단계”다.

가능한 것:

- run/chapter 범위의 node/edge 조회
- 특정 node 주변 1-3 hop 탐색
- scene/event/character/place/entity 단위 필터
- causal bridge, cast change 등 edge 확인

아직 어려운 것:

- document 전체 chapter를 가로지르는 global traversal
- shortest path, centrality, community detection 같은 graph algorithm
- entity alias merge를 활용한 고정밀 relation graph
- reader support prompt에 graph query 결과를 자동 retrieval해서 주입

## 다음 단계

다음 고도화는 세 방향이다.

1. Document-level graph index
   - chapter를 넘어서는 entity, event, place index를 만든다.

2. Retrieval API
   - `sceneId`, `entityId`, `supportUnitKind`를 넣으면 필요한 graph context만 반환한다.

3. Support prompt integration
   - `SUP.2`-`SUP.7`이 전체 artifact를 직접 읽기보다 graph query 결과를 근거로 사용하도록 바꾼다.
