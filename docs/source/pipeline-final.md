# Pipeline: FINAL.1, FINAL.2 + FINAL.3 (UI)

---

## FINAL.1 — Scene Reader Package Builder (`scene_reader_package.py`)

### 역할

VIS.4 + SUB.3 + SCENE.3 + SCENE.1 → 독자용 SceneReaderPacket 조립.
**완전 규칙 기반 (새 추론 없음, 모두 업스트림 아티팩트 조합).**

### 함수 시그니처

```python
def run_scene_reader_package(
    image_log: RenderedImages,              # VIS.4 (필수)
    sub3_log: ValidatedSubscenes,           # SUB.3 (필수)
    grounded_log: GroundedSceneModel,       # SCENE.3 (필수, 씬 순서 기준)
    packet_log: ScenePackets,               # SCENE.1
    boundary_log: Optional[SceneBoundaries] = None,    # STATE.3 (제목 + pid range용)
    blueprint_log: Optional[StageBlueprint] = None,    # VIS.2 (캐릭터 위치용)
    vis1_log: Optional[VisualGrounding] = None,         # VIS.1 (chips용)
    sub2_log: Optional[SubsceneStates] = None,          # SUB.2 (미사용, 향후)
    intervention_log: Optional[InterventionPackages] = None, # SUB.4 (character panels용)
    render_package_log: Optional[RenderPackage] = None,  # VIS.3 (미사용)
    chapter: Optional[RawChapter] = None,   # 본문 단락
    doc_id: str = "",
    chapter_id: str = "",
    parents: Optional[Dict] = None,
) -> SceneReaderPackageLog
```

### 처리 흐름

```python
# 전처리
scene_titles = boundary_log.scene_titles or {}  # {scene_id: title}
pid_text = {p.pid: p.text for p in chapter.paragraphs}
scene_pid_range = {span.scene_id: (span.start_pid, span.end_pid) for span in boundary_log.scenes}
image_map = {r.scene_id: r for r in image_log.results}
blueprint_scene_ids = {p.scene_id for p in blueprint_log.packets} if blueprint_log else set()

# SCENE.3 순서로 씬 순회
for entry in grounded_log.validated:
    scene_id = entry.scene_id

    # 1. Visual Block 구성
    image_result = image_map.get(scene_id)
    mode = "image" if (image_result and image_result.success and image_result.image_path) else "blueprint"
    chips = _build_chips(scene_id, grounded_log, vis1_log)
    overlay_chars = _build_overlay_characters(scene_id, blueprint_log, grounded_log, packet_log)
    character_panels = _build_character_panels(scene_id, overlay_chars, intervention_log, sub3_log)

    # 2. Subscene blocks 구성
    subscene_nav, subscene_views = _build_subscene_blocks(scene_id, sub3_log, sub2_log, pid_text)

    # 3. Body paragraphs (STATE.3 pid range 기준)
    start_pid, end_pid = scene_pid_range.get(scene_id, (0, 0))
    body_paragraphs = [pid_text[pid] for pid in range(start_pid, end_pid + 1) if pid in pid_text]

    packets.append(SceneReaderPacket(
        scene_id, scene_title=scene_titles.get(scene_id, ""),
        scene_summary=entry.validated_scene_index.get("scene_summary", ""),
        body_paragraphs, visual, subscene_nav, subscene_views, character_panels,
        default_active_subscene_id=subscene_nav[0].subscene_id if subscene_nav else "",
    ))
```

### `_build_chips` — 씬 chip 태그 구성

```python
def _build_chips(scene_id, grounded_log, vis1_log) -> List[str]:
    chips = []
    # Priority 1: VIS.1 ambiguity_resolutions[0].render_hint (최대 1개)
    # Priority 2: SCENE.3 environment labels + actual_place (합쳐서 최대 4개)
    return chips[:4]
```

### `_build_overlay_characters` — 캐릭터 overlay 버튼 구성

```python
# anchor 위치 테이블 (VIS.2 composition_position → x%, y%)
_ZONE_ANCHOR = {
    "foreground left":   (15.0, 78.0),
    "foreground center": (50.0, 78.0),
    "foreground right":  (85.0, 78.0),
    "midground left":    (15.0, 52.0),
    "midground center":  (50.0, 52.0),  # fallback
    "midground right":   (85.0, 52.0),
    "background left":   (15.0, 26.0),
    "background center": (50.0, 26.0),
    "background right":  (85.0, 26.0),
}

def _build_overlay_characters(scene_id, blueprint_log, grounded_log, packet_log):
    seen = {}  # label → OverlayCharacter
    # Priority 1: VIS.2 캐릭터 (composition_position 있음)
    for ch in blueprint.characters:
        x, y, zone = _resolve_anchor(ch.composition_position)
        entity_id = f"char_{ch.name.lower().replace(' ', '_')}"
        seen[ch.name] = OverlayCharacter(
            character_id=entity_id, label=ch.name,
            anchor_zone=zone, anchor_x=x, anchor_y=y,
            anchor_method="zone_bucket",
            panel_key=f"panel_{entity_id}",
        )

    # Priority 2: SCENE.3 onstage_cast (midground center fallback)
    for cast_item in scene_index.get("onstage_cast", []):
        label = cast_item["name"]
        if label not in seen: seen[label] = OverlayCharacter(..., anchor_x=50.0, anchor_y=52.0)

    # Priority 3: SCENE.1 scene_cast_union
    for label in packet.scene_cast_union:
        if label not in seen: seen[label] = OverlayCharacter(..., anchor_x=50.0, anchor_y=52.0)

    return list(seen.values())
```

### `_build_subscene_blocks` — 서브씬 nav/view 구성

```python
_BUTTON_DEFS = [
    ("goal",         "local_goal",          "Goal"),
    ("problem",      "problem_state",       "Problem"),
    ("what_changed", "causal_result",       "What changed"),
    ("why_it_matters","narrative_importance","Why it matters"),
]

def _build_subscene_blocks(scene_id, sub3_log, sub2_log, pid_text):
    nav = []
    views = {}
    for sub in validated_subscenes:
        # nav item: subscene_id, label, headline, body_paragraphs
        body_paragraphs = [pid_text[pid] for pid in range(sub.start_pid, sub.end_pid + 1) if pid in pid_text]
        nav.append(SubsceneNavItem(subscene_id=sub.subscene_id, label=sub.label,
                                   headline=sub.headline or sub.action_summary,
                                   body_paragraphs=body_paragraphs))

        # view: buttons + panels (필드에 내용이 있는 것만)
        buttons = []
        panels = {}
        for key, field_name, display_label in _BUTTON_DEFS:
            value = getattr(sub, field_name, "") or ""
            if value.strip():
                buttons.append(SubsceneButton(key=key, label=display_label))
                panels[key] = value
        # object button: key_objects[0]
        if sub.key_objects:
            buttons.append(SubsceneButton(key="object", label=sub.key_objects[0][:24]))
            panels["object"] = ", ".join(sub.key_objects)

        views[sub.subscene_id] = SubsceneView(headline=sub.headline, buttons=buttons, panels=panels)
    return nav, views
```

### `_build_character_panels` — 캐릭터 팝오버 텍스트

```python
def _build_character_panels(scene_id, overlay_chars, intervention_log, sub3_log):
    # panel_key → {subscene_id → text}
    # Priority 1: SUB.4 cast_buttons.reveal (subscene별 텍스트)
    for unit in intervention_log.packets:
        for cast_button in unit.cast_buttons:
            panel_key = label_to_panel.get(cast_button.name.lower())
            text = f"[{unit.title}] {cast_button.role}: {cast_button.reveal}"
            panel_parts[panel_key][unit.subscene_id].append(text)

    # Priority 2: SUB.3 fallback (내용 없는 캐릭터만)
    for subscene in sub3_packets:
        for cast_name in subscene.active_cast:
            bits = [f"[{sub.label}]", summary, f"Goal: {goal}", f"Problem: {problem}"]
            panel_parts[panel_key][subscene.subscene_id] = " ".join(bits)

    return {panel_key: {sid: "\n\n".join(parts)} for ...}
```

### run_id 패턴

`f"scene_reader_package__{doc_id}__{chapter_id}"`

---

## FINAL.2 — Overlay Refinement (`overlay_refinement.py`)

### 역할

FINAL.1의 coarse anchor를 Vision API로 정제.
이미지 없거나 API 없으면 전체 fallback으로 동작 (결과 반드시 반환).

### 함수 시그니처

```python
def run_overlay_refinement(
    scene_reader_log: SceneReaderPackageLog,   # FINAL.1 출력
    image_log: Optional[RenderedImages] = None, # VIS.4 출력
    blueprint_log: Optional[StageBlueprint] = None, # VIS.2 출력
    model: str = "",        # Vision 모델 (비어 있으면 fallback only)
    api_key: str = "",
    api_base: str = "https://openrouter.ai/api/v1",
    doc_id: str = "",
    chapter_id: str = "",
    parents: Optional[Dict[str, str]] = None,
    on_progress: Optional[Callable[[str], None]] = None,
) -> OverlayRefinementResult
```

### 처리 흐름

```python
image_map = {r.scene_id: r.image_path for r in image_log.results if r.image_path}
use_vision = bool(api_key and model)
method = "vision+fallback" if use_vision else "fallback_only"

for packet in scene_reader_log.packets:
    image_path = packet.visual.image_path or image_map.get(packet.scene_id)
    image_available = bool(image_path and Path(image_path).exists())

    raw_result = None
    if use_vision and image_available and packet.visual.overlay_characters:
        try:
            raw_result = _vision_refine_scene(client, model, packet, image_path, blueprint_log)
        except Exception:
            raw_result = None  # 실패 시 fallback

    scenes.append(_normalize_result(packet, raw_result, image_path, image_available))
```

### `_vision_refine_scene` — Vision API 호출

```python
def _vision_refine_scene(client, model, packet, image_path, blueprint_log):
    # 프롬프트 구성
    prompt = prompt_loader.load("final2_overlay_refinement", {
        "scene_id": packet.scene_id,
        "scene_title": packet.scene_title,
        "scene_summary": packet.scene_summary,
        "visual_mode": packet.visual.mode,
        "chips_json": format_json_param(packet.visual.chips),
        "overlay_candidates_json": format_json_param([
            {"character_id": ch.character_id, "label": ch.label,
             "anchor_zone": ch.anchor_zone, "anchor_x": ch.anchor_x, "anchor_y": ch.anchor_y,
             "anchor_method": ch.anchor_method}
            for ch in packet.visual.overlay_characters
        ]),
        "blueprint_summary": _blueprint_summary(packet.scene_id, blueprint_log),
        "scene_body_text": "\n\n".join(packet.body_paragraphs),
    })

    # 이미지를 base64 data URL로 인코딩
    data_url = f"data:image/png;base64,{base64.b64encode(image_path.read_bytes()).decode()}"

    # multimodal 메시지
    messages = [
        {"role": "system", "content": "Return ONLY valid JSON."},
        {"role": "user", "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": data_url}},
        ]},
    ]
    response = client.chat.completions.create(model=model, temperature=0.0, max_tokens=2000, messages=messages)
    return parse_json_response(response.choices[0].message.content)
```

### Vision API 출력 (raw)

```json
{
  "characters": [
    {
      "character_id": "char_alice",
      "label": "Alice",
      "visibility": "placed",
      "bbox_norm": {"x": 0.3, "y": 0.4, "w": 0.15, "h": 0.35},
      "anchor_x": 37.5,
      "anchor_y": 57.5,
      "confidence": 0.82,
      "source": "text_image_guided",
      "reason": "Alice is clearly visible in the center-left foreground"
    }
  ]
}
```

### `_normalize_result` — raw 결과 → OverlayRefinementScene

```python
_MIN_REFINEMENT_CONFIDENCE = 0.45

def _normalize_result(packet, raw_result, image_path, image_available):
    for coarse in packet.visual.overlay_characters:
        raw = by_id.get(coarse.character_id) or by_label.get(coarse.label.lower())

        if not raw:
            # fallback: FINAL.1 coarse anchor 유지
            characters.append(_coarse_character_result(coarse, "result missing", "fallback"))
            continue

        confidence = raw.get("confidence", 0.0)
        source = raw.get("source", "coarse_fallback")
        accepted = (
            anchor_x is not None and anchor_y is not None
            and confidence >= _MIN_REFINEMENT_CONFIDENCE   # 0.45
            and source != "coarse_fallback"
        )

        if accepted:
            # 정제된 anchor 채택
            characters.append(OverlayRefinementCharacter(
                anchor_x=anchor_x, anchor_y=anchor_y,
                bbox_norm=BBoxNorm(...) if bbox else None,
                visibility="placed", confidence=confidence, source=source,
            ))
        else:
            # fallback
            fallback_vis = "approximate" if confidence >= 0.2 and image_available else "fallback"
            characters.append(_coarse_character_result(coarse, reason, fallback_vis, confidence))
```

### visibility 값

`placed | approximate | fallback`

### source 값

`text_image_guided | blueprint_guided | coarse_fallback`

### run_id 패턴

`f"overlay_refinement__{doc_id}__{chapter_id}"`

---

## FINAL.3 — Reader Screen (UI 전용, 파이프라인 Stage 없음)

### 역할

FINAL.1 + FINAL.2 결과를 합쳐 최종 독자 화면을 렌더링.
debug 정보(confidence, bbox, source badge) 없이 깔끔하게 표시.

### 필요 데이터

- `SceneReaderPackageLog` (FINAL.1) — 필수
- `OverlayRefinementResult` (FINAL.2) — optional (없으면 coarse anchor 사용)

### 캐릭터 필터링 규칙 (`_build_merged_overlay`)

```python
_VISIBLE_STATES = {"visible", "placed", "approximate"}
_CONF_THRESHOLD = 0.5  # 이 이상이면 not_visible 신뢰

def _build_merged_overlay(packet, refinement_scene) -> List[Tuple[OverlayCharacter, Optional[OverlayRefinementCharacter]]]:
    for char in packet.visual.overlay_characters:
        refined = refinement_map.get(char.character_id)
        if refined is not None:
            if refined.visibility == "not_visible" and refined.confidence >= _CONF_THRESHOLD:
                continue  # 이미지에 없다고 확신 → 버튼 제거
        merged.append((char, refined))
```

### 레이아웃 구조

```
씬 선택 드롭다운
씬 제목 + 요약
─────────────────────────────────
좌측 (1.2)              우측 (1)
  서브씬 인덱스           chips
  {n}/{total} · label    이미지
  body_paragraphs        캐릭터 버튼 (popover)
  ← dots →              ─────
                         headline
                         expander 패널들 (goal/problem/...)
```

### 서브씬 네비게이션

- `←` / `→` 버튼으로 subscene 이동
- 현재 위치: `{idx+1}/{n_subs} · {label}`
- 도트 인디케이터: `● ○ ○`

### 캐릭터 popover

```tsx
// FINAL.3에서는 debug 정보 없이 panel_text만 표시
<Popover trigger={char.label}>
  {panel_text || "(현재 subscene 기준 정보 없음)"}
</Popover>
```

### 구현 위치

`src/components/tabs/TabFinal3.tsx` — 파이프라인 로직 없음, 순수 React 컴포넌트
