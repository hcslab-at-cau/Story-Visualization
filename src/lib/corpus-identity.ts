import { createHash } from "node:crypto"

export interface CorpusIdentity {
  sourceSha256: string
  corpusRevisionId: string
  bookId: string
}

const BOOK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

const digest = (value: Buffer | string) => createHash("sha256").update(value).digest("hex")

const digestParts = (...parts: Array<string | number>) => digest(parts.join("\0"))

export function validateBookId(bookId: string): string {
  if (!BOOK_ID_PATTERN.test(bookId)) {
    throw new Error("bookId must match ^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")
  }

  return bookId
}

export function deriveCorpusIdentity(
  bytes: Buffer,
  requestedBookId?: string,
): CorpusIdentity {
  const sourceSha256 = digest(bytes)

  return {
    sourceSha256,
    corpusRevisionId: `cr_v1_${sourceSha256}`,
    bookId: requestedBookId === undefined
      ? `book_v1_${sourceSha256}`
      : validateBookId(requestedBookId),
  }
}

export function deriveSourceItemId(
  revisionId: string,
  spineIndex: number,
  manifestId: string,
  normalizedHref: string,
): string {
  return `si_v1_${digestParts(revisionId, spineIndex, manifestId, normalizedHref)}`
}

export function deriveParagraphId(
  revisionId: string,
  sourceItemId: string,
  sourceParagraphOrdinal: number,
): string {
  return `p_v1_${digestParts(revisionId, sourceItemId, sourceParagraphOrdinal)}`
}
