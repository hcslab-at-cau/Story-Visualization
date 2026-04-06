/**
 * SCENE.1 — Scene Packet Builder (fully rule-based)
 * Port of Story-Decomposition/src/viewer/scene_packet.py
 */

import type {
  SceneBoundaries,
  RefinedStateFrames,
  StateFrames,
  EntityGraph,
  RawChapter,
  ScenePackets,
  ScenePacket,
  PhaseMarker,
} from "@/types/schema"
import { normalizePidKey } from "@/lib/prompt-loader"

export function runScenePacketBuilder(
  boundaryLog: SceneBoundaries,
  validatedLog: RefinedStateFrames,
  stateLog: StateFrames,
  entityLog: EntityGraph,
  chapter: RawChapter,
  docId: string,
  chapterId: string,
  parents: Record<string, string> = {},
): ScenePackets {
  // Build indexes
  const pidToFrame = new Map(validatedLog.frames.map((f) => [normalizePidKey(f.pid), f]))
  const narrativePids = new Set(
    validatedLog.frames.filter((f) => f.is_narrative).map((f) => normalizePidKey(f.pid)),
  )
  const pidToText = new Map(chapter.paragraphs.map((p) => [p.pid, p.text]))

  const pidToTimeSignals = new Map<number, string[]>()
  for (const f of stateLog.frames) {
    if (f.transitions.time_signals.length > 0) {
      pidToTimeSignals.set(f.pid, f.transitions.time_signals)
    }
  }

  const canonicalToEid = new Map<string, string>()
  const eidToCanonical = new Map<string, string>()
  for (const e of entityLog.entities) {
    canonicalToEid.set(e.canonical_name, e.entity_id)
    eidToCanonical.set(e.entity_id, e.canonical_name)
  }

  // Build scene packets
  const packets: ScenePacket[] = boundaryLog.scenes.map((scene, sceneIdx) => {
    // Narrative pids within this scene's range
    const pids = chapter.paragraphs
      .map((p) => p.pid)
      .filter(
        (pid) => narrativePids.has(normalizePidKey(pid)) && pid >= scene.start_pid && pid <= scene.end_pid,
      )

    const sceneText = pids
      .map((pid) => `[P${pid}] ${pidToText.get(pid) ?? ""}`)
      .join("\n\n")

    const startFrame = pids.length > 0 ? pidToFrame.get(normalizePidKey(pids[0])) : undefined
    const endFrame = pids.length > 0 ? pidToFrame.get(normalizePidKey(pids[pids.length - 1])) : undefined

    // Aggregate cast, places, time — in order, deduplicated
    const castSeen = new Set<string>()
    const placeCurrentSeen = new Set<string>()
    const placeMentionedSeen = new Set<string>()
    const timeSeen = new Set<string>()
    const castUnion: string[] = []
    const currentPlaces: string[] = []
    const mentionedPlaces: string[] = []
    const timeSignals: string[] = []

    for (const pid of pids) {
      const frame = pidToFrame.get(normalizePidKey(pid))
      if (!frame) continue
      for (const c of frame.validated_state.active_cast) {
        if (!castSeen.has(c)) { castUnion.push(c); castSeen.add(c) }
      }
      if (frame.validated_state.current_place && !placeCurrentSeen.has(frame.validated_state.current_place)) {
        currentPlaces.push(frame.validated_state.current_place)
        placeCurrentSeen.add(frame.validated_state.current_place)
      }
      if (frame.validated_state.mentioned_place && !placeMentionedSeen.has(frame.validated_state.mentioned_place)) {
        mentionedPlaces.push(frame.validated_state.mentioned_place)
        placeMentionedSeen.add(frame.validated_state.mentioned_place)
      }
      for (const sig of pidToTimeSignals.get(pid) ?? []) {
        if (!timeSeen.has(sig)) { timeSignals.push(sig); timeSeen.add(sig) }
      }
    }

    // Entity registry: canonical_name → entity_id (for cast + places in this scene)
    const entityRegistry: Record<string, string> = {}
    for (const name of [...castUnion, ...currentPlaces, ...mentionedPlaces]) {
      const eid = canonicalToEid.get(name)
      if (eid) entityRegistry[name] = eid
    }

    // Phase markers: weak boundary candidates inside this scene
    const phaseMarkers: PhaseMarker[] = boundaryLog.boundaries.filter(
      (b) =>
        b.label === "weak_boundary_candidate" &&
        b.boundary_before_pid > scene.start_pid &&
        b.boundary_before_pid <= scene.end_pid,
    ).map((b) => ({
      boundary_before_pid: b.boundary_before_pid,
      score: b.score,
      label: b.label,
    }))

    const startState = startFrame
      ? {
          current_place: startFrame.validated_state.current_place,
          mentioned_place: startFrame.validated_state.mentioned_place,
          active_cast: startFrame.validated_state.active_cast,
        }
      : {}

    const endState = endFrame
      ? {
          current_place: endFrame.validated_state.current_place,
          mentioned_place: endFrame.validated_state.mentioned_place,
          active_cast: endFrame.validated_state.active_cast,
        }
      : {}

    return {
      scene_id: scene.scene_id,
      start_pid: scene.start_pid,
      end_pid: scene.end_pid,
      pids,
      scene_text_with_pid_markers: sceneText,
      start_state: startState,
      end_state: endState,
      scene_cast_union: castUnion,
      scene_current_places: currentPlaces,
      scene_mentioned_places: mentionedPlaces,
      scene_time_signals: timeSignals,
      phase_markers: phaseMarkers,
      entity_registry: entityRegistry,
      previous_scene_id: sceneIdx > 0 ? boundaryLog.scenes[sceneIdx - 1].scene_id : undefined,
      next_scene_id: sceneIdx + 1 < boundaryLog.scenes.length ? boundaryLog.scenes[sceneIdx + 1].scene_id : undefined,
    }
  })

  const runId = `scene_packet__${docId}__${chapterId}`
  return {
    run_id: runId,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: "SCENE.1",
    method: "rule",
    parents,
    packets,
  }
}
