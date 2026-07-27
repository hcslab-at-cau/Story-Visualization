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

## 2026-07-27 canonical corpus identity 업데이트

새 EPUB upload는 임의 document ID를 먼저 만드는 대신 source byte identity를 기준으로 canonical corpus import를 수행한다.

- 원본 EPUB byte의 SHA-256을 `sourceSha256`으로 사용하고, revision ID는 `cr_v1_<sourceSha256>`로 고정한다.
- caller가 `bookId`를 명시하지 않으면 `book_v1_<sourceSha256>`를 사용한다. 유효한 `bookId`를 명시하면 byte가 다른 revision도 같은 logical book에 연결할 수 있다.
- title과 file name은 corpus identity에 포함되지 않는다. 따라서 byte가 같은 파일을 이름만 바꾸어 다시 올려도 완료된 revision과 source blob을 재사용한다.
- canonical revision manifest와 raw chapter는 `corpus_revisions/{corpusRevisionId}` 아래에 저장하고, source EPUB은 `corpus_revisions/{corpusRevisionId}/source.epub` 경로에 create-only 방식으로 저장한다.
- source별 workspace document에는 `bookId`와 `corpusRevisionId` marker를 기록한다. `/api/epub` 응답은 기존 `docId`, `chapters`, `sourceFile`에 `bookId`, `corpusRevisionId`, `reused`를 추가한다.

### Canonical read와 legacy fallback

- workspace에 유효한 `corpusRevisionId` marker가 있으면 chapter list와 raw chapter load는 canonical revision만 읽는다. canonical manifest 또는 chapter가 없을 때 embedded `documents*/{docId}/chapters`로 조용히 fallback하지 않는다.
- marker가 없는 기존 workspace는 이전과 동일하게 embedded chapter를 읽는다. title 보정, non-story filtering, numeric ordering, 긴 본문 duplicate 제거 순서도 그대로 유지한다.
- document list는 marker가 없는 legacy workspace를 계속 보여준다. marker가 있는 workspace는 canonical revision이 완전한 상태로 검증될 때만 보여준다.

### No automatic backfill

이 변경은 기존 Firestore document, raw chapter, downstream artifact를 자동으로 복사하거나 다시 쓰지 않는다. marker가 없는 document는 legacy read path에 남으며, canonical storage로 전환하려면 EPUB을 새 import path로 다시 업로드해야 한다. 따라서 배포 시점에 대규모 backfill job이나 기존 ID 변환은 실행하지 않는다.
