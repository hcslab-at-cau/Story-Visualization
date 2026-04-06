const WORD_CHAR_PATTERN = /[\p{L}\p{N}]/u

export interface MentionLocation {
  start_char: number
  end_char: number
}

function isWordChar(char: string): boolean {
  return WORD_CHAR_PATTERN.test(char)
}

export function hasStandaloneBoundary(
  text: string,
  start: number,
  spanLength: number,
): boolean {
  const before = start > 0 ? text[start - 1] : ""
  const afterIndex = start + spanLength
  const after = afterIndex < text.length ? text[afterIndex] : ""
  return !isWordChar(before) && !isWordChar(after)
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
