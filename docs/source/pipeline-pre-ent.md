# Pipeline: PRE.1, PRE.2, ENT.1, ENT.2, ENT.3

---

## PRE.1 — EPUB → RawChapter JSON (`epub.py` + `io.py`)

### 역할

EPUB에서 챕터를 추출하고, 각 챕터를 `RawChapter` JSON 구조로 정규화.
Next.js 이관에서는 업로드 시 chapter-level `raw`로 저장된 결과를 현재 `run`에 기록하는 시작 단계로 사용.

### 관련 문서

- EPUB 파싱: `docs/source/infra.md`의 `EPUB Parser`
- 저장/I/O: `docs/source/infra.md`의 `I/O`

### 출력 핵심

- `doc_id`
- `chapter_id`
- `title`
- `text`
- `paragraphs[{ pid, start, end, text }]`

---

## PRE.2 — Content Classification (`content_classify.py`)

### 역할

각 단락을 내러티브/비내러티브로 분류.
이후 모든 Stage는 `is_story_text=True`인 단락만 처리.

### 함수 시그니처

```python
def run_content_classification(
    chapter: RawChapter,
    llm_client: Any,
    doc_id: str,
    chapter_id: str,
    on_progress: Optional[Callable[[str], None]] = None,
    parents: Optional[Dict[str, str]] = None,
) -> ContentUnits
```

### 처리 흐름

1. `format_paragraphs_for_llm(chapter)` → `[P{pid}] text` 형식으로 포맷
2. `llm_client.classify_content({"buffer_sentences": paragraphs_json})` 호출
3. 응답에서 `units` 파싱 → `ContentUnit[]`

### LLM 입력 (`pre1_content_classify.txt`)

- `buffer_sentences`: 단락 리스트 JSON

### LLM 출력

```json
{
  "units": [
    { "pid": 0, "content_type": "chapter_heading", "is_story_text": false },
    { "pid": 1, "content_type": "narrative", "is_story_text": true }
  ]
}
```

### content_type 값

`front_matter | toc | chapter_heading | section_heading | epigraph | narrative | non_narrative_other`

### run_id 패턴

`f"classify__{doc_id}__{chapter_id}"`

---

## ENT.1 — Mention Extraction (`mention_extraction.py`)

### 역할

텍스트에서 cast(등장인물), place(장소), time(시간) 멘션 후보 추출.
LLM 경로만 사용 (NLP/spaCy 경로 제거).

### 함수 시그니처

```python
def run_llm_mention_extraction(
    chapter: RawChapter,
    llm_client: Any,
    doc_id: str,
    chapter_id: str,
    classify_log: ContentUnits,
    on_progress: Optional[Callable[[str], None]] = None,
    parents: Optional[Dict[str, str]] = None,
) -> MentionCandidates
```

### 처리 흐름

1. `classify_log`에서 `is_story_text=True`인 pid 목록 추출
2. `format_paragraphs_for_llm(chapter, narrative_pids)` → 서사 단락만 포맷
3. `llm_client.extract_mentions({"chapter_text_with_pids": text})` 호출
4. 응답에서 `mentions` 파싱 → `Mention[]`

### LLM 입력 (`ent1_mention_extract.txt`)

- `chapter_text_with_pids`: `[P0] text\n[P1] text ...` 형식

### LLM 출력

```json
{
  "mentions": [
    { "mention_id": "ch01_m001", "pid": 1, "span": "Alice", "mention_type": "cast", "normalized": "Alice" },
    { "mention_id": "ch01_m002", "pid": 1, "span": "the garden", "mention_type": "place", "normalized": "garden" }
  ]
}
```

### mention_id 패턴

`f"{chapter_id}_m{n:03d}"` (LLM이 생성, 검증 필요)

### run_id 패턴

`f"mentions_llm__{doc_id}__{chapter_id}"`

---

## ENT.2 — Mention Validation (`mention_validation.py`)

### 역할

ENT.1에서 추출된 멘션 후보의 거짓양성 필터링.

### 함수 시그니처

```python
def run_llm_mention_validation(
    chapter: RawChapter,
    mention_log: MentionCandidates,
    llm_client: Any,
    doc_id: str,
    chapter_id: str,
    on_progress: Optional[Callable[[str], None]] = None,
    parents: Optional[Dict[str, str]] = None,
) -> FilteredMentions
```

### 처리 흐름

1. 단락을 **배치 크기 20**으로 나눔
2. 각 배치에 대해 해당 단락들 + 그 단락의 멘션들을 추출
3. `llm_client.validate_mentions({"paragraphs_json": ..., "mentions_json": ...})` 호출
4. 각 배치 결과를 합쳐 `ValidatedMention[]` 구성

### LLM 입력 (`ent2_mention_validate.txt`)

- `paragraphs_json`: 배치 단락 JSON
- `mentions_json`: 해당 단락의 멘션 후보 JSON

### LLM 출력

```json
{
  "validated": [
    { "mention_id": "ch01_m001", "valid": true },
    { "mention_id": "ch01_m003", "valid": false, "reason": "not a place name" }
  ]
}
```

### run_id 패턴

`f"validated_llm__{doc_id}__{chapter_id}"`

### 보조 메서드

`FilteredMentions.to_filtered_candidates()` → `valid=True`인 멘션만 모아 `MentionCandidates` 반환

---

## ENT.3 — Entity Resolution (`entity_resolution.py`)

### 역할

멘션 클러스터링 + 대명사 해소. 규칙 기반(2A) 또는 LLM 보조(2B).

### 대명사 목록 (cast만 적용)

```python
_CAST_PRONOUNS = frozenset([
    "i", "me", "my", "myself",
    "you", "your", "yourself",
    "he", "him", "his", "himself",
    "she", "her", "hers", "herself",
    "we", "us", "our", "ourselves",
    "they", "them", "their", "theirs", "themselves"
])
```

### 규칙 기반 클러스터링 알고리즘 (`run_rule_entity_resolution`)

```python
def _normalize(span: str) -> str:
    # 소문자 + 앞의 the/a/an 제거
    return re.sub(r"^(the|a|an)\s+", "", span.strip()).lower().strip()

def _similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()  # Python difflib

def _cluster_mentions(mentions, is_cast):
    clusters = []
    unresolved = []
    for m in mentions:
        norm = _normalize(m.span)
        if is_cast and norm in _CAST_PRONOUNS:
            unresolved.append(m)  # 대명사 → unresolved
            continue
        # 클러스터 매칭
        matched = None
        for cluster in clusters:
            if norm == cluster["name"]: matched = cluster; break
            if len(norm) > 4 and _similarity(norm, cluster["name"]) > 0.8:
                matched = cluster; break
        if matched:
            matched["members"].append(m)
            matched["raw_spans"].append(m.span)
        else:
            clusters.append({"name": norm, "raw_spans": [m.span], "members": [m]})
    return clusters, unresolved

# Canonical name: 클러스터 내 최장 비대명사 스팬
def _select_canonical(spans):
    non_pronoun = [s for s in spans if _normalize(s) not in _CAST_PRONOUNS]
    return max(non_pronoun or spans, key=len)
```

### entity_id 패턴

`f"{mention_type}_{counter:03d}"` → e.g., `cast_001`, `place_003`

### LLM 기반 (`run_llm_entity_resolution`)

```python
def run_llm_entity_resolution(mention_log, chapter, llm_client, ...):
    # Step 1: 규칙 기반 먼저 실행
    rule_result = run_rule_entity_resolution(mention_log, ...)

    if not rule_result.unresolved_mentions:
        return rule_result  # 대명사 없으면 규칙 결과 반환

    # Step 2: LLM 호출
    result = llm_client.resolve_entities({
        "chapter_text": "[P0] text\n[P1] text ...",
        "entities_json": [...],      # entity_id, canonical_name, spans
        "unresolved_json": [...]     # mention_id, pid, span
    })

    # Step 3a: 대명사 해소 적용
    resolutions = result["resolutions"]  # [{mention_id, entity_id}]
    # → 각 mention을 entity에 추가

    # Step 3b: 별명 병합 (옵셔널)
    merges = result["merges"]  # [{keep: entity_id, absorb: entity_id}]
    # → absorb 엔티티를 keep에 합치고 삭제
```

### LLM 입력 (`ent3_entity_resolve.txt`)

- `chapter_text`: 전체 챕터 `[P{pid}] text` 형식
- `entities_json`: 현재 entity 클러스터
- `unresolved_json`: 미해소 대명사 목록

### LLM 출력

```json
{
  "resolutions": [
    { "mention_id": "ch01_m015", "entity_id": "cast_001" }
  ],
  "merges": [
    { "keep": "cast_001", "absorb": "cast_005" }
  ]
}
```

### run_id 패턴

- 규칙: `f"entities_rule__{doc_id}__{chapter_id}"`
- LLM: `f"entities_llm__{doc_id}__{chapter_id}"`
