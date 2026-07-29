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
- 각 retained spine/source item에는 revision, 원래 spine index, manifest ID, 정규화된 href에서 계산한 안정적인 `source_item_id`를 부여한다.
- 각 retained paragraph에는 `corpusRevisionId`, `source_item_id`, 원본 item 내부의 `source_paragraph_ordinal`에서 계산한 안정적인 `paragraph_id`를 부여하고, 최종 정규화된 책 전체 읽기 순서에 따라 0부터 시작하는 `global_ordinal`을 부여한다. 기존 chapter-local 숫자 `pid`는 downstream 호환성을 위해 유지한다.
- canonical revision manifest와 raw chapter는 `corpus_revisions/{corpusRevisionId}` 아래에 저장하고, source EPUB은 `corpus_revisions/{corpusRevisionId}/source.epub` 경로에 create-only 방식으로 저장한다.
- canonical chapter write는 transaction당 최대 20개와 추정 serialized payload 3 MiB로 나누며, 단일 chapter가 추정 750 KiB를 넘으면 chapter write 전에 `413 canonical_chapter_too_large`로 중단한다.
- source별 workspace document에는 `bookId`와 `corpusRevisionId` marker를 기록한다. `/api/epub` 응답은 기존 `docId`, `chapters`, `sourceFile`에 `bookId`, `corpusRevisionId`, `reused`를 추가한다.

### Canonical read와 legacy fallback

- workspace에 유효한 `corpusRevisionId` marker가 있으면 chapter list와 raw chapter load는 canonical revision만 읽는다. canonical manifest 또는 chapter가 없을 때 embedded `documents*/{docId}/chapters`로 조용히 fallback하지 않는다.
- marker가 없는 기존 workspace는 이전과 동일하게 embedded chapter를 읽는다. title 보정, non-story filtering, numeric ordering, 긴 본문 duplicate 제거 순서도 그대로 유지한다.
- document list는 marker가 없는 legacy workspace를 계속 보여준다. marker가 있는 workspace는 canonical revision이 완전한 상태로 검증될 때만 보여준다.

### No automatic backfill

이 변경은 기존 Firestore document, raw chapter, downstream artifact를 자동으로 복사하거나 다시 쓰지 않는다. marker가 없는 document는 legacy read path에 남으며, canonical storage로 전환하려면 EPUB을 새 import path로 다시 업로드해야 한다. 따라서 배포 시점에 대규모 backfill job이나 기존 ID 변환은 실행하지 않는다.

## 2026-07-28 secure ingest boundary 업데이트

`POST /api/epub`은 canonical import 앞에 인증과 자원 한도를 적용한다. 프로덕션에서는 32 UTF-8 byte 이상의 서버 전용 `EPUB_INGEST_ADMIN_TOKEN`과 정확한 Bearer credential이 필요하다. 인증, multipart content type, 선언된 `Content-Length`, process-local import slot을 차례로 확인한 뒤에만 request body를 읽는다. 본문은 제한된 byte buffer에서 multipart로 변환하고, `File.size`와 ZIP metadata를 확인한 뒤에만 Firebase adapter와 canonical import coordinator를 초기화한다. coordinator는 complete revision 재사용을 위한 metadata read를 먼저 허용하지만, 새 revision의 claim이나 persistence 전에 검증된 byte를 격리된 parser worker에 전달한다.

기본 한도:

- multipart request: 51 MiB
- 추출된 EPUB file: 50 MiB
- ZIP entry: 최대 5,000개, entry당 uncompressed 16 MiB, 전체 uncompressed 256 MiB, compression ratio 100:1
- parser: raw spine item 1,000개, source item당 paragraph 10,000개, normalized chapter 1,500개, 전체 paragraph 100,000개, paragraph당 UTF-8 1 MiB, 전체 normalized text 64 MiB, worker 전체 deadline 90초
- parser metadata: manifest item 5,000, TOC item 5,000, archive entry 5,000
- 동시 import: Node process당 1개. 추가 요청은 body를 읽지 않고 `429 ingest_busy`, `Retry-After: 5`를 반환한다.

ZIP reader는 직접 pin과 `epub2` override를 통해 patched `adm-zip@0.6.0`을 사용한다. preflight는 EPUB 필수 entry, path traversal·중복 path, encryption, 지원하지 않는 compression, ZIP64 metadata, 선언 크기와 compression ratio를 parser 실행 전에 검사한다. 검증은 source byte를 다시 쓰지 않으므로 SHA-256 corpus identity에 사용되는 byte는 업로드된 내용과 동일하다. 저장 object의 MIME metadata만 검증된 형식인 `application/epub+zip`으로 고정한다.

`epub2`의 생성과 chapter callback은 모두 Node worker 안에서 실행한다. parent는 전용 임시 directory와 `book.epub`을 만들고, 성공·오류·worker crash·비정상 종료·timeout 어느 경우에도 worker를 종료한 뒤 directory를 재귀적으로 제거한다. parser crash·비정상 종료·timeout은 source item 하나의 읽기 실패로 삼키지 않고 전체 import를 `422 invalid_epub`으로 중단한다. 반면 임시 파일 생성, worker 시작, 정리 실패는 입력 오류로 위장하지 않고 고정된 generic `500`으로 남긴다. parser limit은 기존처럼 typed `413 epub_resource_limit`으로 유지한다. 같은 실제 ZIP entry를 가리키는 path-normalized 또는 percent-decoded alias의 실패한 읽기는 최초 시도와 한 번의 retry까지만 허용한다.

안정적인 boundary error code는 다음과 같다.

- `400`: `invalid_content_length`, `malformed_multipart`, `missing_file`
- `401`: `unauthorized` (`WWW-Authenticate: Bearer`)
- `413`: `request_too_large`, `epub_too_large`, `epub_resource_limit`
- `415`: `invalid_content_type`
- `422`: `invalid_epub` (ZIP/EPUB 구조 오류, parser worker crash·비정상 종료·timeout 포함)
- `429`: `ingest_busy`
- `503`: `ingest_not_configured`
- `500`: 내부 parser setup/cleanup 실패에 대한 고정된 generic 응답

이 process-local boundary는 배포 perimeter를 대체하지 않는다. 프로덕션에는 HTTPS, host-level raw request 크기와 request-rate 제한, slow-client 보호와 timeout, 인증된 연구자 session/UI 또는 Bearer header를 주입하는 신뢰된 server proxy가 여전히 필요하다. 현재 browser uploader에는 서버 secret을 저장하거나 노출하지 않는다. 로컬 개발에서 토큰이 없을 때의 bypass는 비배포 편의 동작이다. Firestore·Storage·corpus schema 변경이나 기존 data backfill은 없다.
