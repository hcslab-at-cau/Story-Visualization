# Pipeline: VIS Branch (현재 구현 기준)

이 문서는 `Story-Visualization`의 VIS.1 ~ VIS.4가 현재 코드에서 어떻게 동작하는지 정리합니다.

## 구현 상태 요약

| Stage | 파일 | 상태 | 설명 |
|---|---|---|---|
| VIS.1 | `src/lib/pipeline/vis1.ts` | 구현됨 | scene 의미 명확화(semantic clarification) |
| VIS.2 | `src/lib/pipeline/vis2.ts` | 구현됨 | stage blueprint 추출 + 규칙 보정 |
| VIS.3 | `src/lib/pipeline/vis3.ts` | 구현됨 | 이미지 생성용 render prompt 패키지 컴파일 |
| VIS.4 | `src/lib/pipeline/vis4.ts` | 구현됨 | 이미지 생성 + Firebase Storage 업로드 |

API route도 모두 존재합니다.

- `/api/pipeline/vis1`
- `/api/pipeline/vis2`
- `/api/pipeline/vis3`
- `/api/pipeline/vis4`

---

## VIS.1 - Semantic Clarification

입력(핵심):

- `ScenePackets` (`SCENE.1`)
- `GroundedSceneModel` (`SCENE.3`)
- LLM client

출력:

- `VisualGrounding`
  - `environment_type`
  - `stage_archetype`
  - `canonical_place_key`
  - `ambiguity_resolutions`
  - `grounded_scene_description`
  - `visual_constraints`
  - `avoid`

특징:

- LLM 응답 누락 필드가 있어도 규칙 기반 fallback으로 보정합니다.
- run id 형식: `semantic_clarification__{docId}__{chapterId}`

---

## VIS.2 - Stage Blueprint

입력(핵심):

- `ScenePackets` (`SCENE.1`)
- `GroundedSceneModel` (`SCENE.3`)
- optional `VisualGrounding` (`VIS.1`)
- LLM client

출력:

- `StageBlueprint`
  - geometry/presentation/zones/characters
  - boundaries/repetition
  - forbid/avoid/must_not_show
  - warnings/uncertainties

특징:

- outdoor/indoor 문맥에 따라 presentation 값을 강제 보정합니다.
- stage blueprint 유효성(`blueprint_valid`)과 warning을 함께 기록합니다.
- run id 형식: `image_support__{docId}__{chapterId}`

---

## VIS.3 - Render Package

입력:

- `StageBlueprint` (`VIS.2`)

출력:

- `RenderPackage`
  - scene별 `full_prompt`
  - prompt block(`common_style_block`, `presentation_block`, `hard_constraints_block`, `failure_patch_block`)
  - schema version

특징:

- 프롬프트는 규칙 기반 컴파일 방식이며, 금지 조건(텍스트 렌더링/패널화 등)을 강하게 명시합니다.
- run id 형식: `render_package__{docId}__{chapterId}`

---

## VIS.4 - Image Generation

입력:

- `RenderPackage` (`VIS.3`)
- OpenRouter API Key (`OPENROUTER_API_KEY`)

출력:

- `RenderedImages`
  - scene별 성공/실패 결과
  - 저장 경로(storage path, gs uri, download url)
  - 실제 사용 프롬프트/모델

특징:

- OpenRouter chat completions(image modality)로 생성합니다.
- 기본 모델: `google/gemini-3.1-flash-image-preview`
- 생성 이미지를 Firebase Storage에 업로드하고 URL을 artifact에 저장합니다.
- run id 형식: `image_gen__{docId}__{chapterId}`

---

## 파이프라인 연결

VIS 흐름은 현재 아래 순서로 동작합니다.

```text
SCENE.3
  -> VIS.1
  -> VIS.2
  -> VIS.3
  -> VIS.4
  -> FINAL.1 / FINAL.2
```

`FINAL.1`은 VIS.2(blueprint) 및 VIS.4(image) 결과를 활용할 수 있고,
`ReaderScreen`은 FINAL.1 + FINAL.2를 기반으로 최종 검증 화면을 제공합니다.
