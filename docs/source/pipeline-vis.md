# Pipeline: VIS.1, VIS.2, VIS.3, VIS.4

SCENE.3 이후 선택적 분기. 이미지 생성을 위한 파이프라인.

---

## VIS.1 — Semantic Clarification (`semantic_clarification.py`)

### 역할

모호한 서사 표현을 render-safe 표현으로 정규화. LLM 호출.

### 함수 시그니처

```python
def run_semantic_clarification(
    validated_log: GroundedSceneModel,   # SCENE.3 출력
    packet_log: ScenePackets,            # SCENE.1 출력
    llm_client: Any,
    doc_id: str,
    chapter_id: str,
    on_progress: Optional[Callable[[str], None]] = None,
    parents: Optional[Dict[str, str]] = None,
) -> VisualGrounding
```

### 처리 흐름

```python
for entry, packet in zip(validated_log.validated, packet_log.packets):
    scene_index = entry.validated_scene_index

    result = llm_client.extract_semantic_clarification({
        "scene_id": packet.scene_id,
        "start_pid": packet.start_pid,
        "end_pid": packet.end_pid,
        "scene_text": packet.scene_text_with_pid_markers,
        "current_places_json": format_json_param(packet.scene_current_places),
        "environment_json": format_json_param(scene_index.get("environment", [])),
        "start_state_json": format_json_param(packet.start_state),
        "onstage_cast_json": format_json_param(scene_index.get("onstage_cast", [])),
    })
    packets.append(VisualGroundingPacket(**result))
```

### LLM 입력 (`vis1_semantic_clarification.txt`)

씬 텍스트, 장소 목록, environment 항목, 시작 상태, onstage cast

### LLM 출력

```json
{
  "scene_id": "scene_01",
  "environment_type": "outdoor",
  "stage_archetype": "riverbank",
  "canonical_place_key": "riverbank_001",
  "ambiguity_resolutions": [
    {
      "surface_form": "the bank",
      "resolved_sense": "riverbank (natural outdoor ground beside a river)",
      "render_hint": "grassy riverbank",
      "avoid": ["financial bank", "wall"],
      "reason": "Context confirms natural setting near water",
      "confidence": "high"
    }
  ],
  "grounded_scene_description": "Alice sits on a grassy bank beside a slow river on a warm afternoon",
  "visual_constraints": ["no urban elements", "pastoral setting"],
  "avoid": ["modern clothing", "fantasy creatures"]
}
```

### run_id 패턴

`f"vis1_semantic_clarification__{doc_id}__{chapter_id}"`

---

## VIS.2 — Stage Blueprint (`image_support.py`)

### 역할

이미지 생성을 위한 Stage Grammar 추출. LLM + 규칙 필터 + L-check 경고.

### 함수 시그니처

```python
def run_image_support_extraction(
    validated_log: GroundedSceneModel,
    packet_log: ScenePackets,
    llm_client: Any,
    doc_id: str,
    chapter_id: str,
    on_progress: Optional[Callable[[str], None]] = None,
    clarification_log: Optional[VisualGrounding] = None,  # VIS.1 출력
    parents: Optional[Dict[str, str]] = None,
) -> StageBlueprint
```

### 처리 3단계

#### 1. LLM 추출

```python
result = llm_client.extract_image_support({
    "scene_id": ...,
    "start_pid": ..., "end_pid": ...,
    "start_state_json": ..., "end_state_json": ...,
    "scene_text": ...,
    "onstage_cast_json": ...,
    "current_places_json": ..., "mentioned_places_json": ...,
    "objects_json": ..., "environment_json": ..., "goals_json": ...,
    "grounded_scene_description": vis1_packet.grounded_scene_description,
    "ambiguity_resolutions_json": format_json_param(vis1_packet.ambiguity_resolutions),
})
```

#### 2. 규칙 필터

```python
# onstage 아닌 캐릭터 제거
valid_cast = {c["name"] for c in scene_index.get("onstage_cast", [])}
packet.characters = [ch for ch in packet.characters if ch.name in valid_cast]

# current가 아닌 장소 플래그
for ch in packet.characters:
    if ch.composition_position mentions non-current place: flag_warning
```

#### 3. L-check (경고만, 실행 차단 안 함)

```python
# 환경/enclosure 모순 검사
if geometry.enclosure == "open" and environment_type == "indoor": warning("...")

# 빈 필드 경고
if not geometry.dominant_geometry: warning("dominant_geometry empty")
if not zones: warning("no zones defined")
if not presentation: warning("presentation spec missing")

# 추상적 forbid 경고
for item in forbid:
    if len(item) < 4: warning(f"forbid item too abstract: {item}")
```

### LLM 입력 (`vis2_image_support.txt`)

씬 전체 정보 + VIS.1 결과 (ambiguity_resolutions, grounded_scene_description)

### LLM 출력 (StageBlueprintPacket)

```json
{
  "scene_id": "scene_01",
  "canonical_place_key": "riverbank_001",
  "environment_type": "outdoor",
  "stage_archetype": "riverbank",
  "key_moment": "Alice sitting dreamily on the grassy bank while her sister reads",
  "setting": {
    "location": "grassy riverbank", "time_of_day": "afternoon",
    "atmosphere": "drowsy and peaceful", "lighting": "warm afternoon sunlight"
  },
  "characters": [
    {
      "name": "Alice", "composition_position": "foreground center",
      "pose": "sitting with legs tucked", "expression": "bored and dreamy",
      "gaze_direction": "down", "notable_props": []
    }
  ],
  "structural_elements": ["grass bank", "slow river", "overhanging willow"],
  "layout_summary": "Wide horizontal riverbank with Alice seated in foreground left",
  "geometry": {
    "enclosure": "open", "main_axis": "horizontal",
    "ground_profile": "flat", "dominant_geometry": "strip",
    "height_profile": "low", "openness": "wide"
  },
  "presentation": {
    "perspective_mode": "axonometric_2_5d", "section_mode": "none",
    "frame_mode": "full_bleed", "edge_treatment": "natural_crop",
    "coverage": "edge_to_edge", "continuity_beyond_frame": true,
    "support_base_visibility": "hidden", "symmetry_tolerance": "low",
    "naturalism_bias": "high"
  },
  "zones": [
    {"name": "foreground", "shape": "strip", "position": "center", "scale": "dominant", "priority": "high"}
  ],
  "boundaries": ["water edge", "tree line"],
  "forbid": ["perspective_mode: axonometric_2_5d floating character"],
  "blueprint_valid": true,
  "blueprint_warnings": []
}
```

### perspective_mode 값

`axonometric_2_5d | vertical_section | oblique_section | plan_oblique`

### run_id 패턴

`f"vis2_stage_blueprint__{doc_id}__{chapter_id}"`

---

## VIS.3 — Render Package (`render_package.py`)

### 역할

StageBlueprintPacket → 이미지 생성용 프롬프트 블록 컴파일. **완전 규칙 기반.**

### 함수 시그니처

```python
def run_render_package_compilation(
    image_support_log: StageBlueprint,
    doc_id: str,
    chapter_id: str,
    on_progress: Optional[Callable[[str], None]] = None,
    parents: Optional[Dict[str, str]] = None,
) -> RenderPackage
```

### 프롬프트 블록 구성

```python
for packet in image_support_log.packets:
    # 공통 스타일 블록 (vis3_style_common.txt 템플릿)
    common_style_block = prompt_loader.load("vis3_style_common", {})

    # 씬 blueprint 블록 (geometry + zones + characters)
    scene_blueprint_block = _compile_scene_blueprint(packet)  # 규칙 기반 텍스트 변환

    # presentation 블록 (perspective_mode, frame_mode, ...)
    presentation_block = _compile_presentation(packet.presentation)

    # hard constraints 블록 (forbid + avoid + must_not_show)
    hard_constraints_block = "\n".join([
        f"FORBID: {item}" for item in (packet.forbid + packet.avoid + packet.must_not_show)
    ])

    # failure patch 블록 (재시도 시 채워짐)
    failure_patch_block = ""

    # 전체 프롬프트 조합
    full_prompt = "\n\n".join(filter(None, [
        common_style_block, scene_blueprint_block,
        presentation_block, hard_constraints_block, failure_patch_block
    ]))

    items.append(RenderPackageItem(
        scene_id=packet.scene_id,
        common_style_block=common_style_block,
        scene_blueprint_block=scene_blueprint_block,
        presentation_block=presentation_block,
        hard_constraints_block=hard_constraints_block,
        full_prompt=full_prompt,
        prompt_schema_version="v2",
    ))
```

### run_id 패턴

`f"vis3_render_package__{doc_id}__{chapter_id}"`

---

## VIS.4 — Image Generation (`image_generation.py`)

### 역할

RenderPackage → 이미지 생성 (OpenRouter 이미지 API). 실패 시 패치 후 재시도.

### 함수 시그니처

```python
def run_image_generation(
    image_support_log: Optional[StageBlueprint],
    model: str,
    api_key: str,
    output_dir: Path,
    doc_id: str,
    chapter_id: str,
    render_package_log: Optional[RenderPackage] = None,  # VIS.3 출력 (우선)
    max_attempts: int = 3,
    parents: Optional[Dict[str, str]] = None,
) -> RenderedImages
```

### 재시도 루프

```python
for scene_id in all_scene_ids:
    failure_history = []
    for attempt in range(max_attempts):
        # 프롬프트 컴파일 (VIS.3 있으면 사용, 없으면 VIS.2에서 재컴파일)
        if attempt == 0 and render_package_log:
            package = render_package_log.items[scene_id]
        else:
            # 실패 패치 적용 후 재컴파일
            package = _compile_render_package(blueprint_packet, failure_history)

        result = _render_image(package, client, model, output_dir)

        if result.success:
            break
        else:
            failure_type = _classify_failure(result.error)
            failure_history.append(failure_type)
```

### 실패 분류 및 패치

```python
_FAILURE_PATCHES = {
    "output_format": "Render exactly ONE image with NO panels, grids, or multiple views.",
    "content_policy": "Architecture and environment only. No human figures, no characters, no faces.",
    "api_error": "Clean isometric architectural diagram. Minimal detail. No characters.",
}

def _classify_failure(error: str) -> str:
    if "multiple" in error or "panel" in error: return "output_format"
    if "policy" in error or "content" in error: return "content_policy"
    return "api_error"
```

### 이미지 저장 경로

```
{output_dir}/{doc_id}/{chapter_id}/{scene_id}.png
```

### LLM 출력 (RenderedImageResult)

```json
{
  "scene_id": "scene_01",
  "image_path": "data/images/my_book/ch01/scene_01.png",
  "prompt_used": "...",
  "model": "openai/dall-e-3",
  "success": true,
  "error": null
}
```

### run_id 패턴

`f"vis4_image_generation__{doc_id}__{chapter_id}"`
