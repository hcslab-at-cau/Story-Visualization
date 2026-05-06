# 인프라: LLM 클라이언트, 프롬프트 로더, EPUB, 입출력

이 문서는 파이프라인 자체보다 아래쪽에 있는 공통 인프라 계층을 정리한다. 대상은 LLM 호출, 프롬프트 템플릿 로딩, EPUB 파싱, 원문 입출력과 같은 기반 로직이다.

---

## 1. LLM Client

관련 구현:
- `src/lib/llm-client.ts`

### 역할

LLM 클라이언트는 OpenRouter의 OpenAI 호환 API를 통해 각 stage의 JSON 응답을 요청한다. 전체 파이프라인에서 공통으로 쓰는 호출 규약은 다음과 같다.

- `temperature=0.0`으로 고정해 추출 결과의 변동성을 줄인다.
- 시스템 프롬프트로 JSON only 응답을 강제한다.
- 일부 모델 계열에서는 `response_format: { type: "json_object" }`를 함께 넣는다.
- 실패 시 재시도와 JSON 복구를 수행한다.

### 현재 구조

클라이언트는 모델명, API 키, 최대 토큰 수를 받아 초기화되고, 내부적으로 `PromptLoader`를 함께 사용한다. stage별 프롬프트 이름 매핑을 통해 `PRE`, `ENT`, `STATE`, `SCENE`, `SUB`, `VIS`, `FINAL.2` 단계가 동일한 방식으로 호출된다.

### JSON 호출 로직

핵심 호출 함수는 다음 순서로 동작한다.

1. OpenAI 호환 `chat.completions.create` 요청을 구성한다.
2. 모델이 지원하면 `json_object` 응답 형식을 요청한다.
3. 응답이 코드 펜스로 감싸져 있으면 제거한다.
4. `JSON.parse`를 시도한다.
5. 실패하면 `jsonrepair`로 복구한 뒤 다시 파싱한다.
6. 그래도 실패하면 재시도 후 마지막 예외를 반환한다.

이 계층의 목적은 “프롬프트별로 제각각 예외 처리하는 것”을 막고, stage 구현이 JSON 스키마 중심으로만 동작하게 만드는 데 있다.

### 현재 한계

- JSON 복구는 형식 오류에는 강하지만, 내용적 hallucination을 막지는 못한다.
- 재시도는 네트워크/포맷 오류 완화에는 도움이 되지만, 잘못된 추출 자체를 교정하지는 않는다.
- stage별로 입력이 길어질수록 토큰 비용과 지연이 커진다.

---

## 2. Prompt Loader

관련 구현:
- `src/lib/prompt-loader.ts`
- `prompts/*.txt`

### 역할

프롬프트 로더는 `prompts/` 디렉토리의 텍스트 템플릿을 읽고, stage 실행 시 필요한 문자열 파라미터를 삽입해 최종 프롬프트를 만든다.

### 현재 구조

- 기본 경로는 프로젝트 루트의 `prompts/` 디렉토리다.
- `load(templateName, params)`는 템플릿을 읽어 `{param}` 자리에 값을 채운다.
- `loadRaw(templateName)`는 원본 템플릿을 그대로 읽는다.
- `listTemplates()`는 사용 가능한 템플릿 목록을 반환한다.

### 현재 프로젝트에서의 의미

이 구조 덕분에 프롬프트와 stage 로직이 분리되어 있다. 즉 stage 코드는 “무엇을 넣어 호출할지”를 담당하고, 템플릿 파일은 “어떻게 요청할지”를 담당한다. 이후 프롬프트 실험이나 버전 관리가 필요해질 때도 이 분리는 유지하는 편이 맞다.

### 개선 필요 지점

- 프롬프트 버전 식별자와 변경 이력을 stage 로그에 함께 남길 필요가 있다.
- 지원 생성 계층이 추가되면 `SUP.*`용 프롬프트 세트도 같은 규약으로 관리해야 한다.
- 장기적으로는 프롬프트 입력 길이, 응답 품질, 실패율을 같이 기록하는 운영 계층이 필요하다.

---

## 3. EPUB Parser

관련 구현:
- `src/lib/epub.ts`

### 역할

EPUB 파서는 업로드된 책 파일을 `RawChapter` 형태로 정규화하는 전처리 계층이다. 이후 모든 stage는 이 결과를 기준으로 동작한다.

### 현재 구조

파서는 대체로 다음 흐름을 따른다.

1. EPUB를 읽고 spine 문서를 가져온다.
2. TOC가 있으면 TOC 기준으로 chapter 후보를 만든다.
3. TOC가 충분하지 않으면 spine 기준으로 chapter를 나눈다.
4. 그것도 부족하면 heading 기반으로 후보를 만든다.
5. 추출된 HTML을 paragraph 배열로 정리한다.
6. 너무 짧은 chapter는 병합하고, 너무 긴 chapter는 분할한다.
7. 최종적으로 `Paragraph(pid, start, end, text)` 목록이 들어간 `RawChapter`를 만든다.

### paragraph 추출

HTML에서 `p`, `h1~h6`, `li`, `blockquote`, `pre`, `figcaption` 같은 블록 요소를 우선 대상으로 삼고, leaf block만 paragraph 후보로 사용한다. 이후 공백 정규화와 보조 규칙을 적용해 LLM이 읽기 쉬운 단위로 맞춘다.

### 현재 한계

- EPUB 내부 구조가 불규칙하면 chapter 경계가 완전히 안정적이지 않을 수 있다.
- paragraph 분해 품질은 이후 mention extraction과 scene boundary 품질에 직접 영향을 준다.
- 매우 긴 chapter를 단순 분할할 경우 narrative 단위가 끊길 위험이 있다.

---

## 4. 입출력 계층

관련 구현:
- `src/lib/firestore.ts`
- `src/lib/pipeline/*`
- 일부 로컬 유틸

### 역할

현재 프로젝트의 실질적인 저장 계층은 Firestore다. 초기 Python 버전에서 로컬 JSON 파일을 읽고 쓰던 흐름이 이제는 `documents/{docId}/chapters/{chapterId}/runs/{runId}` 중심 구조로 옮겨왔다.

### 현재 구조

- 원문 chapter는 문서/챕터 단위로 저장된다.
- 각 실행은 `runId` 아래에 stage별 artifact를 남긴다.
- 파이프라인은 이전 stage 출력을 읽어 다음 stage 입력으로 넘긴다.
- 뷰어는 최신 run 또는 선택한 run의 artifact를 읽어 inspector와 reader screen을 구성한다.

### 현재 구조의 장점

- 동일 chapter를 여러 번 실행해도 run 단위로 비교가 가능하다.
- stage별 산출물을 개별적으로 점검할 수 있다.
- 디버깅과 재현성이 로컬 파일 기반보다 좋아졌다.

### 현재 구조의 한계

- 문서 전역 기억보다는 chapter/run 단위 기록에 강한 구조다.
- 엔티티/사건/인과/장소 변화를 장기적으로 재사용하기에는 별도 memory 계층이 없다.
- 앞으로 reader support를 고도화하려면 `support/memory-schema.md`에서 제안한 doc-level memory를 추가해야 한다.

---

## 5. 정리

현재 인프라 계층은 “chapter 단위 장면 분해와 독자 패키지 생성”까지는 충분히 받쳐주고 있다. 다음 단계에서 필요한 것은 기반 기술 교체가 아니라, 이 위에 올라갈 장기 기억 계층과 지원 생성 계층의 추가다.

특히 다음 세 가지가 중요하다.

- LLM 호출 결과의 신뢰성과 관측성을 높이는 운영 장치
- 문서 전역 기억을 저장하는 별도 스키마
- 기존 stage와 지원 생성 stage를 느슨하게 연결하는 공통 표현 계층
