# Infrastructure: LLM Client, Prompt Loader, EPUB, I/O

Story-Decomposition의 인프라 레이어 전체 코드 문서.
Next.js 이식 시 이 문서만 참조해 구현할 것.

---

## 1. LLM Client (`src/viewer/llm_client.py`)

### 개요

OpenRouter (OpenAI-compatible) API를 통해 모든 LLM 호출을 일원화.
`temperature=0.0`, JSON-only 응답 강제, 지수 백오프 재시도.

### 클래스 구조

```python
class OpenRouterLLMClient:
    OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

    def __init__(self, model: str, api_key: str, api_base: Optional[str] = None, max_tokens: int = 16384):
        self.model = model
        self.max_tokens = max_tokens
        self.client = OpenAI(api_key=api_key, base_url=api_base or OPENROUTER_BASE_URL)
        self.prompt_loader = PromptLoader()
        self.prompt_names = {
            "content_classify": "pre1_content_classify",
            "mention_extract":   "ent1_mention_extract",
            "mention_validate":  "ent2_mention_validate",
            "entity_resolve":    "ent3_entity_resolve",
            "state_validate":    "state2_state_validate",
            "scene_index":       "scene2_scene_index",
            "scene_validate":    "scene3_scene_validate",
            "semantic_clarification": "vis1_semantic_clarification",
            "image_support":     "vis2_image_support",
            "subscene_proposal": "sub1_subscene_proposal",
            "subscene_state":    "sub2_subscene_state",
            "subscene_validation":"sub3_subscene_validation",
            "intervention_packaging":"sub4_intervention_packaging",
            "scene_titles":      "state3_scene_titles",
        }
```

### `_call_json` 핵심 로직

```python
def _call_json(self, prompt: str, max_retries: int = 1) -> Dict:
    kwargs = {
        "model": self.model,
        "temperature": 0.0,
        "max_tokens": self.max_tokens,
        "messages": [
            {"role": "system", "content": "Return ONLY valid JSON. Do not wrap in markdown code blocks."},
            {"role": "user", "content": prompt},
        ],
    }
    # response_format json_object: OpenAI/Mistral/LLaMA/xAI 계열만 지원
    _openai_compat = ("openai/", "mistral/", "meta-llama/", "x-ai/")
    if any(self.model.startswith(p) for p in _openai_compat):
        kwargs["response_format"] = {"type": "json_object"}

    for attempt in range(max_retries):
        if attempt > 0:
            time.sleep(2 ** attempt)  # 지수 백오프: 2s, 4s
        try:
            chat = client.chat.completions.create(**kwargs)
            content = chat.choices[0].message.content.strip()

            # markdown fence 제거 (Claude가 가끔 추가)
            if content.startswith("```"):
                lines = content.splitlines()
                content = "\n".join(lines[1:-1 if lines[-1] == "```" else len(lines)]).strip()

            # JSON 파싱 시도
            try:
                return json.loads(content)
            except json.JSONDecodeError:
                # 1차: json_repair 라이브러리
                repaired = repair_json(content)
                # 2차: 수동 이스케이프 (_repair_json)
                return json.loads(repaired)
        except Exception as e:
            last_exc = e

    raise last_exc
```

### `_repair_json` (수동 JSON 복구)

리터럴 개행/탭을 이스케이프 처리. Gemini 모델에서 자주 발생.

```python
def _repair_json(content: str) -> str:
    # 문자열 내부의 \n, \r, \t를 \\n, \\r, \\t로 변환
    in_string = False; escaped = False
    for ch in content:
        if escaped: escaped = False
        elif ch == "\\" and in_string: escaped = True
        elif ch == '"': in_string = not in_string
        elif in_string and ch == "\n": append "\\n"
        elif in_string and ch == "\r": append "\\r"
        elif in_string and ch == "\t": append "\\t"
```

### 메서드별 페이로드

| 메서드 | 프롬프트 파라미터 |
|--------|-----------------|
| `classify_content` | `paragraphs_json` (JSON) |
| `extract_mentions` | `chapter_text_with_pids` |
| `validate_mentions` | `paragraphs_json`, `mentions_json` |
| `resolve_entities` | `chapter_text`, `entities_json`, `unresolved_json` |
| `validate_state` | `entity_inventory_json`, `chapter_text_with_pids`, `proposed_frames_json` |
| `validate_scene_index` | `scene_id`, `start_pid`, `end_pid`, `entity_registry_json`, `start_state_json`, `end_state_json`, `scene_text`, `scene_index_json`, `precheck_issues_json` |
| `extract_semantic_clarification` | `scene_id`, `start_pid`, `end_pid`, `scene_text`, `current_places_json`, `environment_json`, `start_state_json`, `onstage_cast_json` |
| `extract_image_support` | `scene_id`, `start_pid`, `end_pid`, `start_state_json`, `end_state_json`, `scene_text`, `onstage_cast_json`, `current_places_json`, `mentioned_places_json`, `objects_json`, `environment_json`, `goals_json`, `grounded_scene_description`, `ambiguity_resolutions_json` |
| `propose_subscenes` | `scene_id`, `start_pid`, `end_pid`, `scene_text`, `current_places_json`, `start_state_json`, `end_state_json`, `onstage_cast_json`, `main_actions_json`, `goals_json`, `objects_json`, `scene_summary` |
| `extract_subscene_state` | `scene_id`, `start_pid`, `end_pid`, `scene_text`, `scene_summary`, `start_state_json`, `end_state_json`, `onstage_cast_json`, `current_places_json`, `candidates_json` |
| `validate_subscenes` | `scene_id`, `start_pid`, `end_pid`, `scene_text`, `scene_summary`, `start_state_json`, `end_state_json`, `onstage_cast_json`, `candidates_json`, `state_records_json` |
| `package_interventions` | `scene_id`, `scene_summary`, `onstage_cast_json`, `prev_end_state_json`, `subscenes_json` |
| `extract_scene_index` | `scene_id`, `start_pid`, `end_pid`, `start_state_json`, `end_state_json`, `cast_union`, `current_places`, `mentioned_places`, `time_signals`, `scene_text` |
| `generate_scene_titles` | `scenes_json` |

### TS 이식 노트

```typescript
// lib/llm-client.ts
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

// openai npm 패키지 사용 (API 동일)
import OpenAI from "openai"

class LLMClient {
  private client: OpenAI
  private promptLoader: PromptLoader

  constructor(model: string, apiKey: string, apiBase?: string, maxTokens = 16384) {
    this.client = new OpenAI({ apiKey, baseURL: apiBase ?? OPENROUTER_BASE_URL })
  }

  private async callJson(prompt: string, maxRetries = 1): Promise<Record<string, unknown>> {
    const isOpenAICompat = /^(openai|mistral|meta-llama|x-ai)\//.test(this.model)
    // ... 동일 로직
  }
}
```

---

## 2. Prompt Loader (`src/viewer/prompt_loader.py`)

### 개요

`prompts/` 디렉토리의 `.txt` 파일을 로드해 `{param_name}` 플레이스홀더를 치환.

### 전체 코드

```python
class PromptLoader:
    def __init__(self, prompts_dir: Path | None = None):
        # 기본값: 프로젝트 루트 / prompts/
        self.prompts_dir = Path(prompts_dir) if prompts_dir else project_root / "prompts"

    def load(self, template_name: str, params: Dict | None = None) -> str:
        template = (self.prompts_dir / f"{template_name}.txt").read_text(encoding="utf-8")
        return template.format(**params) if params else template

    def load_raw(self, template_name: str) -> str:
        return (self.prompts_dir / f"{template_name}.txt").read_text(encoding="utf-8")

    def list_templates(self) -> list[str]:
        return [p.stem for p in self.prompts_dir.glob("*.txt")]

def format_json_param(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=2)
```

### 프롬프트 파일 목록 (prompts/ 디렉토리)

| 파일명 | Stage |
|--------|-------|
| `pre1_content_classify.txt` | PRE.2 |
| `ent1_mention_extract.txt` | ENT.1 |
| `ent2_mention_validate.txt` | ENT.2 |
| `ent3_entity_resolve.txt` | ENT.3 |
| `state2_state_validate.txt` | STATE.2 |
| `state3_scene_titles.txt` | STATE.3 (post) |
| `scene2_scene_index.txt` | SCENE.2 |
| `scene3_scene_validate.txt` | SCENE.3 |
| `vis1_semantic_clarification.txt` | VIS.1 |
| `vis2_image_support.txt` | VIS.2 |
| `vis3_image_common.txt` | VIS.3 |
| `vis3_style_common.txt` | VIS.3 |
| `sub1_subscene_proposal.txt` | SUB.1 |
| `sub2_subscene_state.txt` | SUB.2 |
| `sub3_subscene_validation.txt` | SUB.3 |
| `sub4_intervention_packaging.txt` | SUB.4 |
| `final2_overlay_refinement.txt` | FINAL.2 |

### TS 이식 노트

```typescript
// lib/prompt-loader.ts
// Next.js: prompts/ 파일을 fs.readFileSync로 읽거나
// public/prompts/에 두고 fetch로 가져오거나
// 빌드 시 import 가능 (정적 파일)

import fs from "fs"
import path from "path"

export class PromptLoader {
  private promptsDir: string

  constructor(promptsDir?: string) {
    this.promptsDir = promptsDir ?? path.join(process.cwd(), "prompts")
  }

  load(templateName: string, params?: Record<string, string>): string {
    const template = fs.readFileSync(
      path.join(this.promptsDir, `${templateName}.txt`), "utf-8"
    )
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (_, key) => params[key] ?? `{${key}}`)
  }
}

export function formatJsonParam(obj: unknown): string {
  return JSON.stringify(obj, null, 2)
}
```

---

## 3. EPUB Parser (`src/viewer/epub.py`)

### 개요

EPUB 파일 → `RawChapter[]` 변환 파이프라인.
TOC 기반 → Spine 기반 → Heading 기반 순으로 폴백.

### 주요 함수

#### `html_to_paragraphs(html: str) → List[str]`

HTML → 단락 문자열 리스트. 3단계 폴백:

```python
BLOCK_TAGS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'pre', 'figcaption']

def html_to_paragraphs(html: str) -> List[str]:
    soup = BeautifulSoup(html, 'html.parser')
    # script/style/nav/head 제거
    body = soup.find('body') or soup

    # Pass 1: leaf block 요소 (중첩 block 없는 것)
    for elem in body.find_all(BLOCK_TAGS):
        if elem.find(BLOCK_TAGS): continue  # 컨테이너 skip
        text = elem.get_text(separator=' ', strip=True)
        text = ' '.join(text.split())  # 공백 정규화
        if text and len(text) > 1: yield text

    # Pass 2: leaf <div> (Pass 1이 없을 때)
    # Pass 3: 줄바꿈으로 split (최후 수단)
```

#### `epub_to_chapter_candidates(epub_path: str) → List[RawChapterCandidate]`

```python
def epub_to_chapter_candidates(epub_path):
    book = epub.read_epub(epub_path)
    spine_docs = _get_spine_documents(book)   # 읽기 순서대로 SpineDocument[]

    # Strategy 1: TOC 기반 (가장 정확)
    toc_entries = _extract_toc_entries(book)  # TOCEntry[]
    if toc_entries:
        candidates = _chapters_from_toc(toc_entries, spine_docs)
        if candidates: return candidates

    # Strategy 2: Spine 기반 (1 doc = 1 chapter)
    candidates = _chapters_from_spine(spine_docs)
    if candidates: return candidates

    # Strategy 3: Heading 기반 (h1/h2로 분할)
    return _chapters_from_headings(spine_docs)
```

#### `normalize_chapters(candidates, doc_id, min_chars=500, max_chars=30000) → List[RawChapter]`

```python
def normalize_chapters(candidates, doc_id, min_chapter_chars=500, max_chapter_chars=30000):
    # Phase 1: 짧은 챕터 병합 (< min_chars → 이전 챕터에 흡수)
    merged = _merge_short_chapters(candidates, min_chapter_chars)

    # Phase 2: 긴 챕터 분할 (> max_chars → 단락 경계에서 분할)
    split = []
    for cand in merged:
        if cand.text_length > max_chapter_chars:
            split.extend(_split_long_chapter(cand, max_chapter_chars))
        else:
            split.append(cand)

    # Phase 3: RawChapter 변환 (pid 할당: 0-indexed)
    return [_candidate_to_raw_chapter(cand, doc_id, f"ch{i+1:02d}") for i, cand in enumerate(split)]
```

#### `_candidate_to_raw_chapter` — Paragraph 변환

```python
def _candidate_to_raw_chapter(candidate, doc_id, chapter_id) -> RawChapter:
    paras = []
    current_pos = 0
    for idx, text in enumerate(candidate.paragraphs):
        start = current_pos
        end = current_pos + len(text)
        paras.append(Paragraph(pid=idx, start=start, end=end, text=text))
        current_pos = end + 1  # +1 for space separator
    return RawChapter(
        doc_id=doc_id, chapter_id=chapter_id,
        title=candidate.title, text=' '.join(candidate.paragraphs),
        paragraphs=paras,
        source=ChapterSource(type=candidate.source_type, ...)
    )
```

### TS 이식 노트

```typescript
// lib/epub.ts
// 사용 npm 패키지: epub2 (또는 epubjs)
// HTML 파싱: cheerio (BeautifulSoup 대체)
import { EPub } from "epub2"
import * as cheerio from "cheerio"

const BLOCK_TAGS = ["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "pre", "figcaption"]

function htmlToParagraphs(html: string): string[] {
  const $ = cheerio.load(html)
  $("script, style, nav, head").remove()
  const paragraphs: string[] = []
  // Pass 1: leaf block elements
  $(BLOCK_TAGS.join(",")).each((_, el) => {
    if ($(el).find(BLOCK_TAGS.join(",")).length > 0) return
    const text = $(el).text().replace(/\s+/g, " ").trim()
    if (text.length > 1) paragraphs.push(text)
  })
  return paragraphs
}
```

---

## 4. I/O (`src/viewer/io.py`)

### 파일명 컨벤션

```
data/raw/{doc_id}__{chapter_id}.json
```

### 주요 함수

```python
def load_raw_chapter(file_path: Path) -> Optional[RawChapter]:
    data = orjson.loads(file_path.read_bytes())
    return RawChapter(**data)

def save_raw_chapter(chapter: RawChapter, out_dir="data/raw", overwrite=False) -> str:
    filename = f"{chapter.doc_id}__{chapter.chapter_id}.json"
    # json.dump(data, f, indent=2, ensure_ascii=False)

def format_paragraphs_for_llm(chapter, narrative_pids=None) -> str:
    # [P{pid}] text 형식으로 LLM에 전달
    lines = [f"[P{p.pid}] {p.text}" for p in chapter.paragraphs
             if narrative_pids is None or p.pid in narrative_pids]
    return "\n".join(lines)
```

### Firebase 전환 노트

로컬 파일 I/O → Firestore로 전환:
- `load_raw_chapter` → `firestore.doc("documents/{docId}/chapters/{chapterId}").get()`
- `save_raw_chapter` → `firestore.doc(...).set()`
- `format_paragraphs_for_llm` → 동일 로직 TS로 포팅
