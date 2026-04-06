# Pipeline: FINAL.1, FINAL.2, FINAL.3

이 문서는 `Story-Visualization` 현재 구현 기준으로 FINAL 단계가 어떻게 동작하는지 정리한다.  
원본 `Story-Decomposition` 설계를 그대로 옮긴 부분과, 아직 축약되거나 미구현인 부분을 분리해서 적는다.

---

## 현재 구현 상태

| Stage | 현재 위치 | 상태 | 비고 |
|---|---|---|---|
| FINAL.1 | `src/lib/pipeline/final1.ts` | 구현됨 | 현재 포트는 `blueprint` 중심 조합 단계 |
| FINAL.2 | `src/lib/pipeline/final2.ts` | 구현됨 | Vision 호출이 없으면 fallback-only 동작 |
| FINAL.3 | `src/components/ReaderScreen.tsx` | 구현됨 | 별도 artifact 없이 UI 렌더러로만 존재 |

현재 `Story-Visualization`의 FINAL 단계는 원본 Python FINAL 문서를 1:1 복제한 상태는 아니다.

- FINAL.1은 현재 `RenderedImages`, `VisualGrounding`, `SubsceneStates`, `RenderPackage`를 직접 받지 않는다.
- FINAL.1 visual block은 현재 항상 `mode: "blueprint"`로 구성된다.
- FINAL.1 chips는 현재 `VIS.1`이 아니라 `SCENE.3 environment + actual_place`만 사용한다.
- FINAL.3은 refined anchor를 직접 scene 위 absolute overlay로 쓰지만, debug badge나 bbox 표시는 하지 않는다.

## 단계별 이전 결과

| Stage | 현재 구현 기준 필요 입력 | 원본 설계 기준 참고 |
|---|---|---|
| FINAL.1 | `GroundedSceneModel`, `ValidatedSubscenes`, `ScenePackets`, `SceneBoundaries`, `RawChapter`, optional `StageBlueprint`, optional `InterventionPackages` | 원본은 여기에 `RenderedImages`, `VisualGrounding`, `SubsceneStates`, `RenderPackage`까지 optional로 사용 |
| FINAL.2 | `SceneReaderPackageLog`, optional image path map, optional blueprint summary | 원본은 `SceneReaderPackageLog`, optional `RenderedImages`, optional `StageBlueprint` |
| FINAL.3 | `SceneReaderPackageLog`, optional `OverlayRefinementResult` | 동일 |

---

## FINAL.1 - Scene Reader Package Builder

### 현재 구현 파일

`src/lib/pipeline/final1.ts`

### 역할

`SCENE.3`, `SUB.3`, `SCENE.1`, `STATE.3`, `RawChapter`를 조합해서 scene 단위의 `SceneReaderPacket`을 만든다.  
현재 포트에서는 "이미지 결과를 합치는 단계"라기보다 "reader UI용 scene packet을 조립하는 단계"에 가깝다.

### 현재 시그니처

```ts
export function runSceneReaderPackage(
  groundedLog: GroundedSceneModel,
  sub3Log: ValidatedSubscenes,
  packetLog: ScenePackets,
  boundaryLog: SceneBoundaries,
  chapter: RawChapter,
  docId: string,
  chapterId: string,
  parents: Record<string, string> = {},
  blueprintLog?: BlueprintLike,
  interventionLog?: InterventionPackages,
): SceneReaderPackageLog
```

### 처리 흐름

1. `boundaryLog.scenes`에서 `scene_id -> [start_pid, end_pid]` 범위를 만든다.
2. `chapter.paragraphs`에서 `pid -> text` 맵을 만든다.
3. `groundedLog.validated` 순서로 scene을 순회한다.
4. visual block을 구성한다.
5. subscene navigation / panel 데이터를 구성한다.
6. scene body paragraph를 pid 범위 기준으로 슬라이스한다.
7. `SceneReaderPacket[]`을 묶어 `SceneReaderPackageLog`를 반환한다.

### visual block 구성

현재 구현은 다음 규칙을 사용한다.

- `mode`는 현재 항상 `"blueprint"`이다.
- `fallback_blueprint_available`은 `blueprintLog !== undefined` 여부로만 결정된다.
- `image_path`는 현재 채우지 않는다.
- `chips`는 `SCENE.3.environment[*].label`과 `scene_place.actual_place`에서 최대 4개까지 만든다.
- `overlay_characters`는 `VIS.2 characters -> SCENE.3 onstage_cast -> SCENE.1 scene_cast_union` 우선순위로 만든다.

### `_build_overlay_characters`

anchor는 9-zone bucket을 사용한다.

```ts
const ZONE_ANCHOR: Record<string, [number, number]> = {
  "foreground left":   [15.0, 78.0],
  "foreground center": [50.0, 78.0],
  "foreground right":  [85.0, 78.0],
  "midground left":    [15.0, 52.0],
  "midground center":  [50.0, 52.0],
  "midground right":   [85.0, 52.0],
  "background left":   [15.0, 26.0],
  "background center": [50.0, 26.0],
  "background right":  [85.0, 26.0],
}
```

### `_build_subscene_blocks`

- `SUB.3 validated_subscenes`만 사용한다.
- nav item은 `subscene_id`, `label`, `headline`, `body_paragraphs`로 구성한다.
- 버튼은 값이 있는 필드만 만든다.
- 기본 버튼 매핑은 `goal`, `problem`, `what_changed`, `why_it_matters`다.
- `key_objects`가 있으면 `object` 버튼을 추가한다.

### `_build_character_panels`

우선순위는 다음과 같다.

1. `SUB.4 cast_buttons.reveal`
2. `SUB.3` fallback 요약

최종 구조는 다음과 같다.

```ts
Record<panel_key, Record<subscene_id, string>>
```

즉 캐릭터 팝오버 텍스트는 scene 전체 공용이 아니라 subscene별로 달라진다.

### 출력 핵심

```ts
interface SceneReaderPacket {
  scene_id: string
  scene_title: string
  scene_summary: string
  body_paragraphs: string[]
  visual: VisualBlock
  subscene_nav: SubsceneNavItem[]
  subscene_views: Record<string, SubsceneView>
  character_panels: Record<string, Record<string, string>>
  default_active_subscene_id: string
}
```

### run_id

```ts
const runId = `scene_reader_package__${docId}__${chapterId}`
```

### 원본 설계와 다른 점

- 원본 Python FINAL.1은 `RenderedImages`, `VisualGrounding`, `SubsceneStates`, `RenderPackage`까지 optional로 받는다.
- 현재 TS 포트는 그 범위까지 아직 확장되지 않았다.
- 그래서 현재 문서상 FINAL.1은 "원본 full join 단계"가 아니라 "reader packet 최소 조합 단계"로 보는 것이 맞다.

---

## FINAL.2 - Overlay Refinement

### 현재 구현 파일

`src/lib/pipeline/final2.ts`

### 역할

FINAL.1의 coarse overlay anchor를 Vision 입력으로 보정한다.  
Vision 호출이 불가능하거나 이미지가 없으면 coarse anchor를 그대로 유지하는 fallback artifact를 반환한다.

### 현재 시그니처

```ts
export async function runOverlayRefinement(
  sceneReaderLog: SceneReaderPackageLog,
  docId: string,
  chapterId: string,
  parents: Record<string, string> = {},
  llmClient?: LLMClient,
  blueprintLog?: { packets: Array<{ scene_id: string; key_moment?: string; setting?: unknown }> },
  imagePaths?: Map<string, string>,
  onProgress?: (msg: string) => void,
): Promise<OverlayRefinementResult>
```

### 처리 흐름

1. `llmClient`가 있으면 `vision+fallback`, 없으면 `fallback_only` 모드가 된다.
2. scene별로 `imagePaths.get(scene_id)`에서 이미지 경로를 찾는다.
3. 이미지가 있고 overlay candidate가 있으면 Vision prompt를 만든다.
4. raw Vision 응답을 `normalizeResult()`로 정규화한다.
5. accepted되지 않은 결과는 coarse anchor로 fallback한다.

### accepted 조건

다음 조건을 모두 만족해야 refined anchor를 채택한다.

```ts
const accepted =
  anchorX !== undefined &&
  anchorY !== undefined &&
  confidence >= 0.45 &&
  source !== "coarse_fallback"
```

### fallback 규칙

```ts
const fallbackVis =
  confidence >= 0.2 && imageAvailable ? "approximate" : "fallback"
```

즉 low-confidence 결과도 `approximate` 상태로 남길 수 있지만, anchor 자체는 coarse 값을 유지한다.

### `visibility` / `source`

스키마상 허용값은 다음과 같다.

- `visibility`: `placed | approximate | fallback | not_visible`
- `source`: `text_image_guided | blueprint_guided | coarse_fallback`

다만 현재 `runOverlayRefinement()` 정규화 함수는 실제로 `not_visible`을 만들지 않는다.  
`not_visible`은 UI merge 규칙 호환을 위해 스키마에 남아 있는 값이다.

### 출력 핵심

```ts
interface OverlayRefinementCharacter {
  character_id: string
  label: string
  visibility: OverlayVisibility
  bbox_norm?: BBoxNorm
  anchor_x: number
  anchor_y: number
  confidence: number
  source: OverlaySource
  reason: string
}
```

### run_id

```ts
const runId = `overlay_refinement__${docId}__${chapterId}`
```

---

## FINAL.3 - Reader Screen

### 현재 구현 파일

`src/components/ReaderScreen.tsx`

### 역할

`SceneReaderPackageLog`와 optional `OverlayRefinementResult`를 합쳐 최종 독자 화면을 렌더링한다.  
별도 파이프라인 artifact를 만들지 않는 UI 단계다.

### merge 규칙

`buildMergedOverlay()`는 다음 규칙을 쓴다.

```ts
if (refined?.visibility === "not_visible" && refined.confidence >= 0.5) {
  continue
}
result.push({ coarse: char, refined })
```

즉 현재 UI는:

- `FINAL.2`가 `not_visible`을 높은 confidence로 반환한 경우에만 버튼을 제거한다.
- 그 외에는 coarse 캐릭터를 남긴다.
- 버튼 좌표는 `refined?.anchor_x ?? coarse.anchor_x`, `refined?.anchor_y ?? coarse.anchor_y`를 쓴다.

### 레이아웃

- 상단: scene selector
- 다음: `scene_title`, `scene_summary`
- 좌측: subscene 네비게이션, 본문 paragraph, prev/next
- 우측: chips, image/placeholder, character buttons, subscene panels

### 캐릭터 popover

- 버튼 위치는 scene image 위 absolute position이다.
- 팝오버 내용은 `packet.character_panels[panel_key][activeSubsceneId]`를 사용한다.
- 현재 subscene에 텍스트가 없으면 fallback 문구를 보여 준다.

### 현재 제한

- bbox debug 정보는 화면에 노출하지 않는다.
- overlay collision, safe margin, automatic decluttering은 아직 없다.
- FINAL.2가 실제 `not_visible`을 거의 만들지 않기 때문에, 현재 UI에서는 대부분 coarse/refined 버튼이 그대로 유지된다.
