# VIS 개선 제안

## 1. 왜 VIS를 다시 봐야 하는가

현재 저장소에서 VIS는 이미 구현되어 있다.

- `src/lib/pipeline/vis1.ts`
- `src/lib/pipeline/vis2.ts`
- `src/lib/pipeline/vis3.ts`
- `src/lib/pipeline/vis4.ts`
- `src/app/api/pipeline/vis1/route.ts`
- `src/app/api/pipeline/vis2/route.ts`
- `src/app/api/pipeline/vis3/route.ts`
- `src/app/api/pipeline/vis4/route.ts`

이 자체는 큰 진전이다. 다만 지금 VIS가 잘하고 있는 것은 주로 다음이다.

- place image를 비교적 안정적으로 생성
- layout hallucination을 줄이기
- render-safe prompt를 만들기

이것만으로는 연구 목표를 충분히 만족하지 못한다.

연구 목표는 image generation 자체가 아니라

- reader state repair

이기 때문이다.

따라서 VIS는 다음 질문으로 평가해야 한다.

`이 visual이 독자의 현재 장면 상태 복구에 실제로 도움이 되는가?`

---

## 2. 현재 VIS의 강점

### 2.1 단계 분리가 명확하다

- `VIS.1` semantic clarification
- `VIS.2` blueprint extraction
- `VIS.3` render package compilation
- `VIS.4` image generation

raw scene text에서 바로 image를 생성하는 것보다 훨씬 낫다.

### 2.2 anti-hallucination 태도가 강하다

현재 prompt는 다음을 잘 하고 있다.

- current place와 mentioned place 구분
- layout / structure 우선
- `avoid`, `forbid`, `must_not_show` 활용
- narrative prop 과적합 회피

### 2.3 environment-first framing이 유효하다

현재 VIS는 scene image를 dramatic illustration이 아니라

- place structure
- navigable area
- boundary
- composition constraint

중심으로 보려는 점이 좋다.

---

## 3. 현재 VIS의 약점

### 3.1 VIS가 support component가 아니라 support answer처럼 취급된다

문제:

- image가 곧 support처럼 보이기 쉽다.
- 하지만 image alone으로는 다음을 안정적으로 복구하기 어렵다.
  - causality
  - relation change
  - local goal / problem
  - dialogue reference ambiguity

필요한 변화:

- VIS를 primary answer에서 내려놓고 broader support bundle 안의 optional modality로 명시

### 3.2 character support가 구조적으로 약하다

`VIS.2`는 blueprint에서 character list를 사실상 제거하는 방향이다.
layout 품질 관점에서는 타당하지만, reader support 관점에서는 빈틈이 생긴다.

- scene image는 place를 알고
- reader는 그 place에서 누가 중요한지도 알아야 한다.

필요한 변화:

- layout-first image generation은 유지
- parallel한 `visual support metadata`를 추가해서
  - 어떤 character가 scene에서 중요한지
  - 어떤 character가 subscene에서 중요한지
  - image가 character anchoring에 적합한지
  를 함께 알려주기

### 3.3 usefulness scoring이 없다

어떤 scene은 image support가 아주 유용하고,
어떤 scene은 거의 도움이 되지 않는다.

VIS가 강한 경우:

- place shift
- 새로운 공간 진입
- chase / movement / navigation / concealment
- boundary layout이 중요한 장면

VIS가 약한 경우:

- introspection-heavy scene
- social nuance 중심 장면
- 핵심 어려움이 causal이지 spatial이 아닌 장면

필요한 변화:

- `visual_usefulness_score` 추가
- score가 낮으면 suppress 또는 secondary placement

### 3.4 scene-to-scene continuity가 약하다

같은 장소가 반복되어도 현재 VIS는 다음을 강하게 고정하지 않는다.

- viewpoint continuity
- palette continuity
- structural element persistence
- place identity continuity

필요한 변화:

- `canonical_place_key` 기반 continuity memory 저장
- 이후 scene render에서 재사용

### 3.5 일반 이미지 외 fallback visual mode가 없다

현재 image generation이 불안정하면 사실상 "없음"에 가깝게 떨어질 수 있다.

필요한 변화:

- low-fidelity visual fallback 추가
  - 간단한 place schematic
  - restrained spatial diagram
  - low-detail support image

---

## 4. 권장 VIS 방향

VIS를 하나의 방식으로 보지 말고 세 가지 visual support mode로 나누어 생각하는 편이 좋다.

### Mode A. Place Restoration Visual

질문:

- 지금 어디인가?

잘 맞는 상황:

- spatial recovery
- boundary crossing
- recurring place re-entry

현재 시스템은 이 모드를 비교적 잘 하고 있다.

### Mode B. Interaction Anchor Visual

질문:

- 이 장면에서 누가 중요하고, 시선을 어디에 두어야 하나?

잘 맞는 상황:

- active cast가 작고
- local interaction이 분명한 장면

현재는 overlay button 수준에서만 부분 지원한다.

### Mode C. Spatial Schematic

질문:

- 이 공간이 어떻게 조직되어 있지?

잘 맞는 상황:

- layout가 복잡할 때
- 여러 zone을 이동할 때
- realistic image generation이 불안정할 때

현재는 명시적으로 지원하지 않는다.

권장 순서:

- Mode A를 먼저 강화
- Mode B는 metadata + overlay 수준으로 확장
- Mode C는 fallback으로 추가

---

## 5. 구체적인 변경 제안

### 5.1 `visual_usefulness_score` 추가

목적:

- image support를 보여줄 가치가 있는지 판단

권장 필드:

- `visual_usefulness_score: number`
- `visual_usefulness_reason: string[]`
- `visual_primary_role: "place_restore" | "interaction_anchor" | "spatial_schematic" | "low_value"`

입력으로 쓸 것:

- `SCENE.3` place / environment / actions
- `SUB.2` action_mode / problem_state
- `STATE.3` boundary reason
- `VIS.1` semantic clarification

간단한 heuristic:

score 증가:

- place shift 존재
- 새로운 environment establish
- movement / pursuit 중심
- 의미 있는 zone이 많음

score 감소:

- reflection 위주
- current place가 이미 오래 안정적임
- primary confusion이 relation / causality 쪽임

### 5.2 place 기반 continuity memory 추가

목적:

- 같은 장소의 image drift를 줄이기

`canonical_place_key`별로 저장할 것:

- preferred viewpoint family
- major boundary
- recurring structural element
- palette / light family
- scene archetype

권장 저장 위치:

- `documents/{docId}/memory/place_visuals/{canonicalPlaceKey}`

### 5.3 visual support metadata 추가

목적:

- image가 무엇을 도와주는지 명시

권장 필드:

- `supports_place_repair: boolean`
- `supports_cast_orientation: boolean`
- `supports_motion_orientation: boolean`
- `supports_causal_repair: boolean`
- `not_reliable_for: string[]`

예:

- reliable for:
  - current place
  - rough movement path
- not reliable for:
  - precise relation state
  - hidden motive

### 5.4 schematic fallback mode 추가

목적:

- realistic image가 불안정할 때 더 안전한 visual을 제공

권장 스타일:

- low-detail
- low-ornament
- no human figure
- zone과 navigable structure 강조

트리거:

- generation failure
- low blueprint validity
- high spatial confusion + low image stability

### 5.5 `FINAL.1`과 더 강하게 연동

현재 `FINAL.1`은 image / blueprint 구분은 하지만,
image의 가치에 따른 display 강도 조절은 약하다.

권장 규칙:

- usefulness 높음:
  - image prominent
  - 작은 state snapshot과 같이 노출

- usefulness 중간:
  - image secondary
  - chip과 focus card를 더 앞세움

- usefulness 낮음:
  - image default suppress
  - text support 우선

### 5.6 overlay refinement가 visual role을 알게 만들기

지금 `FINAL.2`는 semantic plausibility를 우선하는 점은 좋다.
하지만 image가 place restoration용인지 interaction anchor용인지까지 알면 더 안정적이다.

추가 입력 예:

- `visual_primary_role`
- `supports_cast_orientation`
- `supports_motion_orientation`

place-only image라면:

- overlay를 더 보수적으로 두고
- image가 character evidence인 것처럼 과하게 해석하지 않기

---

## 6. 파일 단위 변경 제안

### `schema.ts`

추가 권장:

- `VisualGroundingPacket`
  - `visual_usefulness_score?`
  - `visual_usefulness_reason?`
  - `visual_primary_role?`

- `StageBlueprintPacket`
  - `supports_place_repair?`
  - `supports_cast_orientation?`
  - `supports_motion_orientation?`
  - `not_reliable_for?`

- `VisualBlock`
  - `visual_usefulness_score?`
  - `visual_primary_role?`
  - `not_reliable_for?`

### `vis1.ts`

- usefulness scoring
- primary role inference

### `vis2.ts`

- place continuity hint 주입
- support metadata 추론

### `vis3.ts`

- 일반 render prompt + schematic fallback prompt 이중화

### `vis4.ts`

- normal generation 실패 시 schematic fallback path

### `final1.ts`

- usefulness score 기반 visual block 강도 조절

### `ReaderScreen.tsx`

- usefulness score에 따른 UI prominence 조절

---

## 7. VIS에서 지금 하지 않는 편이 좋은 것

- VIS를 main support surface로 만드는 것
- full character illustration 쪽으로 기울이는 것
- 모든 scene에 image를 강제로 보여주는 것
- 하나의 prompt에 너무 많은 visual goal을 섞는 것

---

## 8. 최종 권장 방향

VIS는 중요하지만 역할을 더 좁고 명확하게 잡는 편이 좋다.

가장 좋은 역할은 다음과 같다.

- place를 복구해 주기
- 필요할 때 interaction orientation을 보조해 주기
- causality / relation / state repair를 대체하지 않기

가장 중요한 변화는 "더 예쁜 이미지"가 아니라 다음이다.

`VIS가 언제 유용한지, 무엇을 지원하는지, 언제 물러나야 하는지를 스스로 알게 만드는 것`
