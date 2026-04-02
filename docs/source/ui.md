# Result Review Screens

이 문서는 `Story-Visualization`에서 "결과 확인 화면"이 현재 어떻게 되어 있는지 정리한다.  
원본 `Story-Decomposition`의 Streamlit 탭 UI와 가장 크게 달라진 부분이 여기다.

---

## 현재 결과 확인 화면은 두 종류뿐이다

현재 저장소에서 결과를 확인하는 화면은 사실상 아래 두 개다.

1. `PipelineRunner`의 stage 결과 패널
2. `ReaderScreen`의 최종 reader 화면

즉 원본처럼 stage별 전용 검토 화면이 따로 있지 않다.

---

## 1. PipelineRunner 결과 패널

### 구현 위치

- `src/components/PipelineRunner.tsx`
- stage 정의: `src/types/ui.ts`

### 화면 구조

좌측은 stage 목록, 우측은 선택한 stage의 결과 상세 패널이다.

```text
left sidebar                 right panel
stage list                   selected stage header
status / run button          summary chips
model input                  optional model input
pending badge                PRE.1 paragraph preview
                             raw JSON
```

### 이 화면에서 실제로 볼 수 있는 것

공통적으로는:

- stage status: `idle | running | done | error`
- stage별 summary chip
- 해당 stage raw JSON

PRE.1만 예외적으로:

- `raw_chapter.paragraphs` 앞부분 3개를 `Paragraph Preview`로 따로 보여 준다.

### summary chip가 보여 주는 정도

`summarizeStage()`가 stage별로 아주 짧은 요약만 만든다.

예:

- PRE.1: title, paragraph 수, char 수, source
- PRE.2: units 수, story/non-story 수
- ENT.1: mention 수, type 분포
- ENT.2: accepted / rejected 수
- ENT.3: entity 수, unresolved 수
- STATE.3: scenes 수, boundaries 수
- SCENE.1: packet 수
- SCENE.3: validated scene 수
- SUB.1~SUB.4: scene packet 수
- FINAL.1: reader packet 수
- FINAL.2: scene 수, character 수

즉 현재 결과 확인은 "전용 시각화"가 아니라 "요약 chip + raw JSON" 조합이다.

---

## 2. ReaderScreen

### 구현 위치

- loader: `src/app/page.tsx`의 `ReaderView`
- renderer: `src/components/ReaderScreen.tsx`

### 언제 보이는가

- `FINAL.1`이 있어야 렌더링된다.
- `FINAL.2`는 optional이다.

즉 reader 화면은 "중간 stage를 검토하는 화면"이 아니라  
"FINAL 산출물이 실제 독자 화면에서 어떻게 보이는지 확인하는 화면"이다.

### 이 화면에서 확인 가능한 것

- scene selector
- subscene navigation
- body paragraphs
- chips
- image 또는 placeholder
- character overlay button
- subscene detail panel

### 확인 가능한 FINAL 정보

`FINAL.1` 기준:

- scene title / summary
- body paragraph slicing
- subscene nav
- character panel text

`FINAL.2` 기준:

- refined anchor가 있으면 coarse anchor 대신 사용
- 단, `not_visible` high-confidence일 때만 button 제거

즉 이 화면은 FINAL 결과물 검토용이지,  
STATE / SCENE / SUB 내부 아티팩트를 단계별로 뜯어보는 화면은 아니다.

---

## 원본 Streamlit과 가장 큰 차이

원본 `Story-Decomposition`에서는 stage마다 거의 전용 탭이 있었다.

예를 들면:

- mention 추출 결과 확인
- validated mention 비교
- state frame 확인
- boundary candidate 확인
- scene packet 확인
- scene index / grounded scene 검토
- FINAL.1 / FINAL.2 / FINAL.3 각각의 전용 탭

현재 `Story-Visualization`에는 이런 전용 결과 화면이 없다.

### 현재 없는 결과 확인 화면

- mention highlight viewer
- state transition viewer
- boundary reviewer
- scene packet inspector
- scene grounding inspector
- subscene proposal/validation 전용 카드 뷰
- FINAL.1 / FINAL.2 debug 전용 화면

### 현재 남아 있는 결과 확인 방식

- 중간 stage: `PipelineRunner`에서 summary + raw JSON
- 최종 stage: `ReaderScreen`

그래서 결과 확인 화면이 "전혀 달라 보이는" 것이 맞다.  
원본 UI를 그대로 옮긴 것이 아니라, stage 공통 inspector와 최종 reader 화면으로 단순화했기 때문이다.

---

## stage별로 어디서 확인해야 하는가

### PRE

- 주 확인 위치: `PipelineRunner`
- 추가 표시: PRE.1만 paragraph preview 제공

### ENT / STATE / SCENE / SUB

- 주 확인 위치: `PipelineRunner`
- 현재는 raw JSON 확인이 사실상 메인

### VIS

- 현재 구현되지 않아서 `PipelineRunner`에서 `Pending`으로만 보임

### FINAL

- 구조 확인: `PipelineRunner` raw JSON
- 실제 reader 동작 확인: `ReaderScreen`

---

## 지금 문서를 읽는 기준

결과 확인 화면 기준으로 보면 현재 프로젝트는 아래처럼 이해하면 된다.

- "중간 결과를 자세히 검토하는 전용 화면"은 아직 없다.
- "각 stage 결과가 저장됐는지 확인하고 JSON을 보는 화면"은 있다.
- "최종 독자 화면이 어떻게 보이는지 확인하는 화면"은 있다.

즉 현재 UI는 원본 실험용 Streamlit 검토 도구가 아니라  
Next.js 기반의 간소화된 run inspector + reader preview 쪽에 더 가깝다.

