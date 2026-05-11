# Reader Dual Mode UI

## 목적

Reader 화면을 두 가지 용도로 분리한다.

1. **독자 화면**
   - 실제 독자가 읽는 화면이다.
   - 본문 흐름을 방해할 수 있는 raw artifact, BOOK.0 graph 연결, score, provenance, debug panel을 기본적으로 숨긴다.
   - 자동 노출 support는 최소화하고, 추가 도움은 "헷갈릴 때만 보기"로 접어 둔다.

2. **연구자 화면**
   - 시연, 점검, 디버깅, 미팅 설명을 위한 화면이다.
   - 독자 화면에서 실제로 무엇이 보이는지 요약하고, 그 근거가 되는 SUP.7, BOOK.0, Support Governor, Visual Policy raw artifact를 함께 보여준다.
   - Cross-chapter memory는 독자용 카드가 아니라 BOOK.0 연결 결과를 확인하는 연구자용 패널로 표시한다.

## 독자 화면 정책

독자 화면은 "많은 정보를 보여주는 화면"이 아니라 "필요할 때만 복구 단서를 제공하는 화면"으로 둔다.

- 기본 노출: `Support Governor`가 `before_text`로 선택한 최소 support만 본문 위에 표시한다.
- 본문 안 노출: `on_demand`와 `beside_visual` support 중 evidence 문단을 찾을 수 있는 것은 해당 문단 텍스트 끝에 작은 inline chip으로 붙인다.
- 접힘 노출: 문단 anchor를 찾지 못한 support만 "헷갈릴 때만 보기" 안에 fallback으로 둔다.
- 숨김: Cross-chapter memory panel, scene focus debug panel, cast/place cue debug panel, score/provenance/diagnostics는 숨긴다.
- 근거: 독자 화면에서는 score 대신 짧은 "근거 문장 보기"만 제공한다.
- 이미지: VIS score가 낮으면 자동 노출하지 않고 "장면 이미지 보기"로 접는다.

## 연구자 화면 정책

연구자 화면은 Reader가 사용하는 산출물의 흐름을 확인하는 목적이다.

- `FINAL.1 current packet`: 현재 scene packet과 subscene 상태를 확인한다.
- `SUP.7 support plan`: candidate/display/suppressed support 구조를 확인한다.
- `BOOK.0 reader memory context`: 현재 scene에 연결된 incoming/outgoing edge, entity thread, nearby path를 확인한다.
- `Runtime governor and visual policy`: support가 왜 보이거나 숨겨졌는지 확인한다.
- `Support narrowing pipeline`: `전체 생성 후보`, `SUP.7이 남긴 후보`, `Governor 최종 표시`를 3단계 컬럼으로 나눠 보여준다. 각 항목은 compact card로 접어 두고, 실제 표시 위치는 `읽기 전 짧은 단서`, `본문 n번째 문단`, `헷갈릴 때만 보기` 중 어디인지 표시한다.
- `Active subscene view`: 기존 subscene/global/character/pair view artifact를 확인한다.

## 화면에서 확인할 항목

연구자 화면 상단의 해석 패널은 다음 수치를 보여준다.

- `candidate units`: SUP.7에 남아 있는 전체 support 후보 수.
- `visible after governor`: 실제 화면에 남은 before/on-demand/side support 수.
- `hidden or suppressed`: trigger-only 또는 suppressed 처리된 support 수.
- `BOOK.0 links`: 현재 scene과 연결된 cross-chapter edge/thread/path 수.

이 수치가 중요한 이유는 "SUP가 생성한 것"과 "독자에게 실제로 보여준 것"을 분리해서 설명할 수 있어야 하기 때문이다.

## 구현 위치

- `src/app/page.tsx`
  - Reader 상단에 `독자 화면` / `연구자 화면` 토글을 추가한다.
  - 선택된 mode를 `ReaderScreen`으로 전달한다.

- `src/components/ReaderScreen.tsx`
  - `mode="reader"`일 때 독자 친화적인 표시 정책을 적용한다.
  - `mode="researcher"`일 때 raw artifact와 해석 패널을 표시한다.
  - 연구자 화면에서 열린 support는 interaction logging에 기록하지 않는다.

## 다음 개선 후보

- 독자 화면 support 문장을 LLM 후처리로 더 자연스럽게 압축한다.
- 독자 화면에서 scene summary 버튼을 완전히 제거할지, "현재 상황 보기" 버튼으로 바꿀지 사용자 평가 후 결정한다.
- 연구자 화면 raw JSON을 tree viewer 형태로 바꿔 큰 artifact를 더 쉽게 탐색하게 한다.
- Reader support open/ignore 로그를 기반으로 Support Governor rule을 조정한다.
