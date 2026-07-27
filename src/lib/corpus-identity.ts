import { createHash } from "node:crypto"

export interface CorpusIdentity {
  sourceSha256: string
  corpusRevisionId: string
  bookId: string
}

const BOOK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const CORPUS_REVISION_ID_PATTERN = /^cr_v1_[a-f0-9]{64}$/
const SOURCE_ITEM_ID_PATTERN = /^si_v1_[a-f0-9]{64}$/

const digest = (value: Buffer | string) => createHash("sha256").update(value).digest("hex")

const digestParts = (...parts: Array<string | number>) => digest(parts.join("\0"))

function validateIdentifier(
  value: string,
  componentName: string,
  pattern: RegExp,
  expectedPattern: string,
): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`${componentName} must match ${expectedPattern}`)
  }

  return value
}

function validateNonNegativeSafeInteger(value: number, componentName: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${componentName} must be a non-negative safe integer`)
  }

  return value
}

function validateNulFree(value: string, componentName: string): string {
  if (typeof value !== "string") {
    throw new Error(`${componentName} must be a string`)
  }
  if (value.includes("\0")) {
    throw new Error(`${componentName} must not contain NUL`)
  }

  return value
}

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
  return `si_v1_${digestParts(
    validateIdentifier(
      revisionId,
      "revisionId",
      CORPUS_REVISION_ID_PATTERN,
      "^cr_v1_[a-f0-9]{64}$",
    ),
    validateNonNegativeSafeInteger(spineIndex, "spineIndex"),
    validateNulFree(manifestId, "manifestId"),
    validateNulFree(normalizedHref, "normalizedHref"),
  )}`
}

export function deriveParagraphId(
  revisionId: string,
  sourceItemId: string,
  sourceParagraphOrdinal: number,
): string {
  return `p_v1_${digestParts(
    validateIdentifier(
      revisionId,
      "revisionId",
      CORPUS_REVISION_ID_PATTERN,
      "^cr_v1_[a-f0-9]{64}$",
    ),
    validateIdentifier(
      sourceItemId,
      "sourceItemId",
      SOURCE_ITEM_ID_PATTERN,
      "^si_v1_[a-f0-9]{64}$",
    ),
    validateNonNegativeSafeInteger(sourceParagraphOrdinal, "sourceParagraphOrdinal"),
  )}`
}
