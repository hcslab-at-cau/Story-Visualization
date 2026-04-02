# Pipeline: STATE.1, STATE.2, STATE.3

---

## STATE.1 — State Tracking (`state_tracking.py`)

### 역할

해결된 엔티티 클러스터 → 단락별 상태 타임라인.
**완전 규칙 기반 (LLM 없음).**

### 함수 시그니처

```python
def run_state_tracking(
    entity_log: EntityGraph,
    chapter: RawChapter,
    doc_id: str,
    chapter_id: str,
    parents: Optional[Dict[str, str]] = None,
) -> StateFrames
```

### 처리 흐름 전체

```
1. _build_pid_index(entity_log)
   → pid_cast: {pid → set(entity_id)}  cast 관찰 인덱스
   → pid_place: {pid → set(entity_id)} place 관찰 인덱스
   → pid_time:  {pid → set(entity_id)} time 관찰 인덱스
   → spans: {(entity_id, pid) → [span_text]}

2. place_unique_pids: {entity_id → 고유 pid 수} (place score 보너스용)

3. 단락을 pid 순서로 순회:
   for pid in sorted_pids:
     cast_tracker.update(pid, obs_cast)
     place_tracker.update(pid, place_scores)
     time_signals = [spans for each obs_time entity]
     emit StateFrame(pid, observed, state, transitions)
```

### CastTracker (슬라이딩 윈도우)

```python
class _CastTracker:
    window = 2  # 이전 2 pid 내에 보인 cast는 active로 간주

    def update(self, pid, observed):
        for eid in observed: self.last_seen[eid] = pid

        curr_active = {eid for eid, last_pid in self.last_seen.items()
                       if pid - last_pid <= self.window}
        cast_enter = sorted(curr_active - self._prev_active)
        cast_exit_candidates = sorted(self._prev_active - curr_active)
        self._prev_active = curr_active
        return curr_active, cast_enter, cast_exit_candidates
```

### PlaceTracker (지속성 스코어 기반)

```python
class _PlaceTracker:
    SET_THRESHOLD = 2.0    # 최초 장소 설정에 필요한 점수
    SHIFT_THRESHOLD = 3.0  # 장소 변경에 필요한 점수

    def update(self, pid, score_map):
        # score_map이 비면 → carry_gap(=1) 내면 현재 장소 유지, 아니면 None
        if not score_map:
            if current_place and last_seen_pid and pid - last_seen_pid <= 1:
                return current_place, None, None
            return None, None, None

        best = max(score_map, key=lambda e: score_map[e])
        best_score = score_map[best]

        if current_place is None:
            if best_score >= SET_THRESHOLD:
                current_place = best; place_set = best
        elif best != current_place and best_score >= SHIFT_THRESHOLD:
            place_shift = PlaceShift(from=current_place, to=best)
            current_place = best
        # else: 같은 장소 유지
```

### Place Score 계산

```python
def _compute_place_scores(pid, observed_pids, place_unique_pids, spans, pid_to_text):
    for eid in observed_pids.get(pid, set()):
        score = 1.0                                  # 현재 pid에 관찰됨
        if eid in observed_pids.get(pid - 1, set()): score += 1.0  # 직전 pid에도 있음
        if eid in observed_pids.get(pid + 1, set()): score += 1.0  # 직후 pid에도 있음
        if place_unique_pids.get(eid, 0) >= 2:       score += 0.5  # 2개 이상 pid에 등장

        # 공간 전치사 패턴 매칭 (+1.0)
        # in/into/inside/through/at/to/from/near/outside/within/...
        text = pid_to_text.get(pid, "")
        for span in spans.get((eid, pid), []):
            if re.search(r"\b(in|into|at|to|from|near|...)\s+(the\s+)?{span}", text):
                score += 1.0; break

        scores[eid] = score
```

**공간 전치사 목록:** `in, into, inside, through, throughout, at, to, from, near, outside, within, under, over, on, across, along, around, beside, between, beyond, down, up`

### 출력 StateFrame 구조

```python
StateFrame(
    pid=pid,
    observed=ObservedEntities(cast=[...], place=[...], time=[...]),  # entity_id 목록
    state=ActiveState(
        active_cast=[...],       # entity_id 목록
        primary_place=str|None,  # entity_id
        current_time=None,       # v1에서 미구현
    ),
    transitions=Transitions(
        cast_enter=[...],
        cast_exit_candidates=[...],
        place_set=str|None,            # entity_id (최초 설정 시)
        place_shift=PlaceShift|None,   # {from, to} entity_id
        time_signals=[...],            # span 텍스트 목록
    ),
)
```

### run_id 패턴

`f"state_tracking__{doc_id}__{chapter_id}"`

---

## STATE.2 — State Validation (`state_validation.py`)

### 역할

STATE.1 결과를 LLM으로 검증/수정. entity_id → canonical_name 변환 후 전달.

### 함수 시그니처

```python
def run_state_validation(
    state_log: StateFrames,
    entity_log: EntityGraph,
    chapter: RawChapter,
    classify_log: ContentUnits,
    llm_client: Any,
    doc_id: str,
    chapter_id: str,
    parents: Optional[Dict[str, str]] = None,
) -> RefinedStateFrames
```

### 처리 흐름

```python
# entity_id → canonical_name 매핑
eid_to_name = {e.entity_id: e.canonical_name for e in entity_log.entities}

# entity 인벤토리 (LLM에 제공할 참고 목록)
entity_inventory = [
    {"entity_id": e.entity_id, "canonical_name": e.canonical_name, "type": e.mention_type}
    for e in entity_log.entities
]

# proposed_frames: STATE.1 결과를 canonical_name으로 변환
proposed_frames = [
    {
        "pid": f.pid,
        "is_narrative": f.is_narrative,  # classify_log에서 조회
        "proposed_state": {
            "current_place": eid_to_name.get(f.state.primary_place),
            "active_cast": [eid_to_name.get(c) for c in f.state.active_cast],
            ...
        }
    }
    for f in state_log.frames
]

# 단일 LLM 호출 (전체 챕터)
result = llm_client.validate_state({
    "entity_inventory_json": format_json_param(entity_inventory),
    "chapter_text_with_pids": format_paragraphs_for_llm(chapter),
    "proposed_frames_json": format_json_param(proposed_frames),
})
```

### LLM 입력 (`state2_state_validate.txt`)

- `entity_inventory_json`: 전체 엔티티 목록 (entity_id, canonical_name, type)
- `chapter_text_with_pids`: `[P{pid}] text` 형식
- `proposed_frames_json`: STATE.1 제안 프레임

### LLM 출력

```json
{
  "frames": [
    {
      "pid": 0,
      "is_narrative": false,
      "validated_state": {
        "current_place": "the garden",
        "mentioned_place": null,
        "active_cast": ["Alice"],
        "weak_exit_candidates": []
      },
      "actions": [
        {
          "field": "current_place",
          "proposed": "garden_001",
          "final": "the garden",
          "action": "accepted",
          "reason": "clearly established in context",
          "confidence": "high"
        }
      ]
    }
  ]
}
```

### action 타입

`accepted | carry_forward | rejected | corrected`

### run_id 패턴

`f"state_validated__{doc_id}__{chapter_id}"`

---

## STATE.3 — Boundary Detection (`boundary_detection.py`)

### 역할

검증된 상태 프레임 → 씬 경계 후보 + 최종 씬 스팬.
**완전 규칙 기반 (LLM은 선택적 제목 생성에만 사용).**

### 함수 시그니처

```python
def run_boundary_detection(
    validated_log: RefinedStateFrames,
    state_log: Optional[StateFrames] = None,     # time_signals 소스
    doc_id: str = "",
    chapter_id: str = "",
    parents: Optional[Dict[str, str]] = None,
    llm_client: Optional[Any] = None,            # 제목 생성용 (optional)
    paragraph_map: Optional[Dict[int, str]] = None,  # 제목 생성용
) -> SceneBoundaries
```

### 점수 가중치

```python
_SCORE_PLACE_SHIFT    = 4.0  # 장소가 다른 곳으로 바뀜
_SCORE_PLACE_SET_AFTER = 2.0  # 공백 후 새 장소 등장
_SCORE_TIME_SHIFT     = 3.0  # (미사용, 향후)
_SCORE_CAST_HIGH      = 2.0  # Jaccard delta >= 0.75, turnover >= 2
_SCORE_CAST_MED       = 1.0  # Jaccard delta >= 0.50, turnover >= 1
_SCORE_TIME_SIGNAL    = 1.0  # time_signals 있음

_LABEL_SCENE = 4.0           # score >= 4.0 → scene_boundary
_LABEL_WEAK  = 3.0           # score >= 3.0 → weak_boundary_candidate
_MIN_SCENE_LEN = 2           # 최소 씬 단락 수
```

### 경계 점수 계산 `_score_boundary`

```python
def _score_boundary(prev: ValidatedFrame, curr: ValidatedFrame, had_place_before, time_signals):
    score = 0.0
    reasons = []

    prev_place = prev.validated_state.current_place
    curr_place = curr.validated_state.current_place

    # Place shift: 둘 다 있고 다름
    if prev_place and curr_place and prev_place != curr_place:
        score += 4.0
        reasons.append(BoundaryReason(type="place_shift", from_place=prev_place, to_place=curr_place))

    # Place re-established: 이전이 None이고 이전에 장소가 있었음
    elif prev_place is None and curr_place and had_place_before:
        score += 2.0
        reasons.append(BoundaryReason(type="place_set_after_previous_place", to_place=curr_place))

    # Cast turnover (Jaccard)
    prev_cast = set(prev.validated_state.active_cast)
    curr_cast = set(curr.validated_state.active_cast)
    delta = 1.0 - len(prev_cast & curr_cast) / len(prev_cast | curr_cast) if prev_cast | curr_cast else 0.0
    turnover = len(prev_cast.symmetric_difference(curr_cast))

    if delta >= 0.75 and turnover >= 2: score += 2.0; reasons.append(...)
    elif delta >= 0.5 and turnover >= 1: score += 1.0; reasons.append(...)

    # Time signals
    if time_signals:
        score += 1.0
        reasons.append(BoundaryReason(type="time_signal", signals=time_signals))

    return reasons, score
```

### 포스트프로세싱

#### 1. 경쟁 경계 해소 `_resolve_competing`

```python
def _resolve_competing(candidates, proximity=1):
    # pid 거리가 1 이하인 경계는 점수 높은 것만 유지
    resolved = [candidates[0]]
    for cand in candidates[1:]:
        if cand.boundary_before_pid - resolved[-1].boundary_before_pid <= proximity:
            if cand.score > resolved[-1].score:
                resolved[-1] = cand  # 더 높은 점수로 교체
        else:
            resolved.append(cand)
    return resolved
```

#### 2. 최소 씬 길이 강제 `_enforce_min_scene_len`

```python
def _enforce_min_scene_len(boundary_pids, narrative_pids, score_by_pid, min_len=2):
    # 씬 길이 < min_len이면, 해당 씬의 낮은 점수 경계 제거 (반복)
    changed = True
    while changed:
        changed = False
        # 씬 구간 계산 후 짧은 씬 찾기
        for 각 씬:
            if scene_len < min_len:
                # 왼쪽/오른쪽 경계 중 점수 낮은 것 제거
                drop = 점수낮은_경계
                boundary_pids.remove(drop)
                changed = True; break
    return boundary_pids
```

### 전체 처리 흐름

```python
# 1. 서사 프레임만, pid 정렬
narrative_frames = sorted(
    [fr for fr in validated_log.frames if fr.is_narrative],
    key=lambda f: f.pid
)

# 2. 인접 프레임 쌍 비교 → 경계 후보
raw_candidates = []
for i in range(1, len(narrative_frames)):
    reasons, score = _score_boundary(narrative_frames[i-1], narrative_frames[i], ...)
    if score >= _LABEL_WEAK:
        raw_candidates.append(BoundaryCandidate(..., label="scene_boundary" if score >= 4.0 else "weak_..."))

# 3. 포스트프로세싱
resolved = _resolve_competing(raw_candidates, proximity=1)
scene_boundary_pids = [c.boundary_before_pid for c in resolved if c.label == "scene_boundary"]
final_boundary_pids = _enforce_min_scene_len(scene_boundary_pids, narrative_pids, score_by_pid)

# 4. 씬 스팬 생성
scene_starts = [narrative_pids[0]] + sorted(final_boundary_pids)
scenes = [SceneSpan(scene_id=f"scene_{i+1:02d}", start_pid=start, end_pid=end) ...]

# 5. (Optional) LLM 제목 생성
if llm_client:
    scene_context = _build_scene_context(scenes, narrative_frames, paragraph_map)
    raw = llm_client.generate_scene_titles({"scenes_json": json.dumps(scene_context)})
    scene_titles = raw.get("scene_titles", {})  # {scene_id: title}
```

### LLM 제목 생성 입력 (`state3_scene_titles.txt`)

각 씬의 context:
```json
[{
  "scene_id": "scene_01",
  "start_pid": 0, "end_pid": 15,
  "start_place": "the garden",
  "end_place": "the garden",
  "active_cast": ["Alice", "the White Rabbit"],
  "text_preview": "Alice was beginning to be very tired..."  // 첫 3 단락, 최대 400자
}]
```

### LLM 출력

```json
{ "scene_titles": { "scene_01": "The Garden Chase", "scene_02": "Down the Rabbit Hole" } }
```

### run_id 패턴

`f"boundary_detection__{doc_id}__{chapter_id}"`
