const WORD_CHAR_PATTERN = /[\p{L}\p{N}]/u
const HANGUL_PATTERN = /\p{Script=Hangul}/u
const KOREAN_POSTPOSITION_START_PATTERN = /[은는이가을를과와도만에에서에게께한테으로로의보다처럼까지부터마다라며라고랑이나나야여]/u

export interface MentionLocation {
  start_char: number
  end_char: number
}

function isWordChar(char: string): boolean {
  return WORD_CHAR_PATTERN.test(char)
}

function isHangul(char: string): boolean {
  return HANGUL_PATTERN.test(char)
}

function isLikelyKoreanPostpositionBoundary(
  spanLastChar: string,
  after: string,
): boolean {
  return isHangul(spanLastChar) &&
    isHangul(after) &&
    KOREAN_POSTPOSITION_START_PATTERN.test(after)
}

export function hasStandaloneBoundary(
  text: string,
  start: number,
  spanLength: number,
): boolean {
  const before = start > 0 ? text[start - 1] : ""
  const afterIndex = start + spanLength
  const after = afterIndex < text.length ? text[afterIndex] : ""
  const spanLastChar = text[start + spanLength - 1] ?? ""
  const hasLeftBoundary = !isWordChar(before)
  const hasRightBoundary = !isWordChar(after) ||
    isLikelyKoreanPostpositionBoundary(spanLastChar, after)
  return hasLeftBoundary && hasRightBoundary
}

export function findStandaloneOccurrences(
  text: string,
  span: string,
): MentionLocation[] {
  if (!span.trim()) return []

  const occurrences: MentionLocation[] = []
  let fromIndex = 0

  while (fromIndex <= text.length) {
    const start = text.indexOf(span, fromIndex)
    if (start < 0) break

    if (hasStandaloneBoundary(text, start, span.length)) {
      occurrences.push({
        start_char: start,
        end_char: start + span.length,
      })
    }

    fromIndex = start + Math.max(1, span.length)
  }

  return occurrences
}

export function resolveMentionLocation(
  text: string,
  span: string,
  fallbackOccurrenceIndex = 1,
): MentionLocation | null {
  const occurrences = findStandaloneOccurrences(text, span)
  if (occurrences.length === 0) return null

  return occurrences[fallbackOccurrenceIndex - 1] ?? occurrences[0] ?? null
}

export function hasExactMentionLocation(
  text: string,
  span: string,
  startChar?: number,
  endChar?: number,
): boolean {
  if (
    typeof startChar !== "number" ||
    typeof endChar !== "number" ||
    !Number.isInteger(startChar) ||
    !Number.isInteger(endChar) ||
    startChar < 0 ||
    endChar <= startChar ||
    endChar > text.length
  ) {
    return false
  }

  return (
    text.slice(startChar, endChar) === span &&
    hasStandaloneBoundary(text, startChar, endChar - startChar)
  )
}
