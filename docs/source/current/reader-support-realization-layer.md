# Reader Support Realization Layer

## 배경

현재 SUP branch는 독자에게 필요한 재료를 꽤 많이 만든다. 하지만 `SupportUnit.body`에는 아직 graph edge, stage artifact, 원시 연결 문장에 가까운 내용이 남아 있다. 이 값을 Reader 화면에 바로 보여주면 UI를 다듬어도 독자 친화적으로 보이기 어렵다.

따라서 Reader UI 직전에 `Reader Support Realization Layer`를 둔다.

## 목적

이 레이어의 목적은 support를 새로 추론하는 것이 아니라, 이미 생성된 support를 독자 화면에 맞는 microcopy로 바꾸는 것이다.

- `causal_gap` -> `왜?`
- `reference_ambiguity` -> `누구?`
- `spatial_disorientation` -> `장소`
- `character_reentry` -> `인물`
- `relation_delta` -> `관계`
- `state_recovery` -> `지금`
- `boundary_update` -> `변화`
- `session_reentry` -> `복귀`

질문형이 항상 정답은 아니지만, 첫 구현에서는 독자가 도움을 요청하는 자연스러운 입구로 쓰기 위해 짧은 question-like chip을 사용한다.

## 현재 구현

구현 위치는 `src/lib/support-realization.ts`이다.

입력은 `SupportUnit`이고, 출력은 다음 형태다.

```ts
type ReaderSupportRealization = {
  chipLabel: string
  categoryLabel: string
  title: string
  preview: string
  detail: string
  bridge?: {
    previous: string
    current: string
  }
}
```

Reader 화면은 더 이상 `SupportUnit.title/body`를 직접 노출하지 않고, 가능한 경우 `realizeSupportUnit(unit)`의 결과를 사용한다.

## Causal Bridge 처리

`A -> B` 또는 `A → B` 형태의 raw edge는 그대로 문장으로 붙이지 않는다.

- `previous`: 이전 사건
- `current`: 현재 장면
- `preview`: `previous → current`
- `detail`: "이전 장면의 사건이 현재 장면의 이유나 결과로 이어지는 부분입니다."

이 방식은 완전한 자연어 생성은 아니지만, raw edge를 독자가 읽을 수 있는 구조로 최소한 변환한다.

## UI 적용

- Inline chip: `chipLabel`만 표시한다.
- Compact card: `title`, `preview`만 먼저 보여주고 `detail`은 접는다.
- Full support card: `categoryLabel`, `title`, `detail`, 선택적 bridge structure를 보여준다.
- Researcher pipeline card: 단계별 후보 목록에서는 `categoryLabel`, `title`, placement를 먼저 보여준다.

## 한계

현재는 규칙 기반 realization이다. 따라서 다음 한계가 있다.

- 영어 body를 한국어 독자 문장으로 완전히 번역/재작성하지 않는다.
- `Alice finishes the cake -> cries...` 같은 edge를 구조화할 수는 있지만, 문학적으로 자연스러운 설명으로 만들지는 않는다.
- evidence와 support가 약하게 연결된 경우에는 여전히 어색한 preview가 나올 수 있다.

## 다음 단계

다음 단계에서는 `SUP.8` 또는 `RENDER.0` 같은 stage로 독자용 문장 생성을 분리하는 것이 좋다.

- 입력: `SupportUnit`, evidence span, reader problem, current paragraph
- 출력: `chip_label`, `reader_sentence`, `short_detail`, `anchor_hint`, `fallback_reason`
- 검증: raw stage id, arrow-only body, unsupported inference, spoiler risk 제거

이 단계가 들어가면 Reader UI는 "SUP artifact를 보여주는 화면"이 아니라 "독자 상황에 맞게 실현된 도움말을 보여주는 화면"에 가까워진다.
