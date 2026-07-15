export type V3BodyResultTone =
  | "cast"
  | "place"
  | "time"
  | "object"
  | "action"
  | "goal"
  | "causality"
  | "event"
  | "scene"
  | "neutral"

export interface V3BodyHighlight {
  id: string
  pid: number
  startChar: number
  endChar: number
  label: string
  tone: V3BodyResultTone
  title?: string
}

export type V3BodySegment =
  | {
    kind: "text"
    text: string
  }
  | {
    kind: "highlight"
    text: string
    highlight: V3BodyHighlight
  }

export function buildBodySegments(
  text: string,
  highlights: V3BodyHighlight[],
): V3BodySegment[] {
  const validHighlights = highlights
    .filter((highlight) => (
      Number.isInteger(highlight.startChar) &&
      Number.isInteger(highlight.endChar) &&
      highlight.startChar >= 0 &&
      highlight.endChar > highlight.startChar &&
      highlight.endChar <= text.length
    ))
    .sort((a, b) => (
      a.startChar - b.startChar ||
      b.endChar - a.endChar ||
      a.id.localeCompare(b.id)
    ))

  const segments: V3BodySegment[] = []
  let cursor = 0

  for (const highlight of validHighlights) {
    if (highlight.startChar < cursor) continue

    if (highlight.startChar > cursor) {
      segments.push({
        kind: "text",
        text: text.slice(cursor, highlight.startChar),
      })
    }

    segments.push({
      kind: "highlight",
      text: text.slice(highlight.startChar, highlight.endChar),
      highlight,
    })
    cursor = highlight.endChar
  }

  if (cursor < text.length) {
    segments.push({
      kind: "text",
      text: text.slice(cursor),
    })
  }

  return segments
}
