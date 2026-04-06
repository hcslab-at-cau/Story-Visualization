# Pipeline: SCENE.1, SCENE.2, SCENE.3

`Story-Visualization` 현재 기준에서 SCENE 단계는 포트돼 있지만, PRE처럼 직접 운영되는 주 경로는 아니다.  
문서 아래 내용은 원본 scene representation 파이프라인 설명을 유지하되, 실제 결과 검토는 현재 `PipelineRunner`의 공통 JSON viewer 기준으로 이뤄진다.

## 단계별 이전 결과

| Stage | 필요 입력 | 이전 단계 기준 |
|---|---|---|
| SCENE.1 | `SceneBoundaries`, `RefinedStateFrames`, `StateFrames`, `EntityGraph`, `RawChapter` | STATE.3, STATE.2, STATE.1, ENT.3 필요 |
| SCENE.2 | `ScenePackets` | SCENE.1 필요 |
| SCENE.3 | `ScenePackets`, `SceneIndexDraft`, `EntityGraph`, `RefinedStateFrames` | SCENE.1, SCENE.2, ENT.3, STATE.2 필요 |

---

## SCENE.1 — Scene Packet Builder (`scene_packet.py`)

### 역할

STATE.3 SceneSpan → 자체 포함 ScenePacket. 이후 LLM Stage가 이 패킷만으로 동작 가능하게 함.
**완전 규칙 기반 (LLM 없음).**

### 함수 시그니처

```python
def run_scene_packet_builder(
    boundary_log: SceneBoundaries,    # STATE.3 출력
    validated_log: RefinedStateFrames, # STATE.2 출력
    state_log: StateFrames,            # STATE.1 출력 (time_signals용)
    entity_log: EntityGraph,           # ENT.3 출력 (entity_registry용)
    chapter: RawChapter,
    doc_id: str,
    chapter_id: str,
    parents: Optional[Dict[str, str]] = None,
) -> ScenePackets
```

### 처리 흐름

```python
# 인덱스 구성
pid_to_frame, narrative_pids = _build_frame_index(validated_log)
pid_to_time = _build_time_index(state_log)      # pid → time_signals
pid_text = {p.pid: p.text for p in chapter.paragraphs}
canonical_to_eid, eid_to_canonical = _build_entity_maps(entity_log)

for scene in boundary_log.scenes:
    pids = [p for p in narrative_pids if scene.start_pid <= p <= scene.end_pid]

    scene_text = "\n\n".join(f"[P{pid}] {pid_text[pid]}" for pid in pids)

    start_frame = pid_to_frame[pids[0]]   # 첫 서사 프레임
    end_frame   = pid_to_frame[pids[-1]]  # 마지막 서사 프레임

    cast_union, current_places, mentioned_places, time_signals = _aggregate_cast_place_time(pids, ...)
    entity_registry = {name: canonical_to_eid[name] for name in cast_union + current_places + mentioned_places}
    phase_markers = [weak boundaries inside scene range]

    ScenePacket(
        scene_id, start_pid, end_pid, pids,
        scene_text_with_pid_markers=scene_text,
        start_state=start_frame.validated_state.model_dump(),
        end_state=end_frame.validated_state.model_dump(),
        scene_cast_union=cast_union,       # 씬 내 등장 cast (순서 보존, 중복 제거)
        scene_current_places=current_places, # 씬 내 current_place 값들
        scene_mentioned_places=mentioned_places,
        scene_time_signals=time_signals,
        phase_markers=phase_markers,        # weak_boundary_candidate들
        entity_registry=entity_registry,    # canonical_name → entity_id
        previous_scene_id=..., next_scene_id=...,
    )
```

### `_aggregate_cast_place_time` 집계 로직

```python
def _aggregate_cast_place_time(pids, pid_to_frame, pid_to_time):
    # 순서 보존, 중복 제거
    cast_union       = []  # active_cast (canonical_name 기준)
    current_places   = []  # current_place 값들
    mentioned_places = []  # mentioned_place 값들
    time_signals     = []  # time span 텍스트들

    for pid in pids:
        frame = pid_to_frame.get(pid)
        if frame and frame.is_narrative:
            vs = frame.validated_state
            for c in vs.active_cast:
                if c not in seen: cast_union.append(c)
            if vs.current_place and vs.current_place not in seen: current_places.append(vs.current_place)
            if vs.mentioned_place and vs.mentioned_place not in seen: mentioned_places.append(vs.mentioned_place)
        for sig in pid_to_time.get(pid, []):
            if sig not in seen: time_signals.append(sig)
```

### PhaseMarker (씬 내부 약한 경계)

```python
# weak_boundary_candidate이고 씬 범위 내에 있는 것들
phase_markers = [
    PhaseMarker(boundary_before_pid=b.boundary_before_pid, score=b.score, label=b.label)
    for b in boundary_log.boundaries
    if b.label == "weak_boundary_candidate" and scene.start_pid < b.boundary_before_pid <= scene.end_pid
]
```

### run_id 패턴

`f"scene_packet__{doc_id}__{chapter_id}"`

---

## SCENE.2 — Scene Index Extraction (`scene_index.py`)

### 역할

각 ScenePacket → 풍부한 의미 인덱스 (SceneIndex). LLM 호출.

### 함수 시그니처

```python
def run_scene_index_extraction(
    packet_log: ScenePackets,
    llm_client: Any,
    doc_id: str,
    chapter_id: str,
    on_progress: Optional[Callable[[str], None]] = None,
    parents: Optional[Dict[str, str]] = None,
) -> SceneIndexDraft
```

### 처리 흐름

```python
for packet in packet_log.packets:
    result = llm_client.extract_scene_index({
        "scene_id": packet.scene_id,
        "start_pid": packet.start_pid,
        "end_pid": packet.end_pid,
        "start_state_json": format_json_param(packet.start_state),
        "end_state_json": format_json_param(packet.end_state),
        "cast_union": ", ".join(packet.scene_cast_union),
        "current_places": ", ".join(packet.scene_current_places),
        "mentioned_places": ", ".join(packet.scene_mentioned_places),
        "time_signals": ", ".join(packet.scene_time_signals),
        "scene_text": packet.scene_text_with_pid_markers,
    })
    indices.append(SceneIndex(**result))
```

### LLM 입력 (`scene2_scene_index.txt`)

패킷의 모든 정보: scene_id, pid 범위, 시작/종료 상태, cast/place/time 목록, 씬 텍스트

### LLM 출력

```json
{
  "scene_id": "scene_01",
  "scene_summary": "Alice follows the White Rabbit into the garden.",
  "scene_place": {
    "actual_place": "the garden",
    "mentioned_places": ["Wonderland"],
    "evidence_pids": [1, 3],
    "grounding_type": "explicit",
    "confidence": "high"
  },
  "scene_time": {
    "label": "afternoon",
    "normalized": null,
    "is_explicit_jump": false,
    "grounding_type": "weak_inference",
    "confidence": "low"
  },
  "onstage_cast": [
    { "name": "Alice", "evidence_pids": [0, 1, 3], "evidence_text": ["Alice was..."], "grounding_type": "explicit", "confidence": "high" }
  ],
  "mentioned_offstage_cast": [...],
  "main_actions": [
    { "actor": "Alice", "action": "follows the White Rabbit", "evidence_pids": [2], "grounding_type": "explicit", "confidence": "high" }
  ],
  "goals": [...],
  "relations": [...],
  "objects": [...],
  "environment": [...]
}
```

### grounding_type 값

`explicit | strong_inference | weak_inference`

### run_id 패턴

`f"scene_index__{doc_id}__{chapter_id}"`

---

## SCENE.3 — Scene Validation (`scene_validation.py`)

### 역할

SCENE.2 SceneIndex를 규칙 사전검사 + LLM으로 검증. 잘못된 항목 제거/다운그레이드.

### 함수 시그니처

```python
def run_scene_index_validation(
    packet_log: ScenePackets,
    index_log: SceneIndexDraft,
    entity_log: EntityGraph,
    validated_log: RefinedStateFrames,
    llm_client: Any,
    doc_id: str,
    chapter_id: str,
    on_progress: Optional[Callable[[str], None]] = None,
    parents: Optional[Dict[str, str]] = None,
) -> GroundedSceneModel
```

### 처리 흐름

```python
for scene_index, packet in zip(index_log.indices, packet_log.packets):
    # 1. 규칙 사전검사
    precheck_issues = _precheck(scene_index, packet, entity_log, validated_log)
    # - evidence_pid가 씬 범위 밖인지 확인
    # - onstage_cast가 scene_cast_union에 있는지 확인
    # - actual_place가 mentioned_places에 포함되어 있는지 확인

    # 2. LLM 검증
    result = llm_client.validate_scene_index({
        "scene_id": scene_index.scene_id,
        "start_pid": packet.start_pid,
        "end_pid": packet.end_pid,
        "entity_registry_json": format_json_param(packet.entity_registry),
        "start_state_json": format_json_param(packet.start_state),
        "end_state_json": format_json_param(packet.end_state),
        "scene_text": packet.scene_text_with_pid_markers,
        "scene_index_json": format_json_param(scene_index.model_dump()),
        "precheck_issues_json": format_json_param(precheck_issues),
    })
    validated.append(GroundedSceneEntry(**result))
```

### 규칙 사전검사 항목

1. `evidence_pids` 범위 확인: `start_pid <= pid <= end_pid` 아닌 것 플래그
2. `onstage_cast` vs `scene_cast_union` 불일치 확인
3. `actual_place` vs `current_places` 혼동 확인 (mentioned_place를 actual로 잘못 설정)

### LLM 입력 (`scene3_scene_validate.txt`)

- `scene_id`, `start_pid`, `end_pid`
- `entity_registry_json`: canonical_name → entity_id
- `start_state_json`, `end_state_json`
- `scene_text`: `[P{pid}] text` 형식
- `scene_index_json`: SCENE.2 결과
- `precheck_issues_json`: 사전검사 이슈 목록

### LLM 출력

```json
{
  "scene_id": "scene_01",
  "validated_scene_index": { /* SceneIndex 구조와 동일, 수정된 버전 */ },
  "dropped_items": [
    { "field": "main_actions", "item": {...}, "reason": "no evidence in scene text" }
  ],
  "downgraded_items": [
    { "field": "onstage_cast", "item": {...}, "from_label": "explicit", "to_label": "weak_inference", "reason": "..." }
  ],
  "merged_items": [...],
  "validation_notes": ["Cast X was mentioned but not onstage"]
}
```

### run_id 패턴

`f"scene_validated__{doc_id}__{chapter_id}"`
