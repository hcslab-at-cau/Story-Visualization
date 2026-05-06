# Narrative Relation Graph 제안

## 1. 위치 설정

현재 제안된 방향은 대체로 맞다.

다음 단계를

- 더 좋은 image prompt
- reader card 하나 더 추가
- 더 큰 final summary

로 보면 약하다.

더 강한 방향은 다음이다.

`validated extraction -> evidence-grounded narrative relation graph -> multiple reader-support artifacts`

이유는 단순하다.

Resume Card, Shift Bridge, Situation Snapshot, Timeline, Relation View, Spatial Map, Scene Image, Interaction Button은 모두 같은 기반 정보를 필요로 한다.

공통으로 묻는 질문:

- 누가 present한가?
- 어디서 언제 벌어지는가?
- 이전 scene과 비교해 무엇이 달라졌는가?
- 어떤 goal, conflict, question이 active한가?
- 어떤 earlier event나 thread가 현재 장면을 설명하는가?
- unread text를 spoil하지 않고 무엇을 보여줄 수 있는가?

즉 빠진 것은 support 하나가 아니라 안정된 narrative data layer다.

권장 이름:

- `Narrative Relation Graph`

더 정확한 이름:

- `Reader-position-aware Narrative Graph`

두 번째 이름이 더 정확한 이유는,
모든 node와 edge가 언제 safe to reveal인지 알아야 하기 때문이다.

## 2. 현재 문서와의 연결

기존 문서들도 이미 이 방향을 가리키고 있다.

- `../support/reader-support-design.md`는 support form 종류를 정리했다.
- `../support/roadmap.md`는 document-level memory가 필요하다고 말한다.
- `../support/memory-schema.md`는 memory collection을 제안한다.
- `../support/pipeline-plan.md`는 `SUP.*` branch를 제안한다.

이 문서는 그 방향을 더 날카롭게 만든다.

핵심:

- `support memory`는 scene summary 묶음이 되어서는 안 된다.
- evidence-linked state / thread / relation graph로 발전해야 한다.

그리고 이 graph는 `SUP.*` branch를 대체하는 것이 아니라 feeding layer가 되어야 한다.

## 3. 핵심 권장 사항

final UI artifact를 더 만들기 전에 graph-shaped intermediate representation을 먼저 만드는 편이 맞다.

고수준 흐름:

```text
TextUnit 저장소
  -> 원시 Mention / State / Boundary / Scene 산출물
  -> 정규 Entity + 범위 정규화
  -> Scene 상태 원장
  -> Narrative thread 원장
  -> Scene 관계 그래프
  -> Chapter 관계 그래프
  -> 독자용 산출물
     -> Resume Card
     -> Shift Bridge
     -> Situation Snapshot
     -> Timeline
     -> Relation Delta
     -> Spatial Map
     -> Scene Image
     -> Interaction Buttons
```

중요한 변화는 다음이다.

`scene output에서 바로 final support 생성`

이 아니라

`shared relation graph에서 final support 파생`

으로 바뀌어야 한다는 점이다.

## 4. 왜 graph가 필요한가

현재 파이프라인도 scene-local 정보는 잘 뽑는다.
하지만 reader support는 cross-scene, cross-chapter retrieval이 자주 필요하다.

예:

- Timeline은 event order와 temporal link가 필요하다.
- Relation View는 character-pair state change를 여러 scene에 걸쳐 봐야 한다.
- Shift Bridge는 previous vs current delta를 알아야 한다.
- Resume Card는 현재 reader position 직전의 중요한 unresolved change를 알아야 한다.
- Spatial Map은 place continuity와 movement edge가 필요하다.
- Cause-Effect Chip은 causal / enabling / blocking / resolving edge가 필요하다.
- Scene Image는 current place, cast, object, mood, action이 필요하지만 동시에 어떤 visual claim이 safe한지도 알아야 한다.

즉 이것들은 서로 다른 data 문제가 아니라,
같은 narrative graph의 다른 projection이다.

## 5. 권장 데이터 층

이야기는 여전히 계층 구조를 가진다.

```text
책
  -> 챕터
     -> 장면
        -> 비트 / 서브신
           -> 텍스트 단위
```

하지만 support를 위해서는 이 계층을 가로지르는 edge가 추가되어야 한다.

```text
Scene 3 -> causes -> Scene 7
Scene 4 -> place_shift -> Scene 5
Subscene 12 -> escalates -> Subscene 13
Character A + Character B -> relation_change -> Scene 9
```

그래서 필요한 것은 tree-only structure가 아니라 hybrid 구조다.

- hierarchy for containment
- graph for relation

## 6. graph에 들어가야 할 것

### node 유형

- `scene_state_node`
- `subscene_event_node`
- `thread_node`
- `relation_state_node`
- `place_state_node`

### edge 유형

- `causes`
- `enables`
- `blocks`
- `resolves`
- `place_shift`
- `time_shift`
- `cast_shift`
- `goal_shift`
- `thread_continuation`
- `relationship_delta`
- `foreshadows`
- `recalls`

### 모든 graph element가 가져야 할 것

- evidence reference
- confidence
- source run
- scope label
- reveal timing
- spoiler risk

## 7. scope와 reveal이 중요한 이유

이 graph는 generic KG가 아니라 reader-facing graph여야 한다.

그러려면 다음을 구분해야 한다.

- actual state
- memory
- imagination
- hypothetical
- dialogue claim
- unreliable narration

그리고 현재 reader position보다 뒤의 정보를 미리 드러내면 안 된다.

즉 graph는 단순한 relation 저장소가 아니라

- `is this claim valid?`
- `is this claim reveal-safe now?`

를 함께 다뤄야 한다.

## 8. 현재 구현과의 연결

현재 코드에서 가장 중요한 입력:

- `ENT.3`
- `STATE.2`
- `STATE.3`
- `SCENE.1`
- `SCENE.3`
- `SUB.2`
- `SUB.3`

보조 입력:

- `SUB.4`
- `VIS.1 / VIS.2`

권장 해석:

- `SCENE.3`은 scene-level grounded fact source
- `SUB.2 / SUB.3`은 local progression source
- `STATE.3`은 boundary / shift signal source
- `ENT.3`은 canonical identity source

즉 지금 구현은 graph 구축 전단계로 충분히 재활용할 수 있다.

## 9. 최종 권장 방향

이 문서의 결론은 간단하다.

`stage output을 바로 support로 쓰는 대신, evidence-linked narrative relation graph를 만들고 그 graph에서 support를 파생시킨다.`

이 방향이 지금 시스템을 더 강한 연구 기여로 끌어올릴 가능성이 가장 크다.
