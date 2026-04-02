/**
 * STATE.1 — State Tracking (fully rule-based)
 * Port of Story-Decomposition/src/viewer/state_tracking.py
 */

import type {
  EntityGraph,
  RawChapter,
  StateFrames,
  StateFrame,
  ObservedEntities,
  ActiveState,
  Transitions,
  PlaceShift,
} from "@/types/schema"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CAST_WINDOW = 2
const PLACE_SET_THRESHOLD = 2.0
const PLACE_SHIFT_THRESHOLD = 3.0
const CARRY_GAP = 1

const SPATIAL_PREPS = [
  "in", "into", "inside", "through", "throughout", "at", "to", "from",
  "near", "outside", "within", "under", "over", "on", "across", "along",
  "around", "beside", "between", "beyond", "down", "up",
]

// ---------------------------------------------------------------------------
// Index building
// ---------------------------------------------------------------------------

function buildPidIndex(entityLog: EntityGraph) {
  const pidCast = new Map<number, Set<string>>()
  const pidPlace = new Map<number, Set<string>>()
  const pidTime = new Map<number, Set<string>>()
  const spans = new Map<string, string[]>() // `${entityId}__${pid}` → spans

  for (const entity of entityLog.entities) {
    const target =
      entity.mention_type === "cast"
        ? pidCast
        : entity.mention_type === "place"
          ? pidPlace
          : pidTime

    for (const m of entity.mentions) {
      const set = target.get(m.pid) ?? new Set<string>()
      set.add(entity.entity_id)
      target.set(m.pid, set)

      const key = `${entity.entity_id}__${m.pid}`
      const list = spans.get(key) ?? []
      list.push(m.span)
      spans.set(key, list)
    }
  }

  // place_unique_pids: how many unique pids each place entity appears in
  const placeUniquePids = new Map<string, number>()
  for (const entity of entityLog.entities) {
    if (entity.mention_type === "place") {
      placeUniquePids.set(entity.entity_id, new Set(entity.mentions.map((m) => m.pid)).size)
    }
  }

  return { pidCast, pidPlace, pidTime, spans, placeUniquePids }
}

// ---------------------------------------------------------------------------
// Place score computation
// ---------------------------------------------------------------------------

function computePlaceScores(
  pid: number,
  pidPlace: Map<number, Set<string>>,
  placeUniquePids: Map<string, number>,
  spans: Map<string, string[]>,
  pidToText: Map<number, string>,
): Map<string, number> {
  const scores = new Map<string, number>()
  const obs = pidPlace.get(pid)
  if (!obs) return scores

  for (const eid of obs) {
    let score = 1.0
    if (pidPlace.get(pid - 1)?.has(eid)) score += 1.0
    if (pidPlace.get(pid + 1)?.has(eid)) score += 1.0
    if ((placeUniquePids.get(eid) ?? 0) >= 2) score += 0.5

    const text = pidToText.get(pid) ?? ""
    const entitySpans = spans.get(`${eid}__${pid}`) ?? []
    for (const span of entitySpans) {
      const escaped = span.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      const pattern = new RegExp(`\\b(${SPATIAL_PREPS.join("|")})\\s+(the\\s+)?${escaped}`, "i")
      if (pattern.test(text)) { score += 1.0; break }
    }

    scores.set(eid, score)
  }
  return scores
}

// ---------------------------------------------------------------------------
// CastTracker
// ---------------------------------------------------------------------------

class CastTracker {
  private lastSeen = new Map<string, number>()
  private prevActive = new Set<string>()

  update(pid: number, observed: Set<string>): {
    active: Set<string>
    castEnter: string[]
    castExitCandidates: string[]
  } {
    for (const eid of observed) this.lastSeen.set(eid, pid)

    const currActive = new Set<string>()
    for (const [eid, lastPid] of this.lastSeen) {
      if (pid - lastPid <= CAST_WINDOW) currActive.add(eid)
    }

    const castEnter = [...currActive].filter((e) => !this.prevActive.has(e)).sort()
    const castExitCandidates = [...this.prevActive].filter((e) => !currActive.has(e)).sort()

    this.prevActive = currActive
    return { active: currActive, castEnter, castExitCandidates }
  }
}

// ---------------------------------------------------------------------------
// PlaceTracker
// ---------------------------------------------------------------------------

class PlaceTracker {
  private currentPlace: string | undefined
  private lastSeenPid: number | undefined

  update(
    pid: number,
    scoreMap: Map<string, number>,
  ): { place: string | undefined; placeSet?: string; placeShift?: PlaceShift } {
    if (scoreMap.size === 0) {
      if (
        this.currentPlace &&
        this.lastSeenPid !== undefined &&
        pid - this.lastSeenPid <= CARRY_GAP
      ) {
        return { place: this.currentPlace }
      }
      return { place: undefined }
    }

    let best: string | undefined
    let bestScore = -Infinity
    for (const [eid, score] of scoreMap) {
      if (score > bestScore) { best = eid; bestScore = score }
    }

    if (!best) return { place: undefined }
    this.lastSeenPid = pid

    if (!this.currentPlace) {
      if (bestScore >= PLACE_SET_THRESHOLD) {
        this.currentPlace = best
        return { place: best, placeSet: best }
      }
      return { place: undefined }
    }

    if (best !== this.currentPlace && bestScore >= PLACE_SHIFT_THRESHOLD) {
      const shift: PlaceShift = { from: this.currentPlace, to: best }
      this.currentPlace = best
      return { place: best, placeShift: shift }
    }

    return { place: this.currentPlace }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function runStateTracking(
  entityLog: EntityGraph,
  chapter: RawChapter,
  docId: string,
  chapterId: string,
  parents: Record<string, string> = {},
): StateFrames {
  const { pidCast, pidPlace, pidTime, spans, placeUniquePids } =
    buildPidIndex(entityLog)

  const pidToText = new Map(chapter.paragraphs.map((p) => [p.pid, p.text]))
  const sortedPids = [...chapter.paragraphs.map((p) => p.pid)].sort((a, b) => a - b)

  const castTracker = new CastTracker()
  const placeTracker = new PlaceTracker()

  const frames: StateFrame[] = []

  for (const pid of sortedPids) {
    const obsCast = pidCast.get(pid) ?? new Set<string>()
    const scoreMap = computePlaceScores(pid, pidPlace, placeUniquePids, spans, pidToText)
    const obsTime = pidTime.get(pid) ?? new Set<string>()

    const { active, castEnter, castExitCandidates } = castTracker.update(pid, obsCast)
    const { place, placeSet, placeShift } = placeTracker.update(pid, scoreMap)

    // time_signals: collect span texts for all time entities observed in this pid
    const timeSignals: string[] = []
    for (const eid of obsTime) {
      const s = spans.get(`${eid}__${pid}`) ?? []
      timeSignals.push(...s)
    }

    const observed: ObservedEntities = {
      cast: [...obsCast],
      place: [...scoreMap.keys()],
      time: [...obsTime],
    }

    const state: ActiveState = {
      active_cast: [...active],
      primary_place: place,
    }

    const transitions: Transitions = {
      cast_enter: castEnter,
      cast_exit_candidates: castExitCandidates,
      place_set: placeSet,
      place_shift: placeShift,
      time_signals: timeSignals,
    }

    frames.push({ pid, observed, state, transitions })
  }

  const runId = `state_tracking__${docId}__${chapterId}`
  return {
    run_id: runId,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: "STATE.1",
    method: "rule",
    parents,
    frames,
  }
}
