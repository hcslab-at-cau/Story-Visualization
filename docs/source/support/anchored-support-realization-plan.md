# Anchored Support Realization Plan

## 목적

현재 Reader UI는 본문에서 힌트가 연결되는 위치를 선택할 수 있게 되었지만, 선택 후 열리는 내용은 아직 `SupportUnit`의 기존 card 표현에 많이 기대고 있다. 이 문서의 목적은 다음 구현에서 각 도움 형태가 실제 독자에게 자연스럽게 읽히도록 `SupportUnit`을 본문 anchor 맥락에 맞게 다시 표현하는 방법을 구체화하는 것이다.

핵심 목표는 support를 더 크게 보여주는 것이 아니라, 독자가 본문 흐름을 유지한 채 필요한 순간에만 작은 도움을 얻도록 만드는 것이다.

## 현재 문제

### UI 문제

- 본문 anchor는 문단, 문장, 구절, 단어 단위로 잡히지만, 열린 card는 아직 support artifact에 가깝다.
- 독자 모드와 연구자 모드의 노출 강도는 분리되었지만, card 안의 내용은 mode별로 충분히 다르지 않다.
- `before_text`, `on_demand`, `beside_visual`의 위치 정책은 개선되었지만, 실제 문구는 선택된 본문 조각과 직접 대화하는 느낌이 약하다.

### 내용 문제

현재 `SupportUnit.body`에는 다음 형태가 섞여 있다.

- stage artifact 스타일: `Current-state snapshot`, `Who matters here`
- raw structured sentence: `Place: ... Cast: ... Goals: ...`
- graph edge 스타일: `A -> B`
- 영어/한국어가 섞인 legacy text
- 독자에게 필요한 내용보다 source/debug에 가까운 표현

따라서 card UI를 다듬는 것만으로는 충분하지 않다. `SupportUnit`을 anchor context와 support kind에 맞게 재구성하는 realization layer가 필요하다.

## 설계 원칙

### 독자 모드

독자 모드는 본문 우선이다.

- 기본 노출을 최소화한다.
- anchor는 hover/focus 때만 알아볼 수 있을 정도로 조용하게 둔다.
- 클릭 후 열리는 내용은 한 번에 1~2개의 핵심 문장만 보여준다.
- raw stage name, score, source id, artifact title은 숨긴다.
- 설명은 선택한 텍스트에서 출발해야 한다.
- support가 본문을 대신 요약하지 않게 한다.

### 연구자 모드

연구자 모드는 같은 reader experience를 검토할 수 있어야 한다.

- 독자 모드와 같은 anchor 구조를 사용한다.
- anchor는 기본적으로 잘 보이게 표시한다.
- anchor 옆에 support 종류 badge를 표시한다.
- 열린 card에는 독자용 문구와 함께 source, evidence, score, raw body를 확인할 수 있게 한다.
- 실제 독자 화면에서 보이는 내용과 내부 판단 근거를 분리해서 보여준다.

### 내용 품질

좋은 anchored support는 다음을 만족해야 한다.

- Local: 선택한 문장/구절과 바로 연결된다.
- Minimal: 독자가 당장 놓친 것만 알려준다.
- Typed: `왜?`, `지금`, `장소`, `인물`, `관계` 등 도움의 목적이 분명하다.
- Grounded: evidence 문장이나 source stage에 근거한다.
- Non-disruptive: 독자가 원하지 않으면 화면에 존재감이 거의 없다.
- Spoiler-safe: 현재 reader position 이후 정보는 보여주지 않는다.

## 목표 UX

### 독자 화면

1. 독자는 본문을 그대로 읽는다.
2. support가 있는 구절은 아주 약한 hover/focus affordance만 가진다.
3. 독자가 문단, 문장, 구절, 단어를 클릭하면 해당 위치의 도움 후보를 연다.
4. 같은 위치에 여러 support가 있으면 stacked card가 아니라 작은 선택 popover를 먼저 보여준다.
5. 선택한 support의 실제 설명은 데스크톱에서는 오른쪽 side view, 모바일에서는 bottom sheet로 연다.
6. support 설명은 종류별로 다른 제목, 문장 구조, 세부 항목을 가진다.
7. 본문에 anchor를 잡지 못한 support만 `헷갈릴 때만 보기`에 남긴다.

### 연구자 화면

1. 독자 화면과 같은 본문을 보여준다.
2. support anchor는 색상, 밑줄, 왼쪽 line, badge로 명확히 보인다.
3. 클릭하면 독자용 card와 함께 다음 debug 정보를 접힘 영역으로 보여준다.
   - support kind
   - reader problem
   - source stage ids
   - evidence preview
   - confidence / grounding / usefulness / intrusion
   - raw title/body
4. researcher mode에서 support를 여는 행동은 reader interaction log로 저장하지 않는다.

## 표시 surface 전략

도움 내용을 모두 일반 modal로 띄우는 방식은 독자의 읽기 흐름을 쉽게 끊는다. 기본 전략은 도움의 단계에 따라 surface를 나누는 것이다.

### 1. 본문 anchor

역할:

- support가 있다는 가능성만 아주 조용히 알린다.
- 독자 모드에서는 hover/focus affordance 수준으로 둔다.
- 연구자 모드에서는 색, badge, underline으로 명확히 표시한다.

### 2. 겹친 힌트 선택 popover

역할:

- 같은 단어, 구절, 문장, 문단 범위에 여러 support가 걸릴 때 어떤 도움을 볼지 고르게 한다.
- 설명 전체를 담지 않는다.
- 각 항목은 `종류 badge + 짧은 제목 + 1줄 preview` 정도만 보여준다.

독자 모드 정책:

- popover는 작고 가벼워야 한다.
- 닫기 버튼, 바깥 클릭, Escape로 닫을 수 있어야 한다.
- 하나의 support만 있는 경우에는 선택 popover 없이 바로 설명 surface를 연다.

연구자 모드 정책:

- popover 항목에 support kind, reader problem, priority를 함께 보여준다.
- 같은 선택이 오른쪽 side view의 debug panel과 연결된다.

### 3. 오른쪽 side view

역할:

- 선택된 support의 실제 설명을 보여준다.
- 독자의 본문 위치를 가리지 않고, 읽던 위치를 유지한다.
- 데스크톱 독자 화면과 연구자 화면의 기본 상세 surface로 사용한다.

독자 모드 정책:

- 폭은 360~420px 정도의 slim drawer로 제한한다.
- 제목, badge, 핵심 문장, 필요한 경우 1~3개 bullet만 보여준다.
- source id, score, raw body는 숨긴다.
- 열림 상태가 본문 scroll을 밀어내지 않게 한다.

연구자 모드 정책:

- 같은 side view 안에 독자용 설명과 연구자용 debug section을 분리한다.
- debug section은 접힘 영역으로 두고, 기본 화면은 독자용 결과를 먼저 보여준다.

### 4. 모바일 bottom sheet

역할:

- 모바일에서는 오른쪽 side view 대신 화면 아래에서 올라오는 sheet를 사용한다.
- 본문을 완전히 덮지 않도록 최대 높이를 제한한다.

정책:

- 기본 높이는 45~60vh를 넘기지 않는다.
- 닫기 버튼과 Escape/back 동작을 제공한다.
- 긴 내용은 sheet 내부만 scroll되게 한다.

### 5. full modal 사용 범위

일반적인 도움 설명에는 full modal을 쓰지 않는다. full modal은 다음 경우에만 고려한다.

- 연구자가 여러 support 후보를 비교 검토하는 별도 작업
- source artifact 원문을 크게 확인해야 하는 debug view
- 독자 흐름과 분리된 설정/실험 안내

따라서 독자용 기본 UX는 `anchor -> 겹침 popover -> side view/bottom sheet` 흐름을 따른다.

## 데이터 흐름

현재 흐름:

```text
SUP.7 / FINAL.1 SupportUnit
-> governReaderSupport()
-> buildInlineSupportPlan()
-> ReaderTextParagraph
-> InlineSupportDetails
-> SupportUnitCard
```

목표 흐름:

```text
SUP.7 / FINAL.1 SupportUnit
-> governReaderSupport()
-> buildInlineSupportPlan()
-> ReaderTextParagraph(anchor context)
-> realizeAnchoredSupportUnit()
-> AnchoredSupportCard
```

## 새 realization API

`src/lib/support-realization.ts`에 다음 함수를 추가한다.

```ts
export interface AnchoredSupportContext {
  selectedText: string
  paragraphText: string
  granularity: "paragraph" | "sentence" | "phrase" | "word"
  mode: "reader" | "researcher"
}

export interface AnchoredSupportRealization {
  chipLabel: string
  categoryLabel: string
  title: string
  lead: string
  bullets: string[]
  detail?: string
  bridge?: {
    previous: string
    current: string
  }
  evidenceLabel?: string
  debug?: {
    parsedFrom: "structured_body" | "bridge_body" | "legacy_body" | "fallback"
    rawTitle: string
    rawBody: string
  }
}

export function realizeAnchoredSupportUnit(
  unit: SupportUnit,
  context: AnchoredSupportContext,
): AnchoredSupportRealization
```

이 함수는 새 추론을 하지 않는다. 기존 `SupportUnit`과 anchor text를 독자용 표현으로 변환한다.

## Anchor context

`ReaderTextParagraph`는 현재 다음 정보를 알고 있다.

- `paragraph`
- `anchor.start`
- `anchor.end`
- `anchor.granularity`
- `anchor.units`
- reader/researcher mode

`InlineSupportDetails`에는 `units`만 넘기지 말고 다음 context를 함께 넘긴다.

```ts
interface ActiveSupportAnchorContext {
  selectedText: string
  paragraphText: string
  granularity: SupportAnchorGranularity
  mode: ReaderScreenMode
}
```

문단 단위 support의 `selectedText`는 문단 전체가 아니라, 너무 길 경우 앞 120~160자 정도의 preview를 사용한다. 실제 전체 문단은 `paragraphText`로 보존한다.

## 겹친 anchor 처리

같은 단어에 여러 support가 직접 걸릴 수 있고, 그 단어가 동시에 구절, 문장, 문단 support 범위 안에 포함될 수도 있다. 이 경우 작은 단위를 우선 클릭 가능하게 유지하면서, 클릭 결과에는 그 위치를 덮는 모든 support를 모아야 한다.

### Range segmentation

range anchor를 단순히 하나의 큰 범위로 merge하면 단어 support가 문장 support 안에 묻힌다. 대신 다음 방식으로 비겹침 segment를 만든다.

1. 같은 문단의 모든 range anchor에서 `start`, `end` boundary를 모은다.
2. boundary 사이의 segment마다 그 segment를 덮는 support들을 계산한다.
3. segment에 직접 걸린 word/phrase support가 있으면 그 작은 segment를 별도 클릭 영역으로 유지한다.
4. paragraph-level support는 해당 문단 안의 모든 segment에서 함께 선택 후보로 포함한다.
5. whitespace-only segment는 클릭 영역으로 만들지 않는다.

예:

```text
문장 support: [Alice saw the White Rabbit]
구절 support:             [White Rabbit]
단어 support:             [White]
문단 support: whole paragraph

클릭 결과:
- Alice saw the: 문장 + 문단
- White: 단어 + 구절 + 문장 + 문단
- Rabbit: 구절 + 문장 + 문단
```

### Selection model

active state는 anchor 하나만 저장하지 않고 다음 구조를 갖는다.

```ts
interface ActiveSupportSelection {
  anchorId: string
  units: SupportUnit[]
  selectedUnitId: string
  selectedText: string
  paragraphText: string
  granularity: SupportAnchorGranularity
}
```

`units.length === 1`이면 바로 side view를 연다. `units.length > 1`이면 먼저 작은 popover로 support 목록을 보여주고, 독자가 하나를 선택하면 side view의 `selectedUnitId`를 바꾼다.

### Logging policy

- anchor를 열었을 때는 실제로 기본 선택된 support 1개만 `opened`로 기록한다.
- popover에서 다른 support를 선택할 때마다 해당 support만 `opened`로 기록한다.
- 연구자 모드에서는 기존처럼 reader interaction log를 남기지 않는다.

## Support kind별 표현 계획

### 1. `snapshot` / `state_recovery`

목적:

- 선택한 부분을 읽을 때 현재 상황을 빠르게 정렬한다.

독자 카드:

- Badge: `지금`
- Title: `지금 이 부분에서 확인할 상황`
- Lead: 선택한 문장이 현재 scene의 어떤 상태에 속하는지 1문장으로 설명한다.
- Bullets:
  - `장소`: 현재 장소
  - `인물`: active cast
  - `목표`: immediate goal

Parser:

- `Place: ...`
- `Cast: ...`
- `Goals: ...`
- 나머지 문장은 summary로 둔다.

독자 모드 예:

```text
지금 이 부분에서 확인할 상황
앨리스는 토끼를 따라가며 평범한 강둑 장면에서 이상한 사건으로 넘어가는 중입니다.

장소: 강둑 근처
인물: Alice, White Rabbit
```

연구자 모드 추가:

- source stage: `SCENE.3`, `STATE.2`
- raw `Current-state snapshot`
- parsed fields

### 2. `boundary_delta` / `boundary_update`

목적:

- 장면이나 상태가 바뀌는 지점을 알려준다.

독자 카드:

- Badge: `변화`
- Title: `방금 바뀐 점`
- Lead: 선택한 문장이 어떤 전환 신호인지 말한다.
- Bullets:
  - 장소 변화
  - 시간 변화
  - 등장/퇴장
  - 목표 변화

Parser:

- `The place changed.`
- `The time signal changed.`
- `Entered: ...`
- `Exited: ...`
- `A -> B`

독자 모드 예:

```text
방금 바뀐 점
이 부분부터 Alice의 관심이 책에서 White Rabbit으로 옮겨갑니다.

인물 등장: White Rabbit
행동 변화: 앉아 있음 -> 따라가기
```

연구자 모드 추가:

- boundary source: `STATE.3`
- matched paragraph index
- change labels

### 3. `causal_bridge` / `causal_gap`

목적:

- 현재 행동이나 사건이 왜 이어지는지 설명한다.

독자 카드:

- Badge: `왜?`
- Title: `이 일이 이어지는 이유`
- Lead: 선택한 행동이 앞선 사건의 결과임을 짧게 말한다.
- Bridge:
  - `이전에는`: previous
  - `그래서 지금`: current

Parser:

- `A -> B`
- `A → B`
- `A => B`

독자 모드 예:

```text
이 일이 이어지는 이유
Alice는 이상한 토끼를 보고 호기심이 생겼기 때문에, 지금 토끼를 따라 움직입니다.

이전에는: White Rabbit checks a watch
그래서 지금: Alice follows it into the rabbit-hole
```

주의:

- 현재 장면 이후 결과를 미리 말하지 않는다.
- bridge가 너무 길면 previous/current를 각각 80자 안팎으로 줄인다.

연구자 모드 추가:

- edge source
- evidence count
- confidence and grounding

### 4. `character_focus` / `character_reentry`

목적:

- 이 부분에서 어떤 인물이 왜 중요한지 알려준다.

독자 카드:

- Badge: `인물`
- Title: `이 부분에서 중요한 인물`
- Lead: active cast가 선택 텍스트에서 어떤 역할을 하는지 말한다.
- Bullets:
  - 인물
  - 현재 행동
  - 현재 의도 또는 제약

Parser:

- `X are active in this scene.`
- `Cast: ...`
- active cast list
- selected text에 포함된 이름 우선

독자 모드 예:

```text
이 부분에서 중요한 인물
여기서는 Alice가 관찰자에서 추적자로 바뀌는 순간입니다.

인물: Alice
역할: White Rabbit을 따라가는 주체
```

연구자 모드 추가:

- entity source
- selected character ids if available
- raw active cast

### 5. `relation_delta` / `relation_delta`

목적:

- 인물 사이의 관계나 상호작용 변화가 중요한 경우를 설명한다.

독자 카드:

- Badge: `관계`
- Title: `관계에서 볼 점`
- Lead: 선택한 부분에서 관계가 어떻게 읽히는지 설명한다.
- Bullets:
  - 관계 대상
  - 현재 신호
  - 변화 의미

Parser:

- `A - B: label`
- `/` separated relation list
- relation label only fallback

독자 모드 예:

```text
관계에서 볼 점
이 부분은 Alice와 White Rabbit 사이의 직접 대화보다, Alice가 Rabbit을 따라가며 사건에 끌려 들어가는 관계를 보여줍니다.

관계 신호: 추적 / 호기심 / 거리감
```

연구자 모드 추가:

- relation source stage
- raw relation labels

### 6. `spatial_continuity` / `spatial_disorientation`

목적:

- 독자가 위치나 이동 흐름을 놓치지 않게 한다.

독자 카드:

- Badge: `장소`
- Title: `지금 어디에서 이어지나요?`
- Lead: 선택 텍스트가 현재 장소 또는 이동 흐름에서 어떤 역할인지 말한다.
- Bullets:
  - 현재 장소
  - 직전/주변 장소
  - 이동 방향

Parser:

- `Current place: ...`
- `Nearby/mentioned places: ...`
- `place -> place`

독자 모드 예:

```text
지금 어디에서 이어지나요?
이 부분은 강둑에서 토끼굴 입구로 이동하는 흐름을 잡아주는 지점입니다.

현재 장소: rabbit-hole
이전 흐름: bank -> field -> rabbit-hole
```

연구자 모드 추가:

- place chain
- source evidence
- visual usefulness relation

### 7. `reference_repair` / `reference_ambiguity`

목적:

- 대명사, 짧은 지칭, 반복된 이름이 누구를 가리키는지 도와준다.

독자 카드:

- Badge: `누구?`
- Title: `이 표현이 가리키는 대상`
- Lead: 선택한 표현이 어떤 인물/대상을 가리키는지 설명한다.
- Bullets:
  - 표현
  - 가능한 대상
  - 판단 근거

Parser:

- `resolve them first against: ...`
- active cast list
- selected text가 pronoun/name이면 우선 사용

독자 모드 예:

```text
이 표현이 가리키는 대상
여기서 짧은 지칭은 현재 장면의 active cast를 기준으로 읽으면 됩니다.

가능한 대상: Alice, White Rabbit
```

주의:

- reference가 명확하지 않으면 단정하지 않는다.
- `아마`, `가능성이 큼` 같은 불확실성 표현을 허용한다.

연구자 모드 추가:

- unresolved mentions
- entity source stage

### 8. `visual_context` / `spatial_disorientation`

목적:

- 이미지를 보여주는 것이 아니라, 본문 상상에 필요한 장면 단서를 압축한다.

독자 카드:

- Badge: `단서`
- Title: `장면을 떠올릴 단서`
- Lead: 선택 텍스트의 공간/사물/분위기 단서를 짚는다.
- Bullets:
  - 공간 단서
  - 사물 단서
  - 분위기 단서

Parser:

- environment list
- comma separated cue list
- visual chips

독자 모드 예:

```text
장면을 떠올릴 단서
이 부분은 Rabbit의 이상함을 시각적으로 떠올리게 하는 단서입니다.

단서: waistcoat, watch, hurried movement
```

연구자 모드 추가:

- VIS score
- visual policy reason
- image/blueprint availability

### 9. `reentry_recap` / `session_reentry`

목적:

- 독자가 쉬었다가 돌아왔을 때 필요한 이전 흐름만 복구한다.

독자 카드:

- Badge: `복귀`
- Title: `다시 읽기 전에 기억할 것`
- Lead: 이 위치에 다시 들어올 때 필요한 직전 흐름을 말한다.
- Bullets:
  - 직전 장면
  - 이어지는 tension
  - 현재 장면과의 연결

Parser:

- scene title + summary pairs
- previous scene list

독자 모드 정책:

- 평상시에는 기본 노출하지 않는다.
- long pause/session reentry일 때만 on-demand 상단으로 올린다.

연구자 모드 추가:

- reentry trigger state
- resume gap
- previous scenes

## AnchoredSupportCard UI

기존 `SupportUnitCard compact` 대신 새 component를 둔다.

```tsx
function AnchoredSupportCard({
  unit,
  context,
  mode,
}: {
  unit: SupportUnit
  context: ActiveSupportAnchorContext
  mode: "reader" | "researcher"
}) {
  const realized = realizeAnchoredSupportUnit(unit, context)
  ...
}
```

### 독자 모드 card

구성:

- small badge: `왜?`, `지금`, `장소`
- title
- lead sentence
- 최대 2개 bullet
- bridge가 있으면 2-column 대신 compact stacked block

보이지 않아야 하는 것:

- source stage
- score
- raw body
- JSON
- 긴 evidence

### 연구자 모드 card

구성:

- 독자 모드 card와 같은 내용을 먼저 보여준다.
- 아래에 접힌 debug section을 둔다.

Debug section:

```text
source stages
evidence preview
confidence / grounding / usefulness / intrusion
raw title
raw body
parsed fields
```

## Surface layout

### 독자 모드

선택 UI는 본문 위에 크게 떠 있지 않고, 단계별로 조용히 열린다.

- 배경: 아주 옅은 sky/zinc 계열
- border: 낮은 대비
- card radius: 8px 이하 또는 현재 UI 기준 rounded-xl
- card 간격: 좁게
- 겹친 support가 있으면 먼저 작은 popover로 vertical list를 보여준다.
- 실제 설명은 오른쪽 side view 또는 모바일 bottom sheet에서 보여준다.
- 하나의 support 설명은 5~7줄을 넘기지 않는다.

### 연구자 모드

선택 surface는 더 분석적으로 보인다.

- anchor highlight는 기본 표시
- support kind badge 상시 표시
- card 안에 reader copy + debug details
- side view header에 anchor granularity와 support kind 표시
- source/provenance는 접힘 영역

## 구현 단계

### Phase 1. Rule-based anchored realization

수정 파일:

- `src/lib/support-realization.ts`
- `src/components/ReaderScreen.tsx`

작업:

1. `AnchoredSupportContext`, `AnchoredSupportRealization` 타입 추가
2. `realizeAnchoredSupportUnit` 추가
3. support kind별 parser/helper 추가
4. `InlineSupportDetails`를 anchor context aware surface controller로 교체
5. `AnchoredSupportCard` 추가
6. right side view / mobile bottom sheet shell 추가
7. Reader/Researcher mode별 표시 차이 적용

검증:

- Alice chapter 1 scene 1에서 `지금`, `인물`, `장소`, `단서`가 서로 다른 card로 보인다.
- Alice chapter 1 scene 2에서 `왜?`가 previous/current bridge로 보인다.
- Reader mode에서 raw artifact title이 보이지 않는다.
- Researcher mode에서 raw artifact와 score를 확인할 수 있다.

### Phase 2. Better parsing and legacy compatibility

작업:

1. `Place:`, `Cast:`, `Goals:` parser 안정화
2. `A -> B` bridge parser 안정화
3. relation label parser 추가
4. active cast / selected text 기반 character focus 개선
5. fallback body compaction 개선

검증:

- 영어 legacy run을 다시 실행하지 않아도 card가 자연스럽게 보인다.
- 한국어/영어가 섞여도 raw stage label이 card 첫 화면에 나오지 않는다.

### Phase 3. Interaction tuning

작업:

1. Reader mode anchor contrast 조정
2. Researcher mode anchor badge 밀도 조정
3. range segmentation으로 단어/구절/문장/문단 겹침 처리
4. multiple support popover의 항목 ordering 조정
5. right side view 닫힘/재열림 동작 조정
6. mobile bottom sheet tap target 확인
7. support open event reason을 `text_anchor_opened:{kind}` 형태로 세분화

검증:

- 독자 화면에서 support가 항상 눈에 띄지 않는다.
- 연구자 화면에서 어떤 support가 어디에 붙었는지 한눈에 보인다.
- 모바일에서 구절/단어 anchor가 너무 작으면 문장 단위로 fallback된다.

### Phase 4. Optional LLM rendering stage

Rule-based layer가 충분히 안정화된 뒤에만 고려한다.

후보 stage:

- `SUP.8`
- `RENDER.0`

입력:

- `SupportUnit`
- selected text
- paragraph text
- reader position
- evidence
- spoiler boundary

출력:

- `reader_title`
- `reader_lead`
- `reader_bullets`
- `anchor_reason`
- `fallback_reason`
- `spoiler_safe`

사용 조건:

- rule-based output이 artifact 느낌을 충분히 제거하지 못할 때
- pilot study에서 카드 문구 이해도가 낮을 때

## Acceptance Criteria

### Reader mode

- 본문 위에 `before_text` 카드가 기본 노출되지 않는다.
- support가 있는 텍스트를 클릭해야 힌트가 열린다.
- 여러 support가 겹친 곳은 작은 popover에서 선택할 수 있다.
- 실제 설명은 데스크톱에서 오른쪽 side view, 모바일에서 bottom sheet로 열린다.
- 열린 힌트는 support kind별로 다른 제목과 구조를 가진다.
- raw `SupportUnit.title/body`가 첫 화면에 그대로 노출되지 않는다.
- 한 card는 5~7줄을 넘지 않는다.
- 같은 anchor에 support가 여러 개 있어도 본문 읽기를 방해하지 않는다.

### Researcher mode

- 독자 모드와 같은 anchor 위치를 볼 수 있다.
- anchor가 더 잘 보이고 support kind badge가 표시된다.
- 클릭하면 독자용 문구와 debug/provenance를 함께 확인할 수 있다.
- support narrowing pipeline의 placement와 본문 anchor가 일치한다.

### Data and safety

- 기존 `SUP.7` legacy artifact도 rendering된다.
- evidence가 없거나 약한 support는 fallback drawer로 내려간다.
- spoiler risk가 높은 support는 reader card에 노출되지 않는다.
- source/debug 정보는 researcher mode에서만 보인다.

## 구현 후 확인 시나리오

### Alice chapter 1

1. Reader mode에서 `CHAPTER I. Down the Rabbit-Hole`을 연다.
2. 첫 scene에서 강둑/토끼 관련 문장을 hover한다.
3. 클릭 시 `지금`, `인물`, `장소`, `단서` 카드가 서로 다른 문구로 열린다.
4. 단어/구절/문장 support가 겹친 위치를 클릭하면 작은 popover에서 도움 목록을 고를 수 있다.
5. 선택한 도움은 데스크톱에서 오른쪽 side view로, 모바일에서 bottom sheet로 열린다.
6. 두 번째 scene에서 falling/well 관련 문장을 클릭한다.
7. `왜?` card가 previous/current bridge 구조로 보인다.
8. Researcher mode로 전환한다.
9. 같은 anchor가 더 선명하게 보이고 종류 badge가 붙어 있는지 확인한다.
10. side view debug section에서 source stage와 raw body를 확인한다.

### 실패 기준

다음이 보이면 구현을 다시 조정해야 한다.

- 독자 모드 card 제목이 `Current-state snapshot`처럼 artifact 이름이다.
- `A -> B`가 그대로 본문 카드 첫 줄에 노출된다.
- 모든 support가 같은 카드 형태로 보인다.
- anchor가 본문보다 더 눈에 띈다.
- 도움 설명이 매번 full modal로 떠서 본문을 가린다.
- 단어 support가 문장 support에 merge되어 별도로 선택할 수 없다.
- 연구자 모드에서도 어떤 종류의 support인지 badge 없이 추측해야 한다.
