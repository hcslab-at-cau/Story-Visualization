import type { Mention, MentionCandidates, MentionType } from "@/types/schema"

export const V3_SCENE_MENTION_PROFILE = "v3_scene_boundary_mentions" as const

export type SceneBoundaryMentionRole =
  | "on_stage"
  | "mentioned_only"
  | "imagined_or_hypothetical"
  | "narrator_addressed"
  | "spatial_container"
  | "object_or_prop"
  | "story_time_frame"
  | "time_expression"

export type SceneBoundaryRelevance = "direct" | "contextual" | "excluded"

export type SceneBoundaryDimension =
  | "time"
  | "space"
  | "character_constellation"

export interface V3SceneMention extends Mention {
  scene_role: SceneBoundaryMentionRole
  boundary_relevance: SceneBoundaryRelevance
  boundary_signal: boolean
  boundary_dimension: SceneBoundaryDimension
  rationale?: string
}

export interface V3DroppedMention {
  reason: string
  pid?: number
  span?: string
  mention_type?: MentionType
  start_char?: number
  end_char?: number
  normalized?: string
  scene_role?: SceneBoundaryMentionRole
  boundary_relevance?: SceneBoundaryRelevance
  rationale?: string
}

type MentionExtractionStats = NonNullable<MentionCandidates["extraction_stats"]>

export interface V3MentionCandidates
  extends Omit<MentionCandidates, "mentions" | "dropped_mentions" | "extraction_stats"> {
  extraction_profile: typeof V3_SCENE_MENTION_PROFILE
  scene_boundary_dimensions: SceneBoundaryDimension[]
  deferred_dimensions: Array<"action_focus" | "event_sequence" | "focalization">
  extraction_stats: MentionExtractionStats & {
    accepted_boundary_mentions: number
    contextual_mentions: number
    excluded_candidates: number
    by_type: Record<MentionType, number>
    by_role: Partial<Record<SceneBoundaryMentionRole, number>>
  }
  dropped_mentions: V3DroppedMention[]
  mentions: V3SceneMention[]
}

const CAST_ROLE_ALIASES: Record<string, SceneBoundaryMentionRole> = {
  active: "on_stage",
  actor: "on_stage",
  participant: "on_stage",
  onstage: "on_stage",
  on_stage: "on_stage",
  present: "on_stage",
  mentioned: "mentioned_only",
  mentioned_only: "mentioned_only",
  offstage: "mentioned_only",
  off_stage: "mentioned_only",
  absent: "mentioned_only",
  imagined: "imagined_or_hypothetical",
  hypothetical: "imagined_or_hypothetical",
  conditional: "imagined_or_hypothetical",
  remembered: "imagined_or_hypothetical",
  narrator: "narrator_addressed",
  narrator_addressed: "narrator_addressed",
  reader_addressed: "narrator_addressed",
  addressed: "narrator_addressed",
}

const PLACE_ROLE_ALIASES: Record<string, SceneBoundaryMentionRole> = {
  location: "spatial_container",
  place: "spatial_container",
  spatial: "spatial_container",
  spatial_container: "spatial_container",
  container: "spatial_container",
  setting: "spatial_container",
  object: "object_or_prop",
  prop: "object_or_prop",
  object_or_prop: "object_or_prop",
  object_prop: "object_or_prop",
  non_location: "object_or_prop",
  imagined: "imagined_or_hypothetical",
  hypothetical: "imagined_or_hypothetical",
  remembered: "imagined_or_hypothetical",
}

const TIME_ROLE_ALIASES: Record<string, SceneBoundaryMentionRole> = {
  frame: "story_time_frame",
  story_time: "story_time_frame",
  story_time_frame: "story_time_frame",
  setting_time: "story_time_frame",
  temporal_frame: "story_time_frame",
  expression: "time_expression",
  time_expression: "time_expression",
  temporal_expression: "time_expression",
  sequence: "time_expression",
  duration: "time_expression",
  marker: "time_expression",
}

function normalizeToken(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, "_")
}

export function isMentionType(value: unknown): value is MentionType {
  return value === "cast" || value === "place" || value === "time"
}

export function normalizeSceneMentionRole(
  mentionType: MentionType,
  rawRole: unknown,
): SceneBoundaryMentionRole {
  const token = normalizeToken(rawRole)

  if (mentionType === "cast") {
    return CAST_ROLE_ALIASES[token] ?? "on_stage"
  }

  if (mentionType === "place") {
    return PLACE_ROLE_ALIASES[token] ?? "spatial_container"
  }

  return TIME_ROLE_ALIASES[token] ?? "time_expression"
}

export function inferSceneBoundaryRelevance(
  mentionType: MentionType,
  role: SceneBoundaryMentionRole,
): SceneBoundaryRelevance {
  if (role === "object_or_prop") return "excluded"

  if (mentionType === "cast") {
    return role === "on_stage" ? "direct" : "contextual"
  }

  if (mentionType === "place") {
    return role === "spatial_container" ? "direct" : "contextual"
  }

  return role === "story_time_frame" ? "direct" : "contextual"
}

export function normalizeSceneBoundaryRelevance(
  mentionType: MentionType,
  role: SceneBoundaryMentionRole,
  rawRelevance: unknown,
): SceneBoundaryRelevance {
  const inferred = inferSceneBoundaryRelevance(mentionType, role)
  if (inferred === "excluded") return inferred

  const token = normalizeToken(rawRelevance)
  if (token === "direct" || token === "primary") return "direct"
  if (token === "contextual" || token === "secondary") return "contextual"
  if (token === "excluded" || token === "exclude") return "excluded"
  return inferred
}

export function boundaryDimensionForMentionType(
  mentionType: MentionType,
): SceneBoundaryDimension {
  if (mentionType === "cast") return "character_constellation"
  if (mentionType === "place") return "space"
  return "time"
}

export function isBoundarySignal(relevance: SceneBoundaryRelevance): boolean {
  return relevance === "direct"
}

export function normalizeV3SceneMention(
  mention: Mention,
  raw: {
    scene_role?: unknown
    boundary_relevance?: unknown
    boundary_signal?: unknown
    rationale?: unknown
  },
): V3SceneMention {
  const sceneRole = normalizeSceneMentionRole(mention.mention_type, raw.scene_role)
  const relevance = normalizeSceneBoundaryRelevance(
    mention.mention_type,
    sceneRole,
    raw.boundary_relevance,
  )

  return {
    ...mention,
    scene_role: sceneRole,
    boundary_relevance: relevance,
    boundary_signal: isBoundarySignal(relevance),
    boundary_dimension: boundaryDimensionForMentionType(mention.mention_type),
    ...(typeof raw.rationale === "string" && raw.rationale.trim()
      ? { rationale: raw.rationale.trim() }
      : {}),
  }
}

export function countV3Mentions(mentions: V3SceneMention[]): Pick<
  V3MentionCandidates["extraction_stats"],
  "accepted_boundary_mentions" | "contextual_mentions" | "by_type" | "by_role"
> {
  const byType: Record<MentionType, number> = {
    cast: 0,
    place: 0,
    time: 0,
  }
  const byRole: Partial<Record<SceneBoundaryMentionRole, number>> = {}
  let acceptedBoundaryMentions = 0
  let contextualMentions = 0

  for (const mention of mentions) {
    byType[mention.mention_type] += 1
    byRole[mention.scene_role] = (byRole[mention.scene_role] ?? 0) + 1
    if (mention.boundary_signal) acceptedBoundaryMentions += 1
    if (mention.boundary_relevance === "contextual") contextualMentions += 1
  }

  return {
    accepted_boundary_mentions: acceptedBoundaryMentions,
    contextual_mentions: contextualMentions,
    by_type: byType,
    by_role: byRole,
  }
}
