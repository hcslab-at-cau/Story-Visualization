# Pipeline: FINAL.1, FINAL.2, FINAL.3

이 문서는 현재 `Story-Visualization` 저장소에서 FINAL 단계가 실제로 어떻게 구현되어 있는지 정리한다.

관련 구현 파일:

- `src/lib/pipeline/final1.ts`
- `src/lib/pipeline/final2.ts`
- `src/components/ReaderScreen.tsx`

---

## 현재 상태

| Stage | 구현 위치 | 현재 상태 | 비고 |
|---|---|---|---|
| FINAL.1 | `src/lib/pipeline/final1.ts` | 구현 완료 | scene reader packet 조립 |
| FINAL.2 | `src/lib/pipeline/final2.ts` | 구현 완료 | vision+fallback overlay refinement |
| FINAL.3 | `src/components/ReaderScreen.tsx` | 구현 완료 | 최종 reader UI |

---

## FINAL.1 - Scene Reader Package Builder

### 역할

- `SCENE.3`, `SUB.3`, `SCENE.1`, `STATE.3`, `RawChapter`를 조합해 reader UI용 `SceneReaderPacket`을 구성
- optional intervention package, blueprint, rendered image를 함께 반영

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
  renderedImagesLog?: RenderedImagesLike,
): SceneReaderPackageLog
```

### visual block 현재 동작

- rendered image가 있으면 `mode: "image"`
- 없으면 `mode: "blueprint"`
- `image_path`는 `RenderedImages`에서 가져옴
- `fallback_blueprint_available`은 `blueprintLog` 기준
- `chips`는 `SCENE.3.environment[*].label` + `scene_place.actual_place` 기반
- `overlay_characters`는 `VIS.2 -> SCENE.3 -> SCENE.1` 우선순위로 구성

즉, 이전 문서들과 달리 FINAL.1 visual block은 더 이상 항상 blueprint-only가 아니다.

### subscene / panel 구성

- `SUB.3 validated_subscenes`를 기준으로 subscene nav 생성
- `SUB.4`가 있으면 `global_view / character_units / pair_units`를 우선 사용
- 없으면 SUB.3 fallback으로 최소 UI를 구성

### run_id

```ts
const runId = `scene_reader_package__${docId}__${chapterId}`
```

---

## FINAL.2 - Overlay Refinement

### 역할

- FINAL.1의 coarse overlay anchor를 vision input으로 보정
- 이미지가 없거나 refinement가 불안정하면 coarse anchor fallback 사용

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

### 현재 동작

- image source는 `imagePaths` 또는 `packet.visual.image_path`에서 찾음
- image가 있고 LLM client가 있으면 multimodal refinement 수행
- accepted 조건:

```ts
anchorX !== undefined &&
anchorY !== undefined &&
confidence >= 0.45 &&
source !== "coarse_fallback"
```

- accepted하지 못하면 coarse anchor를 유지하되 `approximate` 또는 `fallback` 처리

### run_id

```ts
const runId = `overlay_refinement__${docId}__${chapterId}`
```

---

## FINAL.3 - Reader Screen

### 역할

- `SceneReaderPackageLog` + optional `OverlayRefinementResult`를 합쳐 최종 reader UI를 렌더링

### 현재 UI 특징

- scene selector
- subscene navigation
- body paragraphs
- visual block image/placeholder
- overlay buttons
- global / character / pair view panel

### merge 규칙

`buildMergedOverlay()`에서:

```ts
if (refined?.visibility === "not_visible" && refined.confidence >= 0.5) {
  continue
}
```

그 외에는 refined anchor가 있으면 refined를, 없으면 coarse anchor를 사용한다.

---

## 현재 구현 메모

- FINAL 단계는 더 이상 단순 placeholder reader가 아니다.
- VIS 결과와 SUB 결과가 실제로 reader UI에 연결된다.
- 다만 support policy는 아직 FINAL 내부에서 제한적으로만 존재한다.

---

## 개선 필요 지점

### 1. FINAL.1은 support artifact보다 reader packet 조립에 더 가깝다

문제:

- snapshot / chips / causal bridge 같은 support artifact branch가 아직 없어서
- FINAL.1이 scene packet + subscene hint를 직접 끌어와 UI용 형태로 조립하는 비중이 큼

권장 개선:

- SUPPORT branch를 만든 뒤 FINAL.1은 packager 역할에 집중

### 2. chips가 아직 scene-state recovery 관점에서 충분히 정교하지 않다

현재 chips는 주로 environment와 actual place에 기반한다.

권장 개선:

- boundary delta, goal change, cast turnover, causal cue를 chips로 분리

### 3. overlay collision / decluttering이 없다

현재도 동작은 하지만:

- character button이 겹칠 수 있고
- 장면별 UI clutter 제어가 약하다

권장 개선:

- overlap avoidance
- safe margin
- low-priority overlay suppression

### 4. FINAL.2는 아직 support policy와 분리되어 있다

즉, refinement는 수행하지만

- 이 image가 정말 보여줄 가치가 있는지
- text support를 같이 강하게 보여야 하는지

같은 판단은 하지 않는다.

권장 개선:

- VIS usefulness와 support policy를 FINAL 조립 단계에 연결
