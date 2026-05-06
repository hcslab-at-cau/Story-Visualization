# Pipeline: VIS Branch

이 문서는 현재 `Story-Visualization` 코드에서 VIS.1부터 VIS.4까지가 어떻게 구현되어 있는지 정리한다.

관련 파일:

- `src/lib/pipeline/vis1.ts`
- `src/lib/pipeline/vis2.ts`
- `src/lib/pipeline/vis3.ts`
- `src/lib/pipeline/vis4.ts`
- `src/app/api/pipeline/vis1/route.ts`
- `src/app/api/pipeline/vis2/route.ts`
- `src/app/api/pipeline/vis3/route.ts`
- `src/app/api/pipeline/vis4/route.ts`
- `src/components/PipelineRunner.tsx`

## 구현 상태 요약

| Stage | 역할 | 구현 상태 | 주요 출력 |
|---|---|---|---|
| VIS.1 | Semantic Clarification | 구현 완료 | `VisualGrounding` |
| VIS.2 | Stage Blueprint | 구현 완료 | `StageBlueprint` |
| VIS.3 | Render Package | 구현 완료 | `RenderPackage` |
| VIS.4 | Image Generation | 구현 완료 | `RenderedImages` |

VIS branch는 현재 API route, pipeline logic, Firestore 저장, PipelineRunner inspection view가 모두 연결되어 있다.

## Pipeline 연결

VIS 흐름:

```text
SCENE.3
  -> VIS.1
  -> VIS.2
  -> VIS.3
  -> VIS.4
  -> FINAL.1 / FINAL.2
```

의존성:

- `VIS.1`은 `SCENE.1`과 `SCENE.3` 결과를 사용한다.
- `VIS.2`는 `SCENE.1`, `SCENE.3`, 선택적 `VIS.1` 결과를 사용한다.
- `VIS.3`는 `VIS.2` 결과를 사용한다.
- `VIS.4`는 `VIS.3` 결과를 사용한다.
- `FINAL.1`과 `FINAL.2`는 `VIS.2`, `VIS.4` 결과를 참조할 수 있다.

## VIS.1 - Semantic Clarification

구현 함수:

- `runSemanticClarification`

입력:

- `ScenePackets` (`SCENE.1`)
- `GroundedSceneModel` (`SCENE.3`)
- LLM client

출력:

- `VisualGrounding`

주요 필드:

- `environment_type`
- `stage_archetype`
- `canonical_place_key`
- `ambiguity_resolutions`
- `grounded_scene_description`
- `visual_constraints`
- `avoid`

특징:

- scene별 visual grounding 정보를 만든다.
- LLM 응답에서 일부 필드가 빠져도 규칙 기반 fallback으로 보정한다.
- run id 형식은 `semantic_clarification__{docId}__{chapterId}`이다.

API 라우트:

- `POST /api/pipeline/vis1`

## VIS.2 - Stage Blueprint

구현 함수:

- `runStageBlueprintExtraction`

입력:

- `ScenePackets` (`SCENE.1`)
- `GroundedSceneModel` (`SCENE.3`)
- optional `VisualGrounding` (`VIS.1`)
- LLM client

출력:

- `StageBlueprint`

주요 필드:

- `geometry`
- `presentation`
- `zones`
- `characters`
- `boundaries`
- `repetition`
- `forbid`
- `avoid`
- `must_not_show`
- `blueprint_valid`
- `blueprint_warnings`

특징:

- scene을 image-generation friendly stage grammar로 정리한다.
- outdoor/indoor 문맥에 따라 presentation 값을 보정한다.
- blueprint validity와 warning을 함께 저장한다.
- run id 형식은 `image_support__{docId}__{chapterId}`이다.

API 라우트:

- `POST /api/pipeline/vis2`

## VIS.3 - Render Package

구현 함수:

- `buildRenderPackage`

입력:

- `StageBlueprint` (`VIS.2`)

출력:

- `RenderPackage`

주요 필드:

- `items[].full_prompt`
- `items[].common_style_block`
- `items[].scene_blueprint_block`
- `items[].presentation_block`
- `items[].hard_constraints_block`
- `items[].failure_patch_block`
- `schema_version`

특징:

- LLM 호출 없이 VIS.2 blueprint를 이미지 생성용 prompt package로 컴파일한다.
- 텍스트 렌더링, UI panel, 말풍선, label 등 금지 조건을 hard constraint로 명시한다.
- run id 형식은 `render_package__{docId}__{chapterId}`이다.

API 라우트:

- `POST /api/pipeline/vis3`

## VIS.4 - Image Generation

구현 함수:

- `runImageGeneration`

입력:

- `RenderPackage` (`VIS.3`)
- OpenRouter API key (`OPENROUTER_API_KEY`)
- optional model override

출력:

- `RenderedImages`

주요 필드:

- `results[].scene_id`
- `results[].image_path`
- `results[].prompt_used`
- `results[].model`
- `results[].success`
- `results[].storage_path`
- `results[].gs_uri`
- `results[].download_url`
- `results[].error`

특징:

- OpenRouter chat completions image modality를 사용한다.
- 기본 image model은 `google/gemini-3.1-flash-image-preview`이다.
- 기본 aspect ratio는 `3:2`, 기본 size는 `1K`이다.
- 생성된 이미지는 Firebase Storage에 업로드하고 download URL을 artifact에 저장한다.
- 실패한 scene은 `success=false`와 `error`를 기록한다.
- run id 형식은 `image_gen__{docId}__{chapterId}`이다.

API 라우트:

- `POST /api/pipeline/vis4`

## UI 연결

`PipelineRunner`는 VIS stage별 전용 view를 제공한다.

- `VIS.1`: semantic clarification packet 확인
- `VIS.2`: stage blueprint, constraints, warnings 확인
- `VIS.3`: render prompt package 확인
- `VIS.4`: generated image 결과, storage path, download URL, prompt 확인

각 stage는 summary chip과 raw JSON fallback도 함께 제공한다.

## FINAL 연결

- `FINAL.1`은 `VIS.2` blueprint와 `VIS.4` image 결과를 사용해 reader package의 visual block을 구성할 수 있다.
- `FINAL.2`는 generated image path를 기반으로 character overlay 위치를 보정할 수 있다.
- `ReaderScreen`은 `FINAL.1`의 visual image path와 `FINAL.2`의 refined overlay를 병합해 최종 reader 화면을 렌더링한다.

## 남은 개선 과제

현재 VIS branch는 구현되어 있지만, 다음 품질 개선 항목은 별도 작업으로 남아 있다.

- visual usefulness scoring
- recurring place continuity 제어
- schematic fallback mode
- 이미지가 독해 support를 대체하지 않도록 하는 support policy
- 생성 실패 scene에 대한 더 명시적인 retry/repair workflow
