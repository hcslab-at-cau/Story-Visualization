# Pipeline: SUB.1, SUB.2, SUB.3, SUB.4

SCENE.3 이후 선택적 분기. 독자 개입 UI 구축을 위한 서브씬 분석.

---

## SUB.1 — Subscene Proposal (`subscene_proposal.py`)

### 역할

씬 내부의 서브씬 경계 후보 제안. LLM 호출.

### 함수 시그니처

```python
def run_subscene_proposal(
    validated_log: GroundedSceneModel,   # SCENE.3 출력
    packet_log: ScenePackets,            # SCENE.1 출력
    llm_client: Any,
    doc_id: str,
    chapter_id: str,
    on_progress: Optional[Callable[[str], None]] = None,
    parents: Optional[Dict[str, str]] = None,
) -> SubsceneProposals
```

### 처리 흐름

```python
for entry, packet in zip(validated_log.validated, packet_log.packets):
    scene_index = entry.validated_scene_index

    result = llm_client.propose_subscenes({
        "scene_id": packet.scene_id,
        "start_pid": packet.start_pid,
        "end_pid": packet.end_pid,
        "scene_text": packet.scene_text_with_pid_markers,
        "current_places_json": format_json_param(packet.scene_current_places),
        "start_state_json": format_json_param(packet.start_state),
        "end_state_json": format_json_param(packet.end_state),
        "onstage_cast_json": format_json_param(scene_index.get("onstage_cast", [])),
        "main_actions_json": format_json_param(scene_index.get("main_actions", [])),
        "goals_json": format_json_param(scene_index.get("goals", [])),
        "objects_json": format_json_param(scene_index.get("objects", [])),
        "scene_summary": scene_index.get("scene_summary", ""),
    })
    packets.append(SubsceneProposalItem(scene_id=packet.scene_id, candidate_subscenes=result["candidates"]))
```

### LLM 입력 (`sub1_subscene_proposal.txt`)

씬 전체 텍스트, 시작/종료 상태, cast/place/action/goal/object 정보

### LLM 출력

```json
{
  "candidates": [
    {
      "candidate_id": "scene_01_cand_01",
      "scene_id": "scene_01",
      "start_pid": 0,
      "end_pid": 5,
      "label": "approach",
      "shift_type": "action_mode_shift",
      "boundary_reason": "Alice transitions from passive observation to active pursuit",
      "trigger_event": "the White Rabbit checks his watch",
      "local_focus": "Alice's curiosity about the rabbit",
      "confidence": 0.85,
      "evidence": ["[P3] She had never before seen a rabbit with a watch."]
    }
  ]
}
```

### shift_type 값

`action_mode_shift | goal_update | problem_change | cast_focus_shift | time_skip | ...`

### run_id 패턴

`f"subscene_proposal__{doc_id}__{chapter_id}"`

---

## SUB.2 — Subscene State Extraction (`subscene_state.py`)

### 역할

각 서브씬 후보의 지역 서사 상태 기록. LLM 호출.

### 함수 시그니처

```python
def run_subscene_state_extraction(
    proposal_log: SubsceneProposals,
    packet_log: ScenePackets,
    validated_log: GroundedSceneModel,
    llm_client: Any,
    doc_id: str,
    chapter_id: str,
    on_progress: Optional[Callable[[str], None]] = None,
    parents: Optional[Dict[str, str]] = None,
) -> SubsceneStates
```

### 처리 흐름

```python
for proposal_item, packet, entry in zip(...):
    result = llm_client.extract_subscene_state({
        "scene_id": packet.scene_id,
        "start_pid": packet.start_pid,
        "end_pid": packet.end_pid,
        "scene_text": packet.scene_text_with_pid_markers,
        "scene_summary": scene_index.get("scene_summary", ""),
        "start_state_json": format_json_param(packet.start_state),
        "end_state_json": format_json_param(packet.end_state),
        "onstage_cast_json": format_json_param(scene_index.get("onstage_cast", [])),
        "current_places_json": format_json_param(packet.scene_current_places),
        "candidates_json": format_json_param(proposal_item.candidate_subscenes),
    })
    packets.append(SubsceneStateItem(scene_id=..., records=result["records"]))
```

### LLM 입력 (`sub2_subscene_state.txt`)

씬 전체 정보 + SUB.1 후보 목록

### LLM 출력

```json
{
  "records": [
    {
      "candidate_id": "scene_01_cand_01",
      "scene_id": "scene_01",
      "start_pid": 0,
      "end_pid": 5,
      "label": "approach",
      "local_goal": "Alice wants to follow the rabbit",
      "action_summary": "Alice spots the rabbit and begins following it",
      "action_mode": "pursuit",
      "active_cast": ["Alice", "White Rabbit"],
      "key_objects": ["pocket watch", "waistcoat"],
      "problem_state": "Alice doesn't know where the rabbit is going",
      "emotional_tone": "curious, excited",
      "causal_input": "Alice sees a rabbit with a watch",
      "causal_result": "Alice decides to follow the rabbit",
      "narrative_importance": "Inciting incident for the entire story",
      "evidence": ["[P2] ..."]
    }
  ]
}
```

### run_id 패턴

`f"subscene_state__{doc_id}__{chapter_id}"`

---

## SUB.3 — Subscene Validation (`subscene_validation.py`)

### 역할

SUB.1 후보 + SUB.2 상태 → 병합/거부/수락으로 안정적 서브씬 단위 구성. LLM 호출.

### 함수 시그니처

```python
def run_subscene_validation(
    proposal_log: SubsceneProposals,
    state_log: SubsceneStates,
    packet_log: ScenePackets,
    validated_log: GroundedSceneModel,
    llm_client: Any,
    doc_id: str,
    chapter_id: str,
    on_progress: Optional[Callable[[str], None]] = None,
    parents: Optional[Dict[str, str]] = None,
) -> ValidatedSubscenes
```

### 처리 흐름

```python
for proposal_item, state_item, packet in zip(...):
    result = llm_client.validate_subscenes({
        "scene_id": packet.scene_id,
        "start_pid": packet.start_pid,
        "end_pid": packet.end_pid,
        "scene_text": packet.scene_text_with_pid_markers,
        "scene_summary": scene_index.get("scene_summary", ""),
        "start_state_json": format_json_param(packet.start_state),
        "end_state_json": format_json_param(packet.end_state),
        "onstage_cast_json": format_json_param(scene_index.get("onstage_cast", [])),
        "candidates_json": format_json_param(proposal_item.candidate_subscenes),
        "state_records_json": format_json_param(state_item.records),
    })
```

### LLM 입력 (`sub3_subscene_validation.txt`)

씬 정보 + SUB.1 후보 + SUB.2 상태 레코드

### LLM 출력

```json
{
  "validated_subscenes": [
    {
      "subscene_id": "scene_03_sub_01",
      "start_pid": 0,
      "end_pid": 5,
      "label": "approach",
      "headline": "Alice spots the peculiar rabbit",
      "action_mode": "observation",
      "local_goal": "Alice wants to follow the rabbit",
      "action_summary": "Alice sees rabbit with pocket watch",
      "problem_state": "Alice doesn't know why rabbit has a watch",
      "causal_input": "Alice sitting bored by the river",
      "causal_result": "Alice decides to follow the rabbit",
      "emotional_tone": "curious",
      "narrative_importance": "Inciting incident",
      "active_cast": ["Alice", "White Rabbit"],
      "key_objects": ["pocket watch"],
      "decision": "accepted",
      "source_candidates": ["scene_01_cand_01"],
      "validation_notes": [],
      "confidence": 0.9
    }
  ],
  "original_count": 3,
  "accepted_count": 2,
  "merged_count": 1,
  "rejected_count": 0
}
```

### decision 값

`accepted | merged | rejected`

### subscene_id 패턴

`f"{scene_id}_sub_{n:02d}"` (LLM이 생성)

### run_id 패턴

`f"subscene_validated__{doc_id}__{chapter_id}"`

---

## SUB.4 — Intervention Packaging (`intervention_packaging.py`)

### 역할

검증된 서브씬 → 독자 대면 UI 단위 (버튼, 팝오버 텍스트). LLM 호출.

### 함수 시그니처

```python
def run_intervention_packaging(
    validation_log: ValidatedSubscenes,
    packet_log: ScenePackets,
    validated_scene_log: GroundedSceneModel,
    llm_client: Any,
    doc_id: str,
    chapter_id: str,
    on_progress: Optional[Callable[[str], None]] = None,
    parents: Optional[Dict[str, str]] = None,
) -> InterventionPackages
```

### 처리 흐름

```python
for val_item, packet, entry in zip(...):
    scene_index = entry.validated_scene_index

    # 이전 씬 종료 상태 (next_scene context용)
    prev_packet = packet_log.packets[idx - 1] if idx > 0 else None
    prev_end_state = prev_packet.end_state if prev_packet else {}

    result = llm_client.package_interventions({
        "scene_id": packet.scene_id,
        "scene_summary": scene_index.get("scene_summary", ""),
        "onstage_cast_json": format_json_param(scene_index.get("onstage_cast", [])),
        "prev_end_state_json": format_json_param(prev_end_state),
        "subscenes_json": format_json_param(val_item.validated_subscenes),
    })
    packets.append(InterventionPackageItem(scene_id=..., subscene_ui_units=result["units"]))
```

### LLM 입력 (`sub4_intervention_packaging.txt`)

씬 요약, onstage cast, 이전 씬 종료 상태, 검증된 서브씬 목록

### LLM 출력

```json
{
  "units": [
    {
      "subscene_id": "scene_03_sub_01",
      "title": "The Peculiar Rabbit",
      "one_line_summary": "Alice spots a rabbit with a pocket watch and follows it",
      "cast_buttons": [
        {
          "name": "Alice",
          "role": "curious observer",
          "reveal": "Alice is bored and intrigued by the unusual sight"
        },
        {
          "name": "White Rabbit",
          "role": "mysterious figure",
          "reveal": "The rabbit seems to be in a great hurry for unknown reasons"
        }
      ],
      "info_buttons": [
        {
          "label": "What happens next",
          "button_type": "what_changed",
          "reveal": "Alice decides to follow the rabbit down the hole"
        },
        {
          "label": "Why it matters",
          "button_type": "why_matters",
          "reveal": "This is the inciting incident that sets the whole story in motion"
        }
      ],
      "priority": 0.9,
      "jump_targets": ["scene_03_sub_02"]
    }
  ]
}
```

### button_type 값

`action | event | goal | problem | object | why_matters | what_changed`

### run_id 패턴

`f"intervention_packages__{doc_id}__{chapter_id}"`
