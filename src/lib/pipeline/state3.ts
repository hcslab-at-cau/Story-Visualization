/**
 * STATE.3 — Boundary Detection (rule-based) + optional LLM title generation
 * Port of Story-Decomposition/src/viewer/boundary_detection.py
 */

import type {
  RefinedStateFrames,
  StateFrames,
  SceneBoundaries,
  BoundaryCandidate,
  SceneSpan,
  BoundaryReason,
  ValidatedFrame,
} from "@/types/schema"
import type { LLMClient } from "@/lib/llm-client"
import { formatJsonParam } from "@/lib/prompt-loader"

// ---------------------------------------------------------------------------
// Score weights
// ---------------------------------------------------------------------------

const SCORE_PLACE_SHIFT = 4.0
const SCORE_PLACE_SET_AFTER = 2.0
const SCORE_CAST_HIGH = 2.0
const SCORE_CAST_MED = 1.0
const SCORE_TIME_SIGNAL = 1.0

const LABEL_SCENE = 4.0
const LABEL_WEAK = 3.0
const MIN_SCENE_LEN = 2

// ---------------------------------------------------------------------------
// Score a single boundary between two adjacent narrative frames
// ---------------------------------------------------------------------------

function scoreBoundary(
  prev: ValidatedFrame,
  curr: ValidatedFrame,
  hadPlaceBefore: boolean,
  timeSignals: string[],
): { reasons: BoundaryReason[]; score: number } {
  let score = 0
  const reasons: BoundaryReason[] = []

  const prevPlace = prev.validated_state.current_place
  const currPlace = curr.validated_state.current_place

  if (prevPlace && currPlace && prevPlace !== currPlace) {
    score += SCORE_PLACE_SHIFT
    reasons.push({ type: "place_shift", from_place: prevPlace, to_place: currPlace })
  } else if (!prevPlace && currPlace && hadPlaceBefore) {
    score += SCORE_PLACE_SET_AFTER
    reasons.push({ type: "place_set_after_previous_place", to_place: currPlace })
  }

  const prevCast = new Set(prev.validated_state.active_cast)
  const currCast = new Set(curr.validated_state.active_cast)
  const union = new Set([...prevCast, ...currCast])
  const intersection = new Set([...prevCast].filter((c) => currCast.has(c)))
  const delta = union.size > 0 ? 1.0 - intersection.size / union.size : 0
  const turnover = union.size - intersection.size * 2

  if (delta >= 0.75 && turnover >= 2) {
    score += SCORE_CAST_HIGH
    reasons.push({ type: "cast_turnover", delta, turnover })
  } else if (delta >= 0.5 && turnover >= 1) {
    score += SCORE_CAST_MED
    reasons.push({ type: "cast_turnover", delta, turnover })
  }

  if (timeSignals.length > 0) {
    score += SCORE_TIME_SIGNAL
    reasons.push({ type: "time_signal", signals: timeSignals })
  }

  return { reasons, score }
}

// ---------------------------------------------------------------------------
// Resolve competing boundaries (within proximity=1 pid)
// ---------------------------------------------------------------------------

function resolveCompeting(
  candidates: BoundaryCandidate[],
  proximity = 1,
): BoundaryCandidate[] {
  if (candidates.length === 0) return []
  const resolved: BoundaryCandidate[] = [candidates[0]]
  for (const cand of candidates.slice(1)) {
    const prev = resolved[resolved.length - 1]
    if (cand.boundary_before_pid - prev.boundary_before_pid <= proximity) {
      if (cand.score > prev.score) resolved[resolved.length - 1] = cand
    } else {
      resolved.push(cand)
    }
  }
  return resolved
}

// ---------------------------------------------------------------------------
// Enforce minimum scene length
// ---------------------------------------------------------------------------

function enforceMinSceneLen(
  boundaryPids: number[],
  narrativePids: number[],
  scoreByPid: Map<number, number>,
  minLen = MIN_SCENE_LEN,
): number[] {
  let pids = [...boundaryPids]
  let changed = true
  while (changed) {
    changed = false
    const starts = [narrativePids[0], ...pids.sort((a, b) => a - b)]
    for (let i = 0; i < starts.length; i++) {
      const sceneStart = starts[i]
      const sceneEnd = i + 1 < starts.length ? starts[i + 1] - 1 : narrativePids[narrativePids.length - 1]
      const sceneLen = narrativePids.filter((p) => p >= sceneStart && p <= sceneEnd).length
      if (sceneLen < minLen) {
        // remove the lower-scored boundary adjacent to this short scene
        const leftBoundary = starts[i] // boundary_before_pid of this scene = starts[i] itself if i>0
        const rightBoundary = starts[i + 1]
        const leftScore = leftBoundary !== narrativePids[0] ? (scoreByPid.get(leftBoundary) ?? 0) : Infinity
        const rightScore = rightBoundary !== undefined ? (scoreByPid.get(rightBoundary) ?? 0) : Infinity
        const drop = leftScore <= rightScore ? leftBoundary : rightBoundary
        if (drop !== undefined && pids.includes(drop)) {
          pids = pids.filter((p) => p !== drop)
          changed = true
          break
        }
      }
    }
  }
  return pids
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runBoundaryDetection(
  validatedLog: RefinedStateFrames,
  docId: string,
  chapterId: string,
  parents: Record<string, string> = {},
  stateLog?: StateFrames,
  llmClient?: LLMClient,
  paragraphMap?: Map<number, string>,
  onProgress?: (msg: string) => void,
): Promise<SceneBoundaries> {
  onProgress?.("STATE.3: detecting scene boundaries...")

  // Only narrative frames, sorted by pid
  const narrativeFrames = validatedLog.frames
    .filter((f) => f.is_narrative)
    .sort((a, b) => a.pid - b.pid)

  if (narrativeFrames.length === 0) {
    const runId = `boundary_detection__${docId}__${chapterId}`
    return {
      run_id: runId,
      doc_id: docId,
      chapter_id: chapterId,
      stage_id: "STATE.3",
      method: "rule",
      parents,
      boundaries: [],
      scenes: [{ scene_id: "scene_01", start_pid: 0, end_pid: 0 }],
      scene_titles: {},
    }
  }

  // Build time signal lookup from STATE.1 if available
  const timeSignalsByPid = new Map<number, string[]>()
  if (stateLog) {
    for (const f of stateLog.frames) {
      if (f.transitions.time_signals.length > 0) {
        timeSignalsByPid.set(f.pid, f.transitions.time_signals)
      }
    }
  }

  // Score adjacent frame pairs
  let hadPlaceBefore = false
  const rawCandidates: BoundaryCandidate[] = []
  const scoreByPid = new Map<number, number>()

  for (let i = 1; i < narrativeFrames.length; i++) {
    const prev = narrativeFrames[i - 1]
    const curr = narrativeFrames[i]
    const timeSignals = timeSignalsByPid.get(curr.pid) ?? []
    const { reasons, score } = scoreBoundary(prev, curr, hadPlaceBefore, timeSignals)

    if (prev.validated_state.current_place) hadPlaceBefore = true

    if (score >= LABEL_WEAK) {
      const label = score >= LABEL_SCENE ? "scene_boundary" : "weak_boundary_candidate"
      rawCandidates.push({
        boundary_before_pid: curr.pid,
        score,
        label,
        reasons,
      })
      scoreByPid.set(curr.pid, score)
    }
  }

  // Post-processing
  const resolved = resolveCompeting(rawCandidates)
  let sceneBoundaryPids = resolved
    .filter((c) => c.label === "scene_boundary")
    .map((c) => c.boundary_before_pid)

  const narrativePids = narrativeFrames.map((f) => f.pid)
  sceneBoundaryPids = enforceMinSceneLen(sceneBoundaryPids, narrativePids, scoreByPid)

  // Build scene spans
  const sceneStarts = [narrativePids[0], ...sceneBoundaryPids.sort((a, b) => a - b)]
  const scenes: SceneSpan[] = sceneStarts.map((start, i) => {
    const end =
      i + 1 < sceneStarts.length
        ? narrativePids[narrativePids.indexOf(sceneStarts[i + 1]) - 1]
        : narrativePids[narrativePids.length - 1]
    return {
      scene_id: `scene_${String(i + 1).padStart(2, "0")}`,
      start_pid: start,
      end_pid: end,
    }
  })

  // Optional: LLM scene title generation
  let sceneTitles: Record<string, string> = {}
  if (llmClient && paragraphMap) {
    onProgress?.("STATE.3: generating scene titles...")
    try {
      const frameMap = new Map(validatedLog.frames.map((f) => [f.pid, f]))
      const scenesContext = scenes.map((s) => {
        const pidsInScene = narrativePids.filter((p) => p >= s.start_pid && p <= s.end_pid)
        const startFrame = frameMap.get(pidsInScene[0])
        const endFrame = frameMap.get(pidsInScene[pidsInScene.length - 1])
        const textPreview = pidsInScene
          .slice(0, 3)
          .map((p) => paragraphMap.get(p) ?? "")
          .join(" ")
          .slice(0, 400)
        return {
          scene_id: s.scene_id,
          start_pid: s.start_pid,
          end_pid: s.end_pid,
          start_place: startFrame?.validated_state.current_place ?? null,
          end_place: endFrame?.validated_state.current_place ?? null,
          active_cast: startFrame?.validated_state.active_cast ?? [],
          text_preview: textPreview,
        }
      })

      const titleResult = await llmClient.generateSceneTitles({
        scenes_json: formatJsonParam(scenesContext),
      })
      sceneTitles = (titleResult.scene_titles as Record<string, string>) ?? {}
    } catch {
      // Title generation failure is non-fatal
    }
  }

  const runId = `boundary_detection__${docId}__${chapterId}`
  return {
    run_id: runId,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: "STATE.3",
    method: "rule",
    parents,
    boundaries: resolved,
    scenes,
    scene_titles: sceneTitles,
  }
}
