# EPUB ingest normalization 구현

## 2026-05-08 업데이트

EPUB upload는 `RawChapter`를 저장하기 전에 rule-based normalization layer를 적용한다.

구현된 동작:

- cover, navigation, table of contents, copyright, Project Gutenberg header/footer처럼 보이는 spine item은 chapter 생성 전에 제외한다.
- 이미 저장된 document도 `listChapters`에서 필터링하므로 `pg-header`, `pg-footer` 형태의 chapter가 UI와 이후 `BOOK.0` build에 나타나지 않는다.
- chapter title은 더 이상 `item4` 같은 manifest ID를 그대로 사용하지 않는다.
- display title은 TOC title, HTML heading, non-generic manifest title, 첫 heading-like paragraph, sequential fallback 순서로 선택한다.
- chapter selector와 Book Memory run selection은 원본 EPUB/spine index가 아니라 visible-list numbering을 보여준다. 예: `Chapter 3 - ...` 대신 `1. CHAPTER I...`
- 저장된 `RawChapter.source`는 normalization metadata를 보존한다. 예: `manifest_id`, `original_title`, `toc_title`, `heading_title`, `classification`, `classification_reason`, `source_unit_ids`

현재 한계:

- Firestore에 이미 저장된 raw chapter document를 다시 쓰지는 않는다. 기존 chapter는 read time에 숨기거나 display title을 보정한다.
- old chapter ID에서 생성된 downstream artifact는 rerun 전까지 그대로 남는다.
- 현재 splitter는 content spine item 하나를 기본적으로 chapter 하나로 다루며, long-chapter length splitting만 fallback으로 사용한다. TOC-anchor splitting은 아직 다음 작업이다.

검증 예시:

현재 Alice document에서 `/api/chapters?docId=oWEaBmeurZmp5ezPw9JW`는 실제 story chapter만 반환하고 `pg-header`, `pg-footer`를 숨긴다. 표시 제목은 `item4`가 아니라 `CHAPTER I. Down the Rabbit-Hole`처럼 chapter heading에서 가져온다.
