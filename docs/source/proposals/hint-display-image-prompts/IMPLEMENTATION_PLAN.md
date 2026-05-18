# Reader 힌트 표시 구현 계획 (작업 문서화)

이 문서는 직전 작업에서 수행한 점검 결과와, 힌트 프롬프트 묶음을 Reader 화면에 반영하기 위한 개발 계획을 기록한다.

## 1) 이번에 수행한 점검

다음 내용을 코드/문서 기준으로 확인했다.

- 힌트 이미지 프롬프트 묶음의 목표와 사용 순서 확인
  - `README.md`: 조용한 Reader surface, 작은 recovery aid, 대부분 상호작용 이후 노출 원칙
  - `00-shared-visual-brief.md`: 좌측 본문 + 우측 지원 패널(약 360–420px), anchor → panel 상호작용 흐름
- 현재 Reader UI의 힌트 소비 경로 확인
  - `resolveFocusContext(...)`에서 global/character/pair 컨텍스트별 summary/hints/buttons/panels 분기
  - `focusContext.hints` 렌더링 카드 확인
  - pair 힌트 미존재 fallback 문자열 존재 확인

## 2) 현재 상태 요약

- 파이프라인 측에서 내려오는 hint 데이터(`global_view`, `character_views`, `pair_views`)를 Reader가 이미 렌더링할 수 있는 구조가 마련되어 있다.
- 따라서 우선순위는 “새 데이터 구조 도입”보다 “표시 정책/상호작용 정책/스타일 체계화”에 있다.

## 3) 구현 우선순위 계획

### Phase A — 힌트 타입 체계화

- Reader 내부 매퍼로 hint kind를 유도한다.
  - 예: `now`, `why`, `who`, `relation`, `place_time`, `reference`, `outcome`, `reentry`, `visual`
- kind별 스타일 토큰을 `HINT_STYLE_MAP`으로 관리한다.
  - 배경/보더/포인트 컬러, 아이콘, 카드 밀도(compact/expanded)

### Phase B — 노출 정책(기본 최소화)

- 기본 상태에서는
  - 요약(summary)
  - 가벼운 핵심 hint 1개
  만 우선 노출
- 나머지는 anchor 클릭 혹은 panel button 상호작용으로 확장 노출
- 컨텍스트 선택(글로벌/캐릭터/관계)에 따라 힌트 우선순위를 다르게 적용

### Phase C — 패널 상호작용 고도화

- hint 카드 클릭 시 해당 panel 섹션으로 포커스 이동
- button 상태(active/disabled)와 hint 노출 상태를 동기화
- 좁은 화면에서는 우측 패널을 바텀 시트로 대체하는 반응형 폴백 검토

### Phase D — 품질 가드

- 힌트 길이 및 형태 가드 적용(짧은 라벨 + 한 문장 중심)
- 중복 힌트 제거 규칙 적용(라벨/본문 유사)
- pair 힌트 부재 시 fallback + 대체 동선(캐릭터 단일 보기 유도)

### Phase E — 실험/관측

- feature flag(`readerHintV2`)로 단계적 적용
- 이벤트 계측
  - anchor click rate
  - hint open/dismiss rate
  - panel dwell time
- 읽기 방해 지표(불필요한 노출/전환) 확인

## 4) 즉시 실행 가능한 작업 항목

1. `ReaderScreen.tsx`에 hint kind 매퍼와 style map 도입
2. 기본 노출 힌트 개수 제한 로직 도입(1개)
3. “더 보기” 상호작용으로 나머지 힌트 확장
4. 간단 계측 이벤트 추가
5. QA: global/character/pair 각 모드에서 fallback 포함 동작 점검

## 5) 메모

- 본 문서는 “방금 수행한 분석/계획 수립”의 기록이며, 코드 동작 변경은 포함하지 않는다.
