# Pipeline Stage Granularity Review

## 결론

현재 stage 세분화는 연구/디버깅용 내부 구조로는 의미가 있다. 하지만 사용자가 직접 실행하고 선택하는 UI 단위로는 과하다.

따라서 다음 방향이 적절하다.

- 내부 micro stage는 당장 삭제하지 않는다.
- 기본 UI와 일반 실행 단위는 macro stage로 묶는다.
- micro stage는 advanced/debug inspector에서 펼쳐 본다.
- checkpoint 가치가 큰 stage만 독립 실행/저장 단위로 유지한다.
- checkpoint 가치가 낮은 stage는 하나의 macro artifact 안의 module/debug section으로 흡수한다.

## 현재 구성

현재 `PIPELINE_STAGES`는 다음 계열로 구성되어 있다.

- `PRE.1` ~ `PRE.2`
- `ENT.1` ~ `ENT.3`
- `STATE.1` ~ `STATE.3`
- `SCENE.1` ~ `SCENE.3`
- `VIS.1` ~ `VIS.4`
- `SUB.1` ~ `SUB.4`
- `SUP.0` ~ `SUP.7`
- `FINAL.1` ~ `FINAL.2`

전체 stage 수는 VIS 포함 29개다. 현재 기본 실행 UI에서는 VIS를 제외했지만, 그래도 25개 수준이다.

이 숫자는 연구자가 pipeline trace를 확인하기에는 유용하지만, 사용자가 매번 이해하고 조작하기에는 많다.

## 왜 stage가 많아졌는가

초기 구현에서 stage를 잘게 나눈 이유는 타당했다.

- LLM output이 불안정하므로 중간 산출물을 저장하고 확인할 필요가 있었다.
- extraction, validation, resolution을 분리하면 오류 원인을 추적하기 쉽다.
- 각 단계 산출물을 웹 inspector에서 확인하라는 요구가 있었다.
- 연구 기여 관점에서 raw summary가 아니라 어떤 정보를 어떻게 고도화했는지 설명해야 했다.
- cache/fork/run 저장 구조를 만들기 위해 stage별 artifact 계약이 필요했다.

따라서 현재 세분화는 실패가 아니라, 탐색과 검증을 위한 초기 구조로는 맞는 선택이었다.

문제는 이 구조가 그대로 product-facing pipeline UI가 되면 복잡도가 너무 커진다는 점이다.

## 평가 기준

어떤 처리가 독립 stage일 가치가 있으려면 아래 조건 중 2개 이상을 만족하는 것이 좋다.

- 독립적으로 재실행할 일이 많다.
- 실패 원인이 명확히 분리된다.
- downstream에서 직접 재사용된다.
- 평가/논문에서 중간 산출물로 설명할 가치가 있다.
- 실행 비용이 커서 cache/checkpoint가 필요하다.
- 사람이 수동 검수하거나 수정할 가능성이 높다.
- cross-chapter/document-level 단계에서 다시 사용된다.

반대로 아래에 가까우면 독립 stage보다 module이 낫다.

- 항상 직전 stage와 같이 실행된다.
- 출력이 downstream에서 독립적으로 재사용되지 않는다.
- 실패했을 때 사용자가 별도 조치를 하기 어렵다.
- artifact가 너무 작고, 같은 목적의 다른 stage와 강하게 결합되어 있다.
- UI에서 따로 보여줘도 의사결정 가치가 낮다.

## Stage별 판단

## PRE

`PRE.1`, `PRE.2`는 유지할 가치가 있다.

- `PRE.1`은 raw chapter 변환 checkpoint다.
- `PRE.2`는 content classification으로 이후 paragraph 단위 처리의 기본 근거가 된다.

다만 앞으로 `INGEST.1`이 추가되면 `PRE.1`의 일부 역할은 ingest로 이동한다.

권장 macro stage:

- `Ingest`
- `Text Prep`

## ENT

`ENT.1`, `ENT.2`, `ENT.3`는 유지할 가치가 높다.

- mention extraction, validation, entity resolution은 실패 원인이 다르다.
- `ENT.3`는 knowledge graph와 cross-chapter memory의 핵심 입력이다.
- entity alias/mention 품질은 reader support 품질에 직접 영향을 준다.

권장 macro stage:

- `Entity Graph`

기본 UI에서는 `Entity Graph` 하나로 보이고, debug mode에서 `ENT.1~ENT.3`을 펼친다.

## STATE

`STATE.1`, `STATE.2`, `STATE.3`도 현재는 유지하는 편이 낫다.

- state tracking과 validation은 다른 성격이다.
- boundary detection은 scene segmentation에 직접 영향을 준다.
- 상태 변화는 reader support의 boundary delta와 re-entry cue의 근거가 된다.

권장 macro stage:

- `Narrative State`

## SCENE

`SCENE.1`, `SCENE.2`, `SCENE.3`는 중요한 checkpoint다.

- `SCENE.1`은 scene packet을 만든다.
- `SCENE.2`는 scene index를 추출한다.
- `SCENE.3`은 validation된 scene model로 이후 branch의 기준점이 된다.

특히 `SCENE.3`은 SUB, SUP, VIS, FINAL의 공통 기반이므로 독립 저장 가치가 높다.

권장 macro stage:

- `Scene Model`

## SUB

`SUB.1`, `SUB.2`, `SUB.3`는 유지할 수 있다. 하지만 `SUB.4`는 재검토가 필요하다.

- `SUB.1~SUB.3`은 subscene 후보, state, validation으로 의미가 나뉜다.
- `SUB.3`은 SUP.0 입력으로 사용된다.
- `SUB.4`는 intervention packaging인데, 현재 `SUP` branch가 reader-support 역할을 대부분 가져가고 있다.

따라서 `SUB.4`는 장기적으로 optional/legacy stage가 될 가능성이 높다.

권장 macro stage:

- `Subscene Model`

## SUP

`SUP.0`은 강한 checkpoint다.

- scene/event/edge 기반 support memory를 만든다.
- knowledge graph projection의 입력이다.
- cross-chapter `BOOK.0` memory의 입력이다.

반면 `SUP.1~SUP.7`은 현재 독립 stage로 쪼개져 있지만, 장기적으로는 하나의 macro stage 안의 module로 묶는 것이 더 적절하다.

현재 역할:

- `SUP.1`: shared support context
- `SUP.2`: snapshot/boundary support units
- `SUP.3`: causal bridge support units
- `SUP.4`: character/relation support units
- `SUP.5`: re-entry/reference/spatial/visual support units
- `SUP.6`: support policy/ranking
- `SUP.7`: reader support package

이 중 `SUP.2~SUP.5`는 독립 실행 stage라기보다 support unit generator module에 가깝다. `SUP.6`과 `SUP.7`은 reader-facing selection/package 단계라 checkpoint로 볼 수 있지만, 사용자가 직접 매번 조작할 필요는 낮다.

권장 macro stage:

- `Memory Index`: `SUP.0`, `BOOK.0`, graph projection
- `Reader Support`: `SUP.1~SUP.7`

## VIS

VIS는 기본 reader-support pipeline에서는 optional branch로 두는 것이 맞다.

- 현재 사용자가 지적한 것처럼 항상 정답인 형태가 아니다.
- 이미지 생성/렌더링 비용과 실패 가능성이 크다.
- 모든 책/장면에 필요한 지원 형태가 아니다.

권장:

- 기본 pipeline graph와 Run All에서는 제외한다.
- 별도 `Visual Branch` 또는 `Experimental` 탭에서 실행한다.
- Reader support policy가 특정 장면에 visual support가 필요하다고 판단할 때만 실행하는 방향이 더 낫다.

## FINAL

`FINAL.1`은 강한 checkpoint다.

- reader 화면의 최종 package를 만든다.
- support 결과를 통합한다.

`FINAL.2`는 overlay refinement이며 optional 후처리로 볼 수 있다.

권장 macro stage:

- `Reader Package`

## 제안하는 Macro Pipeline

기본 UI는 다음 macro stage만 보여주는 것이 좋다.

1. `Ingest`
   - EPUB 구조 정규화, non-content 제거, chapter 재구성

2. `Text Prep`
   - `PRE.1`, `PRE.2`

3. `Entity Graph`
   - `ENT.1`, `ENT.2`, `ENT.3`

4. `Narrative State`
   - `STATE.1`, `STATE.2`, `STATE.3`

5. `Scene Model`
   - `SCENE.1`, `SCENE.2`, `SCENE.3`

6. `Subscene Model`
   - `SUB.1`, `SUB.2`, `SUB.3`

7. `Memory Index`
   - `SUP.0`, `BOOK.0`, knowledge graph projection

8. `Reader Support`
   - `SUP.1` ~ `SUP.7`

9. `Reader Package`
   - `FINAL.1`, optional `FINAL.2`

VIS는 기본 흐름 밖에 둔다.

```txt
Ingest
-> Text Prep
-> Entity Graph
-> Narrative State
-> Scene Model
-> Subscene Model
-> Memory Index
-> Reader Support
-> Reader Package
```

## UI 정책

## 기본 모드

기본 모드에서는 macro stage만 표시한다.

- 사용자는 `Run All`, `Run Remaining`, `Run from Here` 같은 macro action을 사용한다.
- 각 macro card는 완료 여부, 주요 통계, warning만 보여준다.
- 실패 시 해당 macro를 펼쳐 어떤 micro stage에서 실패했는지 보여준다.

## Advanced/Debug 모드

debug 모드에서는 현재처럼 micro stage를 보여준다.

- 각 micro stage artifact inspector 유지
- raw JSON 유지
- LLM trial debug 유지
- stage별 delete/re-run 유지

## 저장 정책

모든 micro stage를 동일한 무게로 저장할 필요는 없다.

저장 등급을 나눈다.

### Strong checkpoint

장기 저장과 cross-run reuse 가치가 높다.

- `INGEST.1`
- `PRE.1`
- `ENT.3`
- `STATE.3`
- `SCENE.3`
- `SUB.3`
- `SUP.0`
- `BOOK.0`
- `SUP.7`
- `FINAL.1`

### Debug checkpoint

개발/평가 중에는 저장하지만, 장기적으로는 TTL 또는 compact 대상이다.

- `PRE.2`
- `ENT.1`
- `ENT.2`
- `STATE.1`
- `STATE.2`
- `SCENE.1`
- `SCENE.2`
- `SUB.1`
- `SUB.2`
- `SUP.1`
- `SUP.2`
- `SUP.3`
- `SUP.4`
- `SUP.5`
- `SUP.6`

### Optional branch

기본 실행에서 제외한다.

- `VIS.1` ~ `VIS.4`
- `SUB.4`
- `FINAL.2`

## 실행 정책

기본 실행은 macro stage 단위가 좋다.

- `Run All`: macro pipeline을 순서대로 실행
- `Run Remaining`: 완료되지 않은 macro만 실행
- `Run Macro`: 해당 macro 내부 micro stage를 필요한 순서로 실행
- `Run Micro`: debug mode에서만 제공

중간 stage 재실행 시 fork/invalidation도 macro boundary 기준으로 단순화한다.

예를 들어 `Entity Graph`를 다시 실행하면 downstream macro인 `Narrative State` 이후를 invalidation한다. debug mode에서는 특정 micro stage 재실행도 허용하되, 사용자에게 영향 범위를 명확히 보여준다.

## 연구 관점에서 유지해야 하는 것

macro stage로 묶더라도 연구용 traceability는 잃으면 안 된다.

유지해야 할 것:

- artifact lineage
- parent stage refs
- LLM prompt/response debug
- evidence refs
- support unit이 어떤 memory edge/entity/scene에서 왔는지
- micro stage별 품질 평가 가능성

즉 UI에서는 단순화하되, 내부 데이터 모델은 설명 가능성을 유지해야 한다.

## 권장 다음 작업

1. `PipelineStageDef`에 `macroGroup`, `visibility`, `checkpointLevel` 필드를 추가한다.
2. Pipeline graph UI를 macro graph 기본 표시로 바꾼다.
3. macro card를 클릭하면 micro stage inspector가 펼쳐지게 한다.
4. `Run All`과 `Run Remaining`은 macro stage 기준으로 바꾼다.
5. `SUP.2~SUP.5`는 장기적으로 `Reader Support` macro 내부 module로 통합할지 평가한다.
6. VIS branch는 experimental/optional 탭으로 분리한다.
7. 저장 비용을 줄이기 위해 debug checkpoint compact/TTL 정책을 문서화한다.

## 최종 판단

현재 세분화는 초기 연구 구현으로는 의미가 있다. 하지만 다음 단계에서는 동일한 구조를 그대로 사용자-facing pipeline으로 유지하면 안 된다.

가장 좋은 방향은 다음이다.

- 내부는 micro stage 기반 traceable pipeline
- 외부 UI는 macro stage 기반 간단한 pipeline
- 핵심 checkpoint만 강하게 저장
- 나머지는 debug/temporary artifact로 취급

이 방향이면 연구 기여와 구현 안정성을 유지하면서, 실제 사용성과 운영 복잡도를 줄일 수 있다.

