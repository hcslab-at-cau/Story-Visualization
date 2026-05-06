# 구현-문서 정합성 점검 메모

## 목적

이 문서는 현재 코드와 기존 `docs/source/` 문서 사이의 불일치를 점검하고,
어떤 방향으로 문서를 맞췄는지 기록하기 위한 메모다.

---

## 주요 불일치였던 부분

## 1. VIS 브랜치 상태

이전 문서의 문제:

- VIS가 `미구현`
- UI에는 자리만 있고 `Pending`
- API route가 없음

현재 코드의 실제 상태:

- `vis1.ts ~ vis4.ts` 구현 완료
- `/api/pipeline/vis1 ~ vis4` route 존재
- `PipelineRunner`에 VIS 전용 view 존재
- `FINAL.1 / FINAL.2 / ReaderScreen`까지 연결

조치:

- `pipeline/visual-current.md`를 현재 구현 기준으로 재작성
- `current/ui.md`에서 VIS Pending 서술 제거

## 2. FINAL.1 visual block 상태

이전 문서의 문제:

- visual block이 항상 blueprint-only인 것처럼 기술
- `image_path`가 채워지지 않는다고 서술

현재 코드의 실제 상태:

- `runSceneReaderPackage()`는 optional `renderedImagesLog`를 받음
- rendered image가 있으면 `mode: "image"` 사용
- `image_path`는 실제 generated image URL 사용 가능

조치:

- `pipeline/final.md`를 현재 signature와 동작 기준으로 수정

## 3. 결과 확인 UI 구조

이전 문서의 문제:

- `PipelineRunner`를 summary + raw JSON 위주로만 설명
- VIS 결과를 확인할 수 없는 것처럼 기술

현재 코드의 실제 상태:

- stage별 전용 inspector가 다수 존재
- LLM prompt / response panel 존재
- Reader 쪽도 FINAL artifact 렌더링과 overlay 확인 가능

조치:

- `current/ui.md`를 현재 inspector 중심 구조로 재작성

---

## 이번 정리에서 함께 추가한 개선 포인트

### PRE / ENT

- ENT.3의 LLM 보정 범위가 pronoun 중심이라 alias 정규화 확장이 필요
- LLM 이후 residual unresolved mention 추적이 약함

### STATE

- time state modeling 강화 필요
- STATE.3 boundary scoring, 특히 cast turnover 계산 재검토 필요
- scene title fallback 규칙 추가 필요

### SCENE

- SCENE.2 output normalization 강화 필요
- SCENE.3의 array index join 의존성 개선 필요
- precheck 범위 확장 필요

### SUB

- SUB.3 / SUB.4의 array index join 의존성 존재
- SUB.3 count를 LLM 응답에 그대로 의존하는 점 개선 필요
- SUB는 local support에는 강하지만 document-aware support에는 한계

### FINAL

- FINAL.1은 여전히 support artifact branch라기보다 reader packet 조립에 가까움
- chip 종류가 state-recovery 관점에서 아직 제한적
- overlay decluttering 정책 필요

---

## 정리

이번 정리는 단순 문구 수정이 아니라 다음 두 가지를 함께 반영했다.

1. 현재 구현 상태와 문서의 정합성 회복
2. VIS 이전 단계에서 보이는 구조적 개선 포인트 기록

즉 현재 `docs/source/` 문서들은 이전보다

- 현재 코드 상태를 더 정확하게 설명하고
- 다음 구현 단계에서 어디를 손봐야 하는지를 더 직접적으로 보여주는 상태가 되었다.
