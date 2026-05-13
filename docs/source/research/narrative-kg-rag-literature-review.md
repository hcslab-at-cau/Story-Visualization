# Narrative KG/RAG 문헌 정리와 적용 아이디어

작성일: 2026-05-12

## 1. 목적

이 문서는 Narrative RAG, Narrative KG, GraphRAG, KG-RAG, long narrative benchmark 관련 논문을 현재 `Story-Visualization` 연구 방향에 맞춰 정리한다.

중심 질문은 다음이다.

```text
이 논문들이 긴 소설 이해를 위해 어떤 graph / memory / retrieval 아이디어를 제안하는가?
그리고 우리 NRG, BOOK.0, SUP.*, Support Governor에 무엇을 가져올 수 있는가?
```

현재 프로젝트의 핵심은 generic QA용 RAG가 아니다. 더 강한 framing은 다음이다.

```text
Reader-position-aware narrative graph와 cross-chapter memory를 이용해,
현재 독자의 situation model 복구에 필요한 support를
spoiler-safe, evidence-grounded, low-intrusion 방식으로 제공한다.
```

따라서 이 문서는 논문별 성능 숫자를 길게 나열하기보다, 우리 시스템에 직접 적용 가능한 설계 포인트를 중심으로 정리한다.

## 2. 전체 결론

가장 중요한 결론은 네 가지다.

1. Entity만 합친 KG는 narrative에 부족하다.
   - 긴 소설에서는 같은 인물도 시점, 사건, 상태, 관계가 계속 바뀐다.
   - E2RAG류의 핵심은 entity graph와 event graph를 분리하고, 그 사이를 연결하는 것이다.
   - 우리 NRG도 `entity`, `event`, `entity_state_at_position`, `relation_delta`, `thread`를 분리해야 한다.

2. Graph element는 반드시 evidence-grounded여야 한다.
   - GroundedKG-RAG와 STAGE 계열은 graph가 사람이 검토 가능한 근거를 가져야 downstream reasoning이 방어 가능하다는 점을 보여준다.
   - 우리도 모든 claim, node, edge에 `evidence_refs`, `source_pid`, `source_stage_id`, `source_run_id`, `confidence`, `grounding_score`를 강제해야 한다.

3. 긴 narrative 이해는 단발 retrieval이 아니라 stateful memory 문제다.
   - ComoRAG, LightRAG, long story generation 계열은 긴 문서에서 memory를 incremental하게 갱신하고 다시 검색하는 구조가 필요하다고 본다.
   - 우리 BOOK.0과 NRG.0도 chapter별 artifact 묶음이 아니라 reader position에 따라 갱신되고 잘리는 memory snapshot이 되어야 한다.

4. 우리 차별점은 answer generation이 아니라 show / defer / suppress decision이다.
   - 대부분 기존 연구는 QA, summarization, story generation을 목표로 한다.
   - 우리는 "정답을 생성하는가"보다 "현재 독자에게 이 support를 보여도 되는가"가 핵심이다.
   - 그래서 `reveal timing`, `spoiler risk`, `intrusion cost`, `reader_problem`, `trigger_preconditions`가 핵심 metadata다.

## 3. Narrative RAG / Narrative KG 논문

### 3.1 E2RAG / ChronoQA

논문:

- [Respecting Temporal-Causal Consistency: Entity-Event Knowledge Graphs for Retrieval-Augmented Generation](https://arxiv.org/abs/2506.05939)

제안 아이디어:

- 기존 RAG는 embedding similarity에 의존해 chronological structure를 놓친다.
- 기존 KG-RAG는 entity mention을 하나의 node로 collapse해서 "시간에 따라 달라지는 entity context"를 잃는다.
- 이를 해결하기 위해 entity graph와 event graph를 분리하고, bipartite mapping으로 연결하는 E2RAG를 제안한다.
- ChronoQA benchmark는 temporal, causal, character consistency를 RAG 조건에서 평가한다.

그들만의 포인트:

- "Napoleon" 같은 entity를 하나로 합치면 1804년의 Napoleon과 1815년의 Napoleon이 구분되지 않는다는 문제의식이 narrative에 정확히 맞다.
- entity 중심 KG보다 event-position-aware graph가 필요하다는 점을 강하게 보여준다.

얻은 인사이트:

- 우리 NRG에서 canonical entity는 필요하지만, reader support는 canonical entity만으로 만들면 안 된다.
- 현재 독자 위치의 Alice, 이전 장면의 Alice, 기억 속 Alice, 대화 속 Alice를 구분해야 한다.

적용 아이디어:

- `EntityNode`와 별도로 `EntityStateAtPosition`을 둔다.
- `EventCard`를 NRG의 1급 node로 만든다.
- `event -> participant_state`, `event -> causes -> event`, `event -> updates_relation -> relation_state` edge를 둔다.
- ChronoQA류의 temporal/causal/character consistency question을 offline benchmark로 사용한다.

### 3.2 ComoRAG

논문:

- [ComoRAG: A Cognitive-Inspired Memory-Organized RAG for Stateful Long Narrative Reasoning](https://arxiv.org/abs/2508.10419)

제안 아이디어:

- narrative reasoning은 one-shot retrieval이 아니라, 새 evidence acquisition과 past knowledge consolidation이 반복되는 과정이다.
- reasoning impasse를 만나면 probing query를 만들고, dynamic memory workspace에서 추가 evidence를 가져와 global memory pool에 통합한다.

그들만의 포인트:

- "retrieval once, answer once"가 아니라 "막힘을 감지하고 다시 찾는" cognitive loop를 제안한다.
- 긴 narrative에서 memory workspace가 계속 갱신되어야 한다는 점이 강하다.

얻은 인사이트:

- 우리 `/api/support-context`는 현재 scene 기준 context를 반환하지만, 아직 "독자가 무엇 때문에 막혔는가"를 충분히 반영하지 않는다.
- `reader_problem`별 probing query를 만들 수 있다.

적용 아이디어:

- `RET.1`을 단순 context API가 아니라 다음 흐름으로 확장한다.

```text
reader_position + reader_problem
  -> probing query generation
  -> NRG / BOOK.0 retrieval
  -> memory consolidation
  -> support candidate packet
```

- 예:
  - `character_reentry`: "이 인물이 마지막으로 등장했을 때 상태와 관계는 무엇이었나?"
  - `causal_gap`: "현재 사건을 가능하게 한 이전 사건은 무엇인가?"
  - `spatial_disorientation`: "현재 장소는 직전 장소와 어떻게 연결되는가?"

### 3.3 STAGE

논문:

- [STAGE: A Full-Screenplay Benchmark for Reasoning over Evolving Stories](https://arxiv.org/abs/2601.08510)

제안 아이디어:

- screenplay 전체에 대해 knowledge graph construction, scene-level event summarization, long-context QA, in-script role-playing을 함께 평가한다.
- 네 task가 shared narrative world representation을 기반으로 한다.

그들만의 포인트:

- KG construction을 독립 task로만 보지 않는다.
- 같은 story world representation이 event summary, QA, role-playing에 일관되게 쓰이는지를 본다.

얻은 인사이트:

- 우리 NRG도 "graph viewer에 보이는 구조"가 아니라 여러 downstream artifact가 공유하는 world representation이어야 한다.
- support card, memory panel, visual cue, QA baseline이 같은 graph에서 나와야 연구적으로 강하다.

적용 아이디어:

- 평가를 다음 네 축으로 나눈다.
  - NRG construction quality
  - scene/event summary consistency
  - reader-position QA or recall task
  - support usefulness / spoiler safety
- screenplay는 scene boundary가 명확하므로 SCENE/SUB pipeline 평가용 보조 데이터로 좋다.

### 3.4 GroundedKG-RAG

논문:

- [GROUNDEDKG-RAG: Grounded Knowledge Graph Index for Long-document Question Answering](https://arxiv.org/abs/2604.04359)

제안 아이디어:

- long-document QA에서 LLM-generated description에 의존하면 latency와 hallucination 문제가 커진다.
- GroundedKG는 entity와 action을 node로, temporal/semantic relation을 edge로 두며, node와 edge를 original sentence에 grounding한다.
- SRL과 AMR parse를 사용해 source-grounded graph를 만들고, query도 비슷하게 graph로 변환해 retrieval한다.

그들만의 포인트:

- graph 자체보다 "graph element가 원문 문장에 붙어 있다"는 점이 핵심이다.
- 사람이 읽고 audit할 수 있는 index를 지향한다.

얻은 인사이트:

- 우리 SUP/NRG에서 evidence ref는 있으면 좋은 필드가 아니라 필수 필드다.
- LLM이 만든 relation은 원문 paragraph highlight와 연결되지 않으면 독자-facing support로 쓰기 어렵다.

적용 아이디어:

- `NarrativeClaim`에 다음을 필수화한다.

```ts
interface NarrativeClaim {
  claim_id: string;
  claim_type: "state" | "event" | "relation" | "causal" | "place" | "goal";
  evidence_refs: SupportEvidenceRef[];
  support_level: "explicit" | "strong_inference" | "weak_inference";
  confidence: number;
  grounding_score: number;
  reveal_start: ReaderPosition;
  spoiler_risk: "none" | "low" | "medium" | "high";
  scope: "actual" | "memory" | "imagination" | "hypothetical" | "dialogue_claim" | "unreliable" | "metaphor";
}
```

- support card에서 "왜 이 support가 나왔는가"를 원문 paragraph anchor로 보여줄 수 있게 한다.

### 3.5 Enhanced Story Comprehension through Dynamic Document-Based KGs

논문:

- [Enhanced Story Comprehension for Large Language Models through Dynamic Document-Based Knowledge Graphs](https://ojs.aaai.org/index.php/AAAI/article/view/21286)

제안 아이디어:

- static commonsense KG가 아니라, 현재 처리 중인 story에서 추출한 document-specific dynamic KG를 사용한다.
- KG에서 relevant fact를 retrieval하고, 이를 natural language prompt로 verbalize해 LLM의 QA/story completion을 돕는다.

그들만의 포인트:

- story 자체의 내부 사실을 graph로 저장한다.
- graph fact를 그대로 쓰지 않고, LLM prompt에 넣기 좋은 문장으로 바꾼다.

얻은 인사이트:

- 우리 SUP.*는 raw graph를 독자에게 직접 보여주는 계층이 아니다.
- NRG claim을 reader-facing support prose로 바꾸는 verbalization 계층이 필요하다.

적용 아이디어:

- `SUP.1`을 "shared support context"가 아니라 `graph fact packet builder`로 재해석한다.
- `SUP.2`~`SUP.5`는 reader_problem별 verbalizer가 된다.
- `SUP.V`는 verbalized support가 source claim과 맞는지 검증한다.

### 3.6 Narrative Knowledge Weaver

논문:

- [Narrative Knowledge Weaver: A Multi-Agent Framework for Knowledge Graph Construction and Analysis from Complex Narratives](https://openreview.net/forum?id=P7KtWPDhRz)

주의:

- OpenReview 기준 ICLR 2026 desk rejected submission이다.
- 채택 논문은 아니므로 citation weight는 낮게 보고, architecture idea 참고용으로 쓰는 편이 안전하다.

제안 아이디어:

- adaptive schema induction, reflection-augmented extraction, normalization-before-merge pipeline을 사용한다.
- type refinement, scope convergence, LLM-guided disambiguation으로 narrative KG coherence를 높인다.
- raw event mention을 event card와 causally organized Event Plot Graph로 정리한다.
- fine-grained provenance를 저장하고 tool-augmented reasoning agent가 temporal, causal, structural query에 사용한다.

그들만의 포인트:

- schema를 고정하지 않고 narrative마다 적응한다.
- extraction보다 normalization-before-merge와 event-centric refinement를 강조한다.

얻은 인사이트:

- 우리 ENT.3/SUP.0 결과를 바로 document-level graph로 합치면 alias, scope, relation 중복 문제가 커질 수 있다.
- 먼저 normalize하고 merge해야 한다.

적용 아이디어:

- NRG.0 materializer를 다음 단계로 나눈다.

```text
schema seed
  -> claim extraction
  -> type refinement
  -> scope normalization
  -> entity/event disambiguation
  -> normalize-before-merge
  -> event plot graph construction
  -> provenance audit
```

### 3.7 HTEKG

논문:

- [HTEKG: A Human-Trait-Enhanced Literary Knowledge Graph with Language Model Evaluation](https://www.scitepress.org/PublishedPapers/2024/130136/)

제안 아이디어:

- 기존 literary KG는 event 중심이고 character information을 충분히 반영하지 못한다.
- HTEKG는 character traits, emotions, relational dynamics를 ontology에 포함한다.
- Cypher query, BERT classifier, GPT-4와 결합해 literary analysis에 활용한다.

그들만의 포인트:

- 인물을 단순 actor가 아니라 trait/emotion/relation을 가진 literary entity로 본다.

얻은 인사이트:

- 우리 character support는 "누가 등장했는가"에서 끝나면 약하다.
- 독자가 헷갈리는 것은 종종 인물의 goal, emotion, relation change다.

적용 아이디어:

- `EntityStateAtPosition`에 다음 필드를 추가 검토한다.
  - `goal`
  - `belief`
  - `emotion`
  - `trait_claims`
  - `relation_to_other_entities`
  - `support_level`
- 단, trait은 spoiler와 over-inference 위험이 크므로 `scope`와 `support_level`을 반드시 붙인다.

### 3.8 FAIR KG construction from fictional novels

논문:

- [FAIR Knowledge Graph construction from text, an approach applied to fictional novels](https://ceur-ws.org/Vol-3184/TEXT2KG_Paper_7.pdf)

제안 아이디어:

- unstructured narrative text에서 subject-predicate-object triple을 추출하고, RDF로 표현한다.
- DBpedia, Wikidata, WordNet 등 external OpenKG로 annotation, normalization, enrichment를 수행한다.
- FAIR 원칙에 맞게 findable, accessible, interoperable, reusable한 KG를 지향한다.

그들만의 포인트:

- narrative KG를 Semantic Web / RDF / Linked Open Data 관점에서 본다.
- 연구 artifact의 재사용성과 공개 가능성을 강조한다.

얻은 인사이트:

- 우리 NRG도 내부 Firestore 구조만 있으면 논문 기여로 설명하기 어렵다.
- schema, export format, provenance, reusable dataset view가 필요하다.

적용 아이디어:

- `NRG export`를 JSONL 또는 RDF-like triple 형태로 제공한다.
- 단, fiction 내부 사실과 외부 world KG를 섞을 때는 조심해야 한다.
  - Alice라는 character를 real-world entity로 link하면 잘못된 grounding이 생길 수 있다.
  - external KG는 author/book metadata나 general concept linking에 제한적으로 사용한다.

### 3.9 Generating and Evaluating Long Story Summaries with KGs

논문:

- [Generating and Evaluating Long Story Summaries with Knowledge Graphs](https://openreview.net/forum?id=6T10wkb4uS4)

제안 아이디어:

- 전체 book KG를 만들고, chapter summarization 때 관련 KG edge를 검색해 global context로 넣는다.
- KGScore는 generated summary와 reference summary에서 각각 KG를 추출한 뒤 edge similarity로 factual consistency를 평가한다.

그들만의 포인트:

- KG를 generation input과 evaluation metric 양쪽에 쓴다.
- summary의 factual consistency를 text overlap이 아니라 graph overlap으로 평가하려 한다.

얻은 인사이트:

- 우리 support도 "문장이 자연스러운가"보다 "NRG claim과 맞는가"를 평가해야 한다.

적용 아이디어:

- `NRGScore`를 만든다.
  - support unit에서 claim graph를 추출한다.
  - reference NRG 또는 human-validated claim과 비교한다.
  - precision: support가 말한 것 중 근거 있는 비율
  - recall: 필요한 support claim 중 제공된 비율
  - safety: reader position 이후 claim이 섞이지 않은 비율

### 3.10 Guiding Generative Storytelling with KGs

논문:

- [Guiding Generative Storytelling with Knowledge Graphs](https://arxiv.org/abs/2505.24803)

제안 아이디어:

- KG-assisted long-form generation pipeline을 제안하고, 사용자가 KG를 편집해 narrative를 shape할 수 있게 한다.
- user study에서 editable KG가 action-oriented, structurally explicit narrative에서 quality와 control sense를 높인다고 보고한다.

그들만의 포인트:

- KG를 자동 reasoning 도구뿐 아니라 human control surface로 사용한다.

얻은 인사이트:

- 우리 Graph tab도 단순 inspector를 넘어 correction loop의 entry point가 될 수 있다.
- 연구자나 annotator가 NRG claim을 고치면 support 품질이 개선되는 구조가 가능하다.

적용 아이디어:

- Reader-facing UI와 Researcher-facing graph editor를 분리한다.
- researcher mode에서 claim accept/reject/correct를 기록한다.
- corrected claim은 future run의 verifier reference로 재사용한다.

### 3.11 Long Story Generation via KG and Literary Theory

논문:

- [Long Story Generation via Knowledge Graph and Literary Theory](https://arxiv.org/abs/2508.03137)

제안 아이디어:

- outline-based long story generation의 theme drift와 incoherent plot 문제를 다룬다.
- long-term memory와 short-term memory를 나누고, literary narratology 기반 story theme obstacle framework를 둔다.
- multi-agent writer-reader feedback으로 story text를 revise한다.

그들만의 포인트:

- graph를 단순 fact store가 아니라 theme, obstacle, plot appeal을 관리하는 구조로 사용한다.

얻은 인사이트:

- reader support에서 중요한 것은 사건 사실뿐 아니라 active goal, obstacle, conflict, unresolved question이다.

적용 아이디어:

- NRG node/claim type에 다음을 추가 검토한다.
  - `goal`
  - `obstacle`
  - `conflict`
  - `unresolved_question`
  - `theme_thread`
- 특히 `causal_bridge`와 `boundary_update` support는 obstacle/conflict 정보가 있으면 훨씬 자연스러워진다.

## 4. 일반 GraphRAG / KG-RAG 논문

### 4.1 From Local to Global: GraphRAG

논문:

- [From Local to Global: A Graph RAG Approach to Query-Focused Summarization](https://arxiv.org/abs/2404.16130)

제안 아이디어:

- 기존 RAG는 local retrieval에는 강하지만 corpus 전체를 묻는 global sensemaking question에 약하다.
- entity KG를 만들고, closely related entity group마다 community summary를 미리 생성한다.
- 질문이 들어오면 community summary별 partial response를 만들고, 이를 다시 final response로 요약한다.

적용 아이디어:

- BOOK.0에 chapter/thread community summary를 둔다.
- 단, 일반 GraphRAG와 다르게 우리 community summary는 reader position별로 잘려야 한다.

```text
thread community summary
  + reveal_start / reveal_end
  + spoiler risk
  + current reader position filter
```

### 4.2 LightRAG

논문:

- [LightRAG: Simple and Fast Retrieval-Augmented Generation](https://arxiv.org/abs/2410.05779)

제안 아이디어:

- graph structure와 vector representation을 결합한다.
- low-level / high-level dual-level retrieval을 사용한다.
- incremental update algorithm으로 새 data를 빠르게 통합한다.

적용 아이디어:

- Firestore projection을 유지하면서도 다음 두 retrieval mode를 분리한다.
  - low-level: 현재 scene의 event/entity/place evidence
  - high-level: chapter/thread/community memory
- chapter run이 새로 생길 때 전체 book graph를 재빌드하지 말고 affected chapter/thread만 갱신한다.

### 4.3 GraphRAG Survey

논문:

- [Graph Retrieval-Augmented Generation: A Survey](https://arxiv.org/abs/2408.08921)

제안 아이디어:

- GraphRAG workflow를 `Graph-Based Indexing`, `Graph-Guided Retrieval`, `Graph-Enhanced Generation`으로 정리한다.

적용 아이디어:

- 논문 method section에서 우리 시스템을 이 taxonomy로 설명할 수 있다.

```text
Graph-Based Indexing:
  ENT.3 / STATE.3 / SCENE.3 / SUB.3 / SUP.0 -> NRG.0

Graph-Guided Retrieval:
  reader_position + reader_problem -> RET.1 support context

Graph-Enhanced Generation:
  SUP.2~SUP.5 support verbalization

Graph-Governed Display:
  SUP.V + SUP.6 + SUP.7 + Runtime Support Governor
```

마지막 `Graph-Governed Display`가 우리 차별점이다.

### 4.4 Survey of GraphRAG for Customized LLMs

논문:

- [A Survey of Graph Retrieval-Augmented Generation for Customized Large Language Models](https://arxiv.org/abs/2501.13958)

제안 아이디어:

- flat text RAG는 professional domain에서 complex query understanding, distributed knowledge integration, efficiency bottleneck을 겪는다.
- GraphRAG는 graph-structured representation, multihop retrieval, structure-aware integration으로 이를 보완한다.

적용 아이디어:

- fiction도 domain-specific reasoning problem으로 framing한다.
- 단순 story text chunk retrieval은 다음을 놓친다고 주장할 수 있다.
  - long-range causal dependency
  - evolving character state
  - reveal timing
  - unreliable / hypothetical / remembered scope
  - reader-position safety

### 4.5 KG2RAG

논문:

- [Knowledge Graph-Guided Retrieval Augmented Generation](https://arxiv.org/abs/2502.06864)

제안 아이디어:

- semantic retrieval로 seed chunk를 찾은 뒤, KG-guided chunk expansion과 KG-based organization을 수행한다.
- isolated chunk가 아니라 fact-level relationship을 활용해 diverse하고 coherent한 context를 만든다.

적용 아이디어:

- 우리 retrieval도 current scene을 seed로 잡고 graph expansion을 한다.

```text
seed:
  current scene / current entity / reader_problem

expand:
  causal_bridge
  same_character_thread
  same_place_thread
  relation_change
  scene_sequence

organize:
  chronology first
  then causal relevance
  then reader_problem relevance
  then intrusion cost
```

### 4.6 KG-RAG for QA

논문:

- [Knowledge Graph-extended Retrieval Augmented Generation for Question Answering](https://arxiv.org/abs/2504.08893)

제안 아이디어:

- LLM과 KG를 training 없이 결합한다.
- question decomposition, ICL, CoT prompting으로 multi-hop retrieval과 explainability를 강화한다.

적용 아이디어:

- 독자가 명시적으로 질문하지 않아도, support system 내부에서는 implicit question을 만들 수 있다.

```text
reader_problem = causal_gap
implicit question = "Why does the current event matter given previous events?"
```

- reasoning chain은 UI에 그대로 노출하지 않고 verifier/audit field로 저장한다.

## 5. Narrative QA / Long Narrative Benchmark

### 5.1 NarrativeQA

논문:

- [The NarrativeQA Reading Comprehension Challenge](https://arxiv.org/abs/1712.07040)

핵심:

- full book 또는 movie script를 읽고 질문에 답해야 한다.
- superficial matching이 아니라 event, entity, relation을 통합해야 풀리는 질문을 목표로 한다.

적용:

- NRG retrieval QA baseline으로 사용한다.
- 단, 우리 주 task는 QA가 아니므로 auxiliary evaluation으로 둔다.

### 5.2 BookSum

논문:

- [BookSum: A Collection of Datasets for Long-form Narrative Summarization](https://arxiv.org/abs/2105.08209)

핵심:

- paragraph, chapter, book level의 human-written summary를 제공한다.
- long-range causal/temporal dependency와 rich discourse structure를 다룬다.

적용:

- BOOK.0 / NRG.0의 chapter-level memory quality 평가에 적합하다.
- chapter summary와 NRG thread summary를 비교할 수 있다.

### 5.3 NovelQA

자료:

- [NovelQA: A Benchmark for Long-Range Novel Question Answering](https://novelqa.github.io/)

핵심:

- novel-length QA benchmark다.
- question aspect와 complexity가 제공되어 long-range retrieval 평가에 좋다.

적용:

- `reader_problem`별 retrieval 평가에 유용하다.
- 예:
  - times / location / relation / cause 계열 질문을 NRG edge type과 매핑한다.

### 5.4 FABLES

논문:

- [FABLES: Evaluating Faithfulness and Content Selection in Book-Length Summarization](https://arxiv.org/abs/2404.01261)

핵심:

- book-length summarization에서 faithfulness와 content selection을 평가한다.
- 긴 narrative에서 "맞는가"와 "중요한 것을 골랐는가"를 분리해 본다.

적용:

- 우리 support 평가도 같은 두 축이 필요하다.
  - faithfulness: support claim이 원문/NRG evidence에 맞는가?
  - content selection: 지금 독자에게 필요한 claim인가?

## 6. 우리 시스템에 반영할 설계

### 6.1 NRG.0 materialization

현재 Firestore graph projection은 유용한 1차 구조지만, document-level Narrative Relation Graph로 가려면 claim-level materialization이 필요하다.

권장 graph element:

- `NarrativeClaim`
- `EventCard`
- `EntityStateAtPosition`
- `RelationState`
- `RelationDelta`
- `PlaceState`
- `Thread`
- `UnresolvedQuestion`

필수 metadata:

- `evidence_refs`
- `source_stage_ids`
- `source_run_id`
- `confidence`
- `grounding_score`
- `support_level`
- `scope`
- `reveal_start`
- `reveal_end`
- `spoiler_risk`

### 6.2 BOOK.0 확장

BOOK.0은 cross-chapter memory snapshot으로 이미 방향이 맞다. 다음 확장은 GraphRAG식 community summary와 LightRAG식 incremental update다.

추가할 것:

- chapter thread summary
- entity thread summary
- place chain summary
- causal chain summary
- reader-position-filtered snapshot
- missing / stale run detection

중요:

- summary는 항상 reveal boundary를 가진다.
- 현재 reader position 이후 사건을 포함한 summary는 Reader runtime에 전달하지 않는다.

### 6.3 RET.1 support context retrieval

현재 `/api/support-context`는 scene 중심 retrieval이다. 다음 단계는 reader_problem 중심 retrieval이다.

권장 입력:

```text
docId
chapterId
sceneId
readerPosition
readerProblem
supportKind
sessionSignals
```

권장 출력:

```text
current_scene
seed_claims
expanded_claims
causal_edges
entity_threads
place_chain
relation_deltas
candidate_support_claims
suppressed_claims
retrieval_trace
```

### 6.4 SUP.V verifier / scorer

기존 SUP.6 policy selection 전후에 별도 verifier가 필요하다.

검증 항목:

- grounding: evidence가 support text를 지지하는가?
- spoiler: 현재 reader position에서 reveal-safe한가?
- scope: memory/imagination/dialogue claim을 actual처럼 말하지 않았는가?
- usefulness: 현재 scene 이해에 실제 도움이 되는가?
- intrusion: 본문 흐름을 과도하게 방해하지 않는가?
- redundancy: 이미 보여준 support와 중복되지 않는가?

### 6.5 Runtime Support Governor

논문들 대부분은 retrieval/generation까지만 다룬다. 우리 차별점은 runtime display policy다.

추가할 reader-state signal:

- session gap
- backscroll
- pause duration
- repeated opening of support
- ignored visible support
- scene transition frequency
- support fatigue

결정:

```text
show
defer
make expandable
trigger only
suppress
```

### 6.6 Researcher correction loop

Guiding Generative Storytelling with KGs와 Narrative Knowledge Weaver에서 얻을 수 있는 실용적 아이디어는 graph를 사람이 고칠 수 있게 하는 것이다.

권장:

- Graph tab에 claim inspector 추가
- claim accept / reject / correct
- corrected claim을 verifier reference로 저장
- correction log를 evaluation data로 재사용

## 7. 평가 설계

### 7.1 Baseline

비교군:

1. Flat RAG
   - current scene 또는 chapter chunk top-k retrieval

2. Generic GraphRAG
   - entity graph + community summary

3. Event-aware graph retrieval
   - E2RAG style entity/event graph

4. Our NRG
   - evidence-grounded, scope-aware, reader-position-aware graph

5. Our NRG + Support Governor
   - retrieval뿐 아니라 show/defer/suppress까지 포함

### 7.2 Metrics

QA 계열:

- answer accuracy
- temporal consistency
- causal consistency
- character consistency

Support 계열:

- grounding accuracy
- spoiler violation rate
- support usefulness
- intrusion cost
- redundancy rate
- evidence traceability
- reader recall / comprehension gain

Graph 계열:

- entity resolution accuracy
- event ordering accuracy
- relation delta accuracy
- claim precision / recall
- scope classification accuracy

### 7.3 NRGScore 제안

`KGScore`에서 착안해 support unit을 claim graph로 바꾸고 reference NRG와 비교한다.

구성:

- `claim_precision`: support가 말한 claim 중 reference/evidence로 지지되는 비율
- `claim_recall`: 현재 reader_problem 해결에 필요한 claim 중 support가 포함한 비율
- `safety_score`: 현재 reader position 이후 claim이 섞이지 않은 비율
- `scope_score`: memory/dialogue/hypothetical/unreliable claim을 올바르게 표현한 비율
- `intrusion_adjusted_score`: usefulness에서 intrusion/redundancy를 뺀 값

## 8. 구현 우선순위

### P0. NRG claim schema 확정

- `NarrativeClaim`
- `EventCard`
- `EntityStateAtPosition`
- `RelationDelta`
- `Thread`
- evidence / reveal / spoiler / scope metadata

### P1. NRG.0 materializer

- ENT.3 / STATE.3 / SCENE.3 / SUB.3 / SUP.0에서 claim 추출
- normalize-before-merge
- chapter-local NRG 생성
- BOOK.0과 연결

### P2. Reader-position-aware retrieval

- `/api/support-context`를 `readerProblem` 중심으로 확장
- KG2RAG식 seed expansion + organization 적용
- spoiler-safe filter를 retrieval 단계에 포함

### P3. SUP.V verifier

- grounding / spoiler / scope / usefulness / intrusion 검증
- SUP.6 selection 전에 confidence와 suppression reason 제공

### P4. Evaluation dashboard

- shown/opened/suppressed 로그 집계
- support별 usefulness / intrusion proxy
- NRGScore prototype

## 9. 논문별 적용 요약

| 논문 | 가져올 핵심 | 우리 적용 |
|---|---|---|
| E2RAG / ChronoQA | entity-event dual graph | EntityStateAtPosition + EventCard |
| ComoRAG | stateful memory workspace | reader_problem 기반 probing retrieval |
| STAGE | shared story-world representation | NRG를 support/QA/summary 공통 기반으로 사용 |
| GroundedKG-RAG | sentence-grounded KG | 모든 claim/edge에 evidence_refs 강제 |
| Dynamic Document KG | document-specific KG verbalization | NRG claim -> support prose 변환 |
| Narrative Knowledge Weaver | normalize-before-merge, event plot graph | NRG.0 materializer 단계화 |
| HTEKG | traits/emotions/relations | character state schema 강화 |
| FAIR KG novels | reusable RDF/LOD 관점 | NRG export/schema 공개 가능성 |
| KG summary paper | KGScore | NRGScore / support factuality metric |
| Guiding Storytelling with KG | editable KG | researcher correction loop |
| Long Story Generation KG | long/short memory, obstacle | goal/conflict/obstacle thread |
| GraphRAG | community summary | thread/chapter community summary |
| LightRAG | dual-level retrieval, incremental update | low/high retrieval + incremental BOOK/NRG |
| KG2RAG | seed expansion + organization | current scene seed -> causal/entity/place expansion |
| KG-RAG QA | question decomposition | implicit reader_problem question |
| NarrativeQA | full-document integrative QA | auxiliary QA baseline |
| BookSum | multi-granularity narrative summary | chapter/book memory evaluation |
| NovelQA | long-range novel QA | NRG retrieval benchmark |
| FABLES | faithfulness + content selection | support correctness + necessity evaluation |

## 10. 최종 방향

다음 구현 목표는 support card를 더 많이 만드는 것이 아니다.

목표는 다음이다.

```text
현재 독자 위치에서 situation model 복구에 필요한 최소 support를
cross-chapter narrative memory와 evidence-grounded NRG에서 검색하고,
grounding / scope / spoiler / usefulness / intrusion 기준으로 검증한 뒤,
Support Governor가 필요한 순간에만 노출하는 구조를 만든다.
```

이 구조가 완성되면 기존 Narrative RAG / GraphRAG와의 차별점은 명확하다.

| 기존 Narrative RAG / GraphRAG | 우리 방향 |
|---|---|
| 질문에 답한다 | 독자의 현재 이해 문제를 복구한다 |
| query 중심 | reader position + reader problem 중심 |
| retrieval/generation 중심 | show/defer/suppress policy 중심 |
| entity/chunk relevance 중심 | evidence/reveal/scope/safety 중심 |
| QA accuracy 중심 | usefulness + low intrusion + spoiler safety 중심 |

따라서 우리 연구의 기여는 새로운 graph algorithm 자체보다, long-form fiction reading에 특화된 reader-position-aware narrative graph schema와 support governance layer에 있다.
