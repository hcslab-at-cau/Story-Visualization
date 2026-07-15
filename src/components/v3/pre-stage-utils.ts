export type PreContentType =
  | "front_matter"
  | "toc"
  | "chapter_heading"
  | "section_heading"
  | "epigraph"
  | "narrative"
  | "non_narrative_other"

export type ParagraphFilter = "all" | "story" | "non-story"

export interface PreContentUnit {
  pid: number
  content_type: PreContentType
  is_story_text: boolean
}

export interface PreParagraph {
  pid: number
  text: string
}

export interface ContentTypeMeta {
  label: string
  tone: string
  pillClass: string
  borderClass: string
}

export const CONTENT_TYPE_META: Record<PreContentType, ContentTypeMeta> = {
  front_matter: {
    label: "Front matter",
    tone: "Document setup",
    pillClass: "bg-slate-100 text-slate-700",
    borderClass: "border-l-slate-300",
  },
  toc: {
    label: "TOC",
    tone: "Navigation",
    pillClass: "bg-cyan-50 text-cyan-700",
    borderClass: "border-l-cyan-300",
  },
  chapter_heading: {
    label: "Chapter heading",
    tone: "Structure",
    pillClass: "bg-indigo-50 text-indigo-700",
    borderClass: "border-l-indigo-300",
  },
  section_heading: {
    label: "Section heading",
    tone: "Structure",
    pillClass: "bg-violet-50 text-violet-700",
    borderClass: "border-l-violet-300",
  },
  epigraph: {
    label: "Epigraph",
    tone: "Quoted lead-in",
    pillClass: "bg-amber-50 text-amber-700",
    borderClass: "border-l-amber-300",
  },
  narrative: {
    label: "Narrative",
    tone: "Story text",
    pillClass: "bg-emerald-50 text-emerald-700",
    borderClass: "border-l-emerald-400",
  },
  non_narrative_other: {
    label: "Other non-story",
    tone: "Excluded text",
    pillClass: "bg-zinc-100 text-zinc-700",
    borderClass: "border-l-zinc-300",
  },
}

export const CONTENT_TYPE_ORDER: PreContentType[] = [
  "narrative",
  "chapter_heading",
  "section_heading",
  "epigraph",
  "front_matter",
  "toc",
  "non_narrative_other",
]

export function summarizeContentUnits(units: PreContentUnit[]) {
  const byType: Partial<Record<PreContentType, number>> = {}
  let story = 0

  for (const unit of units) {
    byType[unit.content_type] = (byType[unit.content_type] ?? 0) + 1
    if (unit.is_story_text) story += 1
  }

  const total = units.length

  return {
    total,
    story,
    nonStory: total - story,
    storyRate: total > 0 ? Math.round((story / total) * 100) : 0,
    byType,
  }
}

export function unitByPid(units: PreContentUnit[]): Map<number, PreContentUnit> {
  return new Map(units.map((unit) => [unit.pid, unit]))
}

export function filterParagraphs(
  paragraphs: PreParagraph[],
  units: PreContentUnit[],
  filter: ParagraphFilter,
): PreParagraph[] {
  if (filter === "all") return paragraphs

  const unitsByPid = unitByPid(units)
  return paragraphs.filter((paragraph) => {
    const unit = unitsByPid.get(paragraph.pid)
    return filter === "story" ? unit?.is_story_text === true : unit?.is_story_text !== true
  })
}
