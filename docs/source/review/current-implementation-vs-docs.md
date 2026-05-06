# 현재 구현과 문서의 관계

## 1. 목적

이 문서는 현재 논의에서 자주 섞이는 세 가지를 분리하기 위한 문서다.

1. 지금 실제로 구현된 것
2. 현재 문서가 정확하게 설명하는 것
3. 다음 아키텍처로 제안만 되어 있는 것

핵심 결론:

`PRE / ENT / STATE / SCENE / SUB / VIS / FINAL`은 staged LLM + rule pipeline으로 구현되어 있지만,
`SUP`, Narrative Relation Graph, evidence/reveal indexing, narrative scope, graph-derived reader support는 아직 구현되지 않았다.

## 2. 현재 구현된 시스템

현재 앱 view:

- Upload view
- Pipeline view
- Reader view

현재 핵심 파일:

- `src/app/page.tsx`
- `src/components/PipelineRunner.tsx`
- `src/components/ReaderScreen.tsx`
- `src/types/ui.ts`
- `src/types/schema.ts`
- `src/lib/pipeline/*.ts`
- `src/app/api/pipeline/*/route.ts`

현재 `src/types/ui.ts`에 등록된 stage family:

- `PRE.1`, `PRE.2`
- `ENT.1`, `ENT.2`, `ENT.3`
- `STATE.1`, `STATE.2`, `STATE.3`
- `SCENE.1`, `SCENE.2`, `SCENE.3`
- `VIS.1`, `VIS.2`, `VIS.3`, `VIS.4`
- `SUB.1`, `SUB.2`, `SUB.3`, `SUB.4`
- `FINAL.1`, `FINAL.2`

## 3. 현재 stage를 어떻게 읽어야 하는가

### 3.1 PRE / ENT

구현된 것:

- `PRE.1` raw chapter structure 준비
- `PRE.2` content unit classification
- `ENT.1` mention candidate extraction
- `ENT.2` mention validation
- `ENT.3` canonical entity 및 unresolved mention 정리

graph 관점 relevance:

- `ENT.3`은 primary graph input 후보
- `ENT.1`, `ENT.2`는 debugging / correction analysis에 더 가까움
- `PRE.1`, `PRE.2`는 graph semantic보다는 evidence + reveal index 쪽과 더 직접 연결됨

### 3.2 STATE

구현된 것:

- `STATE.1` rule-based state frame 생성
- `STATE.2` LLM refine / validation
- `STATE.3` boundary detection + scene title

graph 관점 relevance:

- `STATE.2`는 frame-level evidence source로 유용
- `STATE.3`은 scene span과 boundary reason source로 유용
- 하지만 scene-level graph state source는 결국 `SCENE.1`, `SCENE.3`가 중심이 되는 편이 낫다

### 3.3 SCENE

구현된 것:

- `SCENE.1` scene packet 생성
- `SCENE.2` scene index 추출
- `SCENE.3` grounded scene validation

graph 관점 relevance:

- `SCENE.1`은 scene span / packet source
- `SCENE.3`은 grounded scene fact source
- `SCENE.2`는 draft라서 canonical graph input보다는 검증 전 중간층

### 3.4 SUB

구현된 것:

- `SUB.1` subscene proposal
- `SUB.2` subscene-local state extraction
- `SUB.3` subscene validation
- `SUB.4` local reader-facing intervention packaging

graph 관점 relevance:

- `SUB.2`, `SUB.3`은 graph input으로 유용
- `SUB.4`는 이미 reader-facing packaging이라 canonical graph input으로 보기보다 legacy/local support layer로 보는 편이 맞다

### 3.5 VIS

구현된 것:

- `VIS.1` semantic clarification
- `VIS.2` stage blueprint
- `VIS.3` render package
- `VIS.4` image generation / storage

현재 문서 상태:

- `pipeline/visual-current.md`가 구현 상태를 설명

target architecture 관점:

- VIS는 앞으로 standalone conceptual branch라기보다
  `Visual Support Spec -> Media Renderer`
  쪽으로 재배치되는 편이 자연스럽다.

### 3.6 FINAL

구현된 것:

- `FINAL.1` scene reader packet 조립
- `FINAL.2` overlay refinement
- `ReaderScreen`이 사실상 FINAL.3 역할

해석:

- 현재 FINAL은 support branch라기보다 reader packaging layer에 더 가깝다.

## 4. 어떤 문서가 어떤 성격인가

### 구현 설명 문서

- `current/ui.md`
- `pipeline/pre-ent.md`
- `pipeline/state.md`
- `pipeline/scene.md`
- `pipeline/sub.md`
- `pipeline/visual-current.md`
- `pipeline/final.md`

이 문서들은 현재 코드와 최대한 맞춰 읽어야 한다.

### 제안 / 설계 문서

- `support/*`
- `research/*`

이 문서들은 현재 구현 설명이 아니라 다음 architecture와 research contribution 방향을 다룬다.

### 정합성 점검 문서

- `review/*`

이 문서들은 현재 코드와 문서 사이의 차이를 추적하는 용도다.

## 5. 지금 문서들을 읽을 때 주의할 점

현재 구현 문서에서 "구현 완료"라고 적혀 있어도,
그것이 곧 연구 목표가 완성되었다는 뜻은 아니다.

반대로 설계 문서에서 말하는

- `SUP.*`
- document-level support memory
- Narrative Relation Graph
- graph-derived support

는 아직 proposal이며, 구현 상태로 읽으면 안 된다.

즉 지금 문서 집합은 다음 세 층을 함께 가진다.

- implemented pipeline
- planned support architecture
- proposed research framing

## 6. 최종 정리

현재 구현은 이미 꽤 강한 fiction-analysis pipeline이다.
하지만 다음 단계의 핵심은 여기에 support branch와 graph layer를 얹는 것이다.

따라서 문서도 다음처럼 구분해서 읽는 편이 가장 정확하다.

- "지금 코드가 무엇을 하나" -> `current/`, `pipeline/`
- "다음 support architecture는 무엇인가" -> `support/`
- "연구 주장으로는 어떻게 세울 것인가" -> `research/`
