import test from "node:test"
import assert from "node:assert/strict"
import { buildV3TimelineGraphModel } from "../src/components/v3/timeline-graph/model.ts"
import type {
  V3EventCandidate,
  V3EventEvidenceOccurrence,
} from "../src/lib/pipeline/v3-event-types.ts"
import type { V3SceneCandidate } from "../src/lib/pipeline/v3-scene-types.ts"

function occurrence(
  id: string,
  candidateType: V3EventEvidenceOccurrence["candidate_type"],
  label: string,
  extras: Partial<V3EventEvidenceOccurrence> = {},
): V3EventEvidenceOccurrence {
  return {
    source_candidate_id: id,
    refined_candidate_id: `ref-${id}`,
    candidate_type: candidateType,
    status: "kept_context",
    pid: 1,
    span: label,
    start_char: 0,
    end_char: label.length,
    label,
    ...extras,
  }
}

function event(
  id: string,
  sequenceIndex: number,
  ids: Partial<Pick<
    V3EventCandidate,
    "cast_ids" | "place_ids" | "time_ids" | "object_ids" | "goal_ids" | "causality_ids"
  >>,
): V3EventCandidate {
  return {
    event_id: id,
    sequence_index: sequenceIndex,
    grouping_source: "llm",
    start_pid: sequenceIndex,
    end_pid: sequenceIndex,
    summary: `Event ${sequenceIndex}`,
    anchor_action_ids: [],
    evidence_ids: [],
    cast_ids: [],
    place_ids: [],
    time_ids: [],
    object_ids: [],
    goal_ids: [],
    causality_ids: [],
    ...ids,
  }
}

function scene(id: string, eventIds: string[]): V3SceneCandidate {
  return {
    scene_id: id,
    sequence_index: 1,
    grouping_source: "llm",
    start_event_id: eventIds[0],
    end_event_id: eventIds[eventIds.length - 1],
    event_ids: eventIds,
    start_pid: 1,
    end_pid: eventIds.length,
    summary: "A scene",
    time_axis: { label: "same time", evidence_event_ids: eventIds },
    place_axis: { label: "same place", evidence_event_ids: eventIds },
    action_focus_axis: { label: "same focus", evidence_event_ids: eventIds },
    cast_axis: { label: "same cast", evidence_event_ids: eventIds },
    boundary_basis: ["place"],
  }
}

test("buildV3TimelineGraphModel connects repeated axis elements across event columns", () => {
  const model = buildV3TimelineGraphModel({
    events: [
      event("e1", 1, { cast_ids: ["alice-1"], goal_ids: ["goal-1"] }),
      event("e2", 2, { cast_ids: ["alice-2"], place_ids: ["hall"] }),
      event("e3", 3, { cast_ids: ["rabbit"] }),
    ],
    occurrences: [
      occurrence("alice-1", "cast", "Alice", {
        entity_cluster_id: "cast-alice",
        entity_cluster_label: "Alice",
      }),
      occurrence("alice-2", "cast", "she", {
        entity_cluster_id: "cast-alice",
        entity_cluster_label: "Alice",
      }),
      occurrence("rabbit", "cast", "White Rabbit", {
        entity_cluster_id: "cast-rabbit",
        entity_cluster_label: "White Rabbit",
      }),
      occurrence("hall", "place", "hall"),
      occurrence("goal-1", "goal", "to enter the garden", {
        goal_text: "enter the garden",
      }),
    ],
    scenes: [scene("s1", ["e1", "e2"])],
  })

  assert.equal(model.events.length, 3)
  assert.equal(model.axisNodes.cast.length, 3)
  assert.equal(model.axisNodes.goal[0].label, "enter the garden")
  assert.deepEqual(
    model.repeatedLinks.map((link) => [link.axis, link.key, link.startEventIndex, link.endEventIndex]),
    [["cast", "cast:cast-alice", 0, 1]],
  )
  assert.deepEqual(
    model.sceneBands.map((band) => [band.sceneId, band.startEventIndex, band.endEventIndex]),
    [["s1", 0, 1]],
  )
})

test("buildV3TimelineGraphModel hides support evidence from axis nodes", () => {
  const model = buildV3TimelineGraphModel({
    events: [
      event("e1", 1, {
        cast_ids: ["alice-core", "reader-support"],
        place_ids: ["mind-support"],
        object_ids: ["watch-core"],
      }),
      event("e2", 2, {
        object_ids: ["watch-core-2"],
      }),
    ],
    occurrences: [
      occurrence("alice-core", "cast", "Alice", {
        gate: "core",
        entity_cluster_id: "cast-alice",
        entity_cluster_label: "Alice",
      }),
      occurrence("reader-support", "cast", "you", {
        gate: "support",
        entity_cluster_id: "cast-reader",
        entity_cluster_label: "reader",
      }),
      occurrence("mind-support", "place", "her mind", {
        gate: "support",
        entity_cluster_id: "place-mind",
        entity_cluster_label: "Alice's mind",
      }),
      occurrence("watch-core", "object", "a watch", {
        gate: "core",
        entity_cluster_id: "object-watch",
        entity_cluster_label: "watch",
      }),
      occurrence("watch-core-2", "object", "the watch", {
        gate: "core",
        entity_cluster_id: "object-watch",
        entity_cluster_label: "watch",
      }),
    ],
    scenes: [scene("s1", ["e1", "e2"])],
  })

  assert.deepEqual(model.axisNodes.cast.map((node) => node.label), ["Alice"])
  assert.deepEqual(model.axisNodes.place, [])
  assert.deepEqual(model.axisNodes.object.map((node) => node.label), ["watch", "watch"])
})

test("buildV3TimelineGraphModel shows non-weak place nodes even when they appear once", () => {
  const model = buildV3TimelineGraphModel({
    events: [
      event("e1", 1, {
        place_ids: ["hall-1", "corner", "air-1"],
        time_ids: ["this-time-1", "hot-day"],
        object_ids: ["key-1", "book"],
      }),
      event("e2", 2, {
        place_ids: ["hall-2", "air-2"],
        time_ids: ["this-time-2"],
        object_ids: ["key-2", "table"],
      }),
      event("e3", 3, {
        place_ids: ["field"],
      }),
    ],
    occurrences: [
      occurrence("hall-1", "place", "a long hall", {
        gate: "core",
        gate_basis: "current_setting",
        entity_cluster_id: "place-hall",
        entity_cluster_label: "hall",
      }),
      occurrence("corner", "place", "the corner", {
        gate: "core",
        gate_basis: "current_setting",
        entity_cluster_id: "place-corner",
        entity_cluster_label: "corner",
      }),
      occurrence("hall-2", "place", "the hall", {
        gate: "core",
        gate_basis: "current_setting",
        entity_cluster_id: "place-hall",
        entity_cluster_label: "hall",
      }),
      occurrence("air-1", "place", "the air", {
        gate: "core",
        gate_basis: "current_setting",
        entity_cluster_id: "place-air",
        entity_cluster_label: "the air",
      }),
      occurrence("air-2", "place", "the air", {
        gate: "core",
        gate_basis: "current_setting",
        entity_cluster_id: "place-air",
        entity_cluster_label: "the air",
      }),
      occurrence("field", "place", "the field", {
        gate: "core",
        gate_basis: "current_setting",
        entity_cluster_id: "place-field",
        entity_cluster_label: "field",
      }),
      occurrence("this-time-1", "time", "this time", {
        gate: "core",
        gate_basis: "temporal_anchor",
        entity_cluster_id: "time-this-1",
        entity_cluster_label: "this time",
      }),
      occurrence("hot-day", "time", "the hot day", {
        gate: "core",
        gate_basis: "temporal_anchor",
        entity_cluster_id: "time-hot-day",
        entity_cluster_label: "hot day",
      }),
      occurrence("this-time-2", "time", "this time", {
        gate: "core",
        gate_basis: "temporal_anchor",
        entity_cluster_id: "time-this-2",
        entity_cluster_label: "this time",
      }),
      occurrence("key-1", "object", "a tiny golden key", {
        gate: "core",
        gate_basis: "event_object",
        entity_cluster_id: "object-key",
        entity_cluster_label: "golden key",
      }),
      occurrence("book", "object", "the book", {
        gate: "core",
        gate_basis: "event_object",
        entity_cluster_id: "object-book",
        entity_cluster_label: "book",
      }),
      occurrence("key-2", "object", "the key", {
        gate: "core",
        gate_basis: "event_object",
        entity_cluster_id: "object-key",
        entity_cluster_label: "golden key",
      }),
      occurrence("table", "object", "the table", {
        gate: "core",
        gate_basis: "event_object",
        entity_cluster_id: "object-table",
        entity_cluster_label: "table",
      }),
    ],
    scenes: [scene("s1", ["e1", "e2"])],
  })

  assert.deepEqual(model.axisNodes.place.map((node) => node.label), ["hall", "corner", "hall", "field"])
  assert.deepEqual(
    model.axisNodes.place.map((node) => [node.label, node.eventIndex, node.laneIndex]),
    [
      ["hall", 0, 0],
      ["corner", 0, 1],
      ["hall", 1, 0],
      ["field", 2, 0],
    ],
  )
  assert.deepEqual(model.axisNodes.time.map((node) => node.label), ["hot day"])
  assert.deepEqual(model.axisNodes.object.map((node) => node.label), ["golden key", "golden key"])
  assert.deepEqual(
    model.repeatedLinks.map((link) => [link.axis, link.label, link.laneIndex, link.startEventIndex, link.endEventIndex]),
    [
      ["place", "hall", 0, 0, 1],
      ["object", "golden key", 0, 0, 1],
    ],
  )
})
