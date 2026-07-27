import test from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  deriveCorpusIdentity,
  deriveParagraphId,
  deriveSourceItemId,
  validateBookId,
} from "../src/lib/corpus-identity.ts"

const sha256 = (value: Buffer | string) => createHash("sha256").update(value).digest("hex")

test("byte-identical copied buffers reuse one identity regardless of title or filename", () => {
  const firstUpload = {
    title: "First title",
    filename: "first-name.epub",
    bytes: Buffer.from([0x00, 0xff, 0x53, 0x56]),
  }
  const copiedUpload = {
    title: "Unrelated title",
    filename: "renamed-copy.epub",
    bytes: Buffer.from(firstUpload.bytes),
  }

  assert.notStrictEqual(copiedUpload.bytes, firstUpload.bytes)

  const first = deriveCorpusIdentity(firstUpload.bytes)
  const copied = deriveCorpusIdentity(copiedUpload.bytes)

  assert.deepEqual(copied, first)
  assert.equal(first.sourceSha256, sha256(firstUpload.bytes))
  assert.match(first.corpusRevisionId, /^cr_v1_[a-f0-9]{64}$/)
  assert.match(first.bookId, /^book_v1_[a-f0-9]{64}$/)
  assert.equal(first.bookId, `book_v1_${first.sourceSha256}`)
})

test("changed bytes create a different revision", () => {
  const first = deriveCorpusIdentity(Buffer.from("edition one"))
  const changed = deriveCorpusIdentity(Buffer.from("edition two"))

  assert.notEqual(changed.sourceSha256, first.sourceSha256)
  assert.notEqual(changed.corpusRevisionId, first.corpusRevisionId)
})

test("changed bytes can explicitly reuse the first book ID", () => {
  const first = deriveCorpusIdentity(Buffer.from("edition one"))
  const changed = deriveCorpusIdentity(Buffer.from("edition two"), first.bookId)

  assert.notEqual(changed.corpusRevisionId, first.corpusRevisionId)
  assert.equal(changed.bookId, first.bookId)
})

test("book IDs reject empty, path-like, whitespace, and invalid-leading values", () => {
  for (const value of ["", "book/id", "book id", "_book"]) {
    assert.throws(() => validateBookId(value), /bookId/)
    assert.throws(() => deriveCorpusIdentity(Buffer.from("fixture"), value), /bookId/)
  }
})

test("source item IDs use deterministic NUL-separated provenance", () => {
  const revisionId = deriveCorpusIdentity(Buffer.from("fixture")).corpusRevisionId
  const sourceItemId = deriveSourceItemId(revisionId, 0, "chapter-1", "text/ch1.xhtml")

  assert.match(sourceItemId, /^si_v1_[a-f0-9]{64}$/)
  assert.equal(
    sourceItemId,
    `si_v1_${sha256(`${revisionId}\0${0}\0chapter-1\0text/ch1.xhtml`)}`,
  )
  assert.equal(
    sourceItemId,
    deriveSourceItemId(revisionId, 0, "chapter-1", "text/ch1.xhtml"),
  )
  assert.notEqual(
    sourceItemId,
    deriveSourceItemId(revisionId, 1, "chapter-1", "text/ch1.xhtml"),
  )
  assert.notEqual(
    sourceItemId,
    deriveSourceItemId(revisionId, 0, "chapter-2", "text/ch1.xhtml"),
  )
  assert.notEqual(
    sourceItemId,
    deriveSourceItemId(revisionId, 0, "chapter-1", "text/ch2.xhtml"),
  )
})

test("paragraph IDs are deterministic and sensitive to the source paragraph ordinal", () => {
  const revisionId = deriveCorpusIdentity(Buffer.from("fixture")).corpusRevisionId
  const sourceItemId = deriveSourceItemId(revisionId, 0, "chapter-1", "text/ch1.xhtml")
  const paragraphId = deriveParagraphId(revisionId, sourceItemId, 0)

  assert.match(paragraphId, /^p_v1_[a-f0-9]{64}$/)
  assert.equal(
    paragraphId,
    `p_v1_${sha256(`${revisionId}\0${sourceItemId}\0${0}`)}`,
  )
  assert.equal(paragraphId, deriveParagraphId(revisionId, sourceItemId, 0))
  assert.notEqual(paragraphId, deriveParagraphId(revisionId, sourceItemId, 1))
})
