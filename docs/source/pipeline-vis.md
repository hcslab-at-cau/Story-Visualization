# Pipeline: VIS Branch

`Story-Visualization` 현재 기준에서 VIS 브랜치는 아직 운영 단계가 아니다.  
UI와 stage registry에는 자리만 잡혀 있고, 실제 포트는 `VIS.1`~`VIS.4` 모두 미구현 상태다.

---

## 현재 상태

| Stage | 원본 역할 | 현재 상태 | 비고 |
|---|---|---|---|
| VIS.1 | semantic clarification | 미구현 | `PIPELINE_STAGES`에는 등록됨 |
| VIS.2 | stage blueprint extraction | 미구현 | schema만 존재 |
| VIS.3 | render package compilation | 미구현 | API route 없음 |
| VIS.4 | image generation | 미구현 | API route 없음 |

현재 프로젝트에서 VIS 관련 실제 UI 표시는 다음 정도만 남아 있다.

- `src/types/ui.ts`에서 VIS stage가 `implemented: false`로 표시된다.
- `PipelineRunner`는 VIS stage를 사이드바에 보여주지만 `Pending` badge와 안내 문구만 출력한다.
- `ReaderScreen`의 visual block은 현재 VIS 산출물이 아니라 `FINAL.1`이 만든 placeholder / overlay 데이터를 사용한다.

즉 이 문서는 "현재 구현 설명"보다는 "원본 Story-Decomposition 기준 VIS 브랜치가 무엇을 해야 하는지"를 남기는 참조 문서다.

## 단계별 이전 결과

| Stage | 필요 입력 | 이전 단계 기준 |
|---|---|---|
| VIS.1 | `GroundedSceneModel`, `ScenePackets` | SCENE.3, SCENE.1 필요 |
| VIS.2 | `GroundedSceneModel`, `ScenePackets`, optional `VisualGrounding` | SCENE.3, SCENE.1 필요, VIS.1 있으면 함께 사용 |
| VIS.3 | `StageBlueprint` | VIS.2 필요 |
| VIS.4 | `RenderPackage` 또는 `StageBlueprint` | 기본적으로 VIS.3 필요, repair/fallback용으로 VIS.2도 사용 |

---

## 참조 흐름

원본 설계에서 VIS 브랜치는 `SCENE.3` 이후 이렇게 분기된다.

```text
SCENE.3
  -> VIS.1 Semantic Clarification
  -> VIS.2 Stage Blueprint
  -> VIS.3 Render Package
  -> VIS.4 Image Generation
```

핵심 목적은 scene text를 그대로 그리는 것이 아니라,  
scene-level grounding 결과를 render-safe visual spec으로 바꾸고 이미지 생성까지 연결하는 것이다.

---

## VIS.1 - Semantic Clarification

### 원본 역할

- scene text 안의 모호한 표현을 시각적으로 안전한 의미로 정규화
- `environment_type`, `stage_archetype`, `canonical_place_key` 추출
- ambiguity resolution 목록과 `grounded_scene_description` 생성

### 원본 입력

- `GroundedSceneModel` from `SCENE.3`
- `ScenePackets` from `SCENE.1`

### 원본 출력

`VisualGrounding`

핵심 필드:

- `packets[].scene_id`
- `packets[].environment_type`
- `packets[].stage_archetype`
- `packets[].canonical_place_key`
- `packets[].ambiguity_resolutions`
- `packets[].grounded_scene_description`
- `packets[].visual_constraints`
- `packets[].avoid`

### 원본 run_id

```python
f"semantic_clarification__{doc_id}__{chapter_id}"
```

---

## VIS.2 - Stage Blueprint

### 원본 역할

scene을 image-generation 친화적인 Stage Grammar로 바꾼다.

- geometry
- zones
- presentation
- characters
- boundaries / repetition
- forbid / avoid / must_not_show

### 원본 입력

- `GroundedSceneModel`
- `ScenePackets`
- optional `VisualGrounding`

### 원본 후처리

- onstage에 없는 character 제거
- 현재 장면의 장소가 아닌 mentioned place를 `must_not_show`로 이동
- warning-only `L-check` 수행

### 원본 출력

`StageBlueprint`

핵심 필드:

- `packets[].geometry`
- `packets[].presentation`
- `packets[].zones`
- `packets[].forbid`
- `packets[].avoid`
- `packets[].must_not_show`
- `packets[].blueprint_valid`
- `packets[].blueprint_warnings`

### 원본 run_id

```python
f"image_support__{doc_id}__{chapter_id}"
```

---

## VIS.3 - Render Package

### 원본 역할

`StageBlueprint`를 실제 이미지 생성 프롬프트 블록으로 컴파일한다.

프롬프트 구성 블록:

- `common_style_block`
- `scene_blueprint_block`
- `presentation_block`
- `hard_constraints_block`
- `failure_patch_block`

### 원본 출력

`RenderPackage`

추가로 기록되는 필드:

- `items[].full_prompt`
- `items[].prompt_schema_version`
- `items[].failure_history`

### 원본 run_id

```python
f"render_package__{doc_id}__{chapter_id}"
```

---

## VIS.4 - Image Generation

### 원본 역할

`RenderPackage` 또는 `StageBlueprint`를 기반으로 이미지를 생성한다.  
실패 시 failure taxonomy를 기준으로 repair loop를 돈다.

### 원본 failure 유형

- `output_format`
- `content_policy`
- `api_error`
- `unknown`

### 원본 출력

`RenderedImages`

핵심 필드:

- `results[].scene_id`
- `results[].image_path`
- `results[].prompt_used`
- `results[].model`
- `results[].success`
- `results[].error`

### 원본 run_id

```python
f"image_gen__{doc_id}__{chapter_id}"
```

---

## 포팅 메모

현재 저장소에는 VIS 브랜치 포팅을 위한 타입과 UI 슬롯은 이미 일부 준비돼 있다.

- schema 타입: `src/types/schema.ts`
- stage registry: `src/types/ui.ts`
- model config: `src/config/pipeline-models`

하지만 아직 없는 것:

- `src/lib/pipeline/vis1.ts` ~ `vis4.ts`
- `/api/pipeline/vis1` ~ `/vis4`
- VIS stage 전용 결과 확인 UI
- FINAL 단계와 연결되는 실제 image artifact 흐름

그래서 현재 문맥에서 VIS 문서는 "구현 문서"가 아니라 "추후 포팅 기준 문서"로 읽는 것이 맞다.
