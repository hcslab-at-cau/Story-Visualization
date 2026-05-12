# Pipeline: FINAL.1, FINAL.2, ReaderScreen

이 문서는 현재 `Story-Visualization` 저장소에서 FINAL 단계가 실제로 어떻게 구현되어 있는지 정리한다.

관련 구현 파일:

- `src/lib/pipeline/final1.ts`
- `src/lib/pipeline/final2.ts`
- `src/app/api/pipeline/final1/route.ts`
- `src/components/ReaderScreen.tsx`

## 현재 상태

| Stage | 구현 위치 | 현재 상태 | 비고 |
|---|---|---|---|
| `FINAL.1` | `src/lib/pipeline/final1.ts` | 구현 완료 | scene reader packet 조립, `SUP.7` support 포함 |
| `FINAL.2` | `src/lib/pipeline/final2.ts` | 구현 완료 | vision+fallback overlay refinement |
| Reader UI | `src/components/ReaderScreen.tsx` | 구현 완료 | 본문 anchor 기반 support 표시 |

## FINAL.1 - Scene Reader Package Builder

### 역할

- `SCENE.3`, `SUB.3`, `SCENE.1`, `STATE.3`, `RawChapter`를 조합해 reader UI용 `SceneReaderPacket`을 구성한다.
- optional intervention package, blueprint, rendered image를 함께 반영한다.
- `SUP.7`이 있으면 scene별 `support` packet을 `SceneReaderPacket.support`에 포함한다.

`FINAL.1`은 support를 새로 판단하는 단계가 아니다. support 생성과 선별은 `SUP.1~SUP.7`에서 끝나며, `FINAL.1`은 reader 화면이 읽을 수 있는 패키지로 묶는다.

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
  supportLog?: ReaderSupportPackageLog,
): SceneReaderPackageLog
```

`src/app/api/pipeline/final1/route.ts`는 같은 run의 `SUP.7` 결과를 읽어서 `supportLog`로 전달한다.

## FINAL.1 package 구성

### visual block

- rendered image가 있으면 `mode: "image"`를 사용한다.
- 없으면 `mode: "blueprint"` fallback을 사용한다.
- `image_path`는 `RenderedImages`에서 가져온다.
- `fallback_blueprint_available`은 `blueprintLog` 기준이다.
- `chips`는 `SCENE.3.environment[*].label`과 `scene_place.actual_place` 기반이다.
- `overlay_characters`는 `VIS.2`, `SCENE.3`, `SCENE.1` 정보를 조합한다.

### subscene / panel

- `SUB.3 validated_subscenes`를 기준으로 subscene navigation을 만든다.
- `SUB.4`가 있으면 `global_view`, `character_units`, `pair_units`를 우선 사용한다.
- 없으면 `SUB.3` 기반 fallback으로 최소 reader panel을 만든다.

### support

- `supportLog?.packets.find((packet) => packet.scene_id === sceneId)` 결과를 scene packet에 붙인다.
- 이 `supportLog`는 `SUP.7`의 `ReaderSupportPackageLog`다.
- 현재 `SUP.7`은 chapter-local support뿐 아니라 `BOOK.0`에서 파생한 `NRG.0` claim 기반 support도 포함할 수 있다.

### run_id

```ts
const runId = `scene_reader_package__${docId}__${chapterId}`
```

## FINAL.2 - Overlay Refinement

### 역할

- `FINAL.1`의 coarse overlay anchor를 vision input으로 보정한다.
- 이미지가 없거나 refinement가 불안정하면 coarse anchor fallback을 유지한다.
- reader support, `BOOK.0`, `NRG.0`, `Knowledge Graph`는 사용하지 않는다.

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

### accepted 조건

```ts
anchorX !== undefined &&
anchorY !== undefined &&
confidence >= 0.45 &&
source !== "coarse_fallback"
```

조건을 만족하지 못하면 coarse anchor를 유지하되 `approximate` 또는 `fallback`으로 처리한다.

## ReaderScreen

### 역할

- `SceneReaderPackageLog`와 optional `OverlayRefinementResult`를 합쳐 최종 reader UI를 렌더링한다.
- 본문 paragraph를 우선 보여주고, support는 본문 anchor 클릭으로 연다.
- 독자 모드에서는 support anchor와 modal/popover를 조용하게 보여준다.
- 연구자 모드에서는 anchor, support kind, provenance/debug 정보를 더 명확하게 보여준다.

### 현재 UI 특징

- scene selector
- subscene navigation
- body paragraphs
- visual block image/placeholder
- overlay buttons
- global / character / pair view panel
- anchored support selector
- support detail modal/popover

### overlay merge 규칙

`buildMergedOverlay()`에서:

```ts
if (refined?.visibility === "not_visible" && refined.confidence >= 0.5) {
  continue
}
```

그 외에는 refined anchor가 있으면 refined를, 없으면 coarse anchor를 사용한다.

## 현재 구현 메모

- FINAL 단계는 더 이상 placeholder reader가 아니다.
- VIS 결과, SUB 결과, `SUP.7` support 결과가 실제 reader UI에 연결된다.
- support policy는 FINAL 내부가 아니라 `SUP.6`과 `SUP.7`에서 결정된다.
- `FINAL.2`는 image overlay refinement이며, KG/NRG 기반 support와는 분리되어 있다.

## 개선 필요 지점

1. `FINAL.1`의 chips는 아직 scene-state recovery 관점에서 충분히 정교하지 않다.
   - 현재는 environment와 actual place에 기반한다.
   - boundary delta, goal change, cast turnover, causal cue를 더 잘 분리할 수 있다.

2. overlay collision / decluttering이 아직 제한적이다.
   - character button이 겹칠 수 있다.
   - safe margin, overlap avoidance, low-priority suppression이 필요하다.

3. visual usefulness와 support policy의 연결은 아직 약하다.
   - `FINAL.2`는 이미지를 보정하지만, 이 이미지가 독자 지원에 얼마나 유용한지는 판단하지 않는다.
   - VIS usefulness 판단은 `SUP` 또는 별도 policy layer에서 다루는 편이 맞다.
