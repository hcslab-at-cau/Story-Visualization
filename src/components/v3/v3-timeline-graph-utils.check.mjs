import assert from "node:assert/strict"
import {
  buildV3TimelineGraphModel,
  getSelectedTimelineLinks,
  getSelectedTimelineNodes,
  timelineSelectionEventIndexes,
} from "./timeline-graph/model.ts"

const nodes = [
  {
    id: "e3-cast-alice",
    axis: "cast",
    eventId: "event_3",
    eventIndex: 2,
    laneIndex: 0,
    key: "cast:alice",
    label: "Alice",
    count: 1,
  },
  {
    id: "e3-place-bank",
    axis: "place",
    eventId: "event_3",
    eventIndex: 2,
    laneIndex: 0,
    key: "place:river bank",
    label: "river bank",
    count: 1,
  },
  {
    id: "e1-cast-alice",
    axis: "cast",
    eventId: "event_1",
    eventIndex: 0,
    laneIndex: 0,
    key: "cast:alice",
    label: "Alice",
    count: 2,
  },
  {
    id: "e2-cast-sister",
    axis: "cast",
    eventId: "event_2",
    eventIndex: 1,
    laneIndex: 1,
    key: "cast:sister",
    label: "Alice's sister",
    count: 1,
  },
]

const links = [
  {
    axis: "cast",
    key: "cast:alice",
    label: "Alice",
    startEventIndex: 0,
    endEventIndex: 2,
  },
  {
    axis: "cast",
    key: "cast:sister",
    label: "Alice's sister",
    startEventIndex: 1,
    endEventIndex: 2,
  },
  {
    axis: "place",
    key: "place:river bank",
    label: "river bank",
    startEventIndex: 0,
    endEventIndex: 2,
  },
]

const selection = { axis: "cast", key: "cast:alice" }

assert.deepEqual(
  getSelectedTimelineNodes(nodes, selection).map((node) => node.id),
  ["e1-cast-alice", "e3-cast-alice"],
)

assert.deepEqual(
  getSelectedTimelineLinks(links, selection).map((link) => link.label),
  ["Alice"],
)

assert.deepEqual(
  timelineSelectionEventIndexes(nodes, selection),
  [0, 2],
)

const model = buildV3TimelineGraphModel({
  events: [
    {
      event_id: "event_1",
      sequence_index: 1,
      grouping_source: "llm",
      start_pid: 1,
      end_pid: 1,
      summary: "Alice and her sister sit by the bank.",
      anchor_action_ids: [],
      evidence_ids: [],
      cast_ids: ["alice_e1", "sister_e1"],
      place_ids: [],
      time_ids: [],
      object_ids: [],
      goal_ids: [],
      causality_ids: [],
    },
    {
      event_id: "event_2",
      sequence_index: 2,
      grouping_source: "llm",
      start_pid: 2,
      end_pid: 2,
      summary: "Alice thinks about making a daisy-chain.",
      anchor_action_ids: [],
      evidence_ids: [],
      cast_ids: ["alice_e2"],
      place_ids: [],
      time_ids: [],
      object_ids: [],
      goal_ids: [],
      causality_ids: [],
    },
    {
      event_id: "event_3",
      sequence_index: 3,
      grouping_source: "llm",
      start_pid: 3,
      end_pid: 3,
      summary: "The White Rabbit runs by Alice.",
      anchor_action_ids: [],
      evidence_ids: [],
      cast_ids: ["rabbit_e3", "alice_e3"],
      place_ids: [],
      time_ids: [],
      object_ids: [],
      goal_ids: [],
      causality_ids: [],
    },
  ],
  occurrences: [
    {
      source_candidate_id: "alice_e1",
      refined_candidate_id: "alice_e1",
      candidate_type: "entity",
      status: "kept",
      pid: 1,
      span: "Alice",
      start_char: 0,
      end_char: 5,
      entity_cluster_id: "alice",
      entity_cluster_label: "Alice",
    },
    {
      source_candidate_id: "sister_e1",
      refined_candidate_id: "sister_e1",
      candidate_type: "entity",
      status: "kept",
      pid: 1,
      span: "her sister",
      start_char: 10,
      end_char: 20,
      entity_cluster_id: "sister",
      entity_cluster_label: "Alice's sister",
    },
    {
      source_candidate_id: "alice_e2",
      refined_candidate_id: "alice_e2",
      candidate_type: "entity",
      status: "kept",
      pid: 2,
      span: "Alice",
      start_char: 0,
      end_char: 5,
      entity_cluster_id: "alice",
      entity_cluster_label: "Alice",
    },
    {
      source_candidate_id: "rabbit_e3",
      refined_candidate_id: "rabbit_e3",
      candidate_type: "entity",
      status: "kept",
      pid: 3,
      span: "White Rabbit",
      start_char: 0,
      end_char: 12,
      entity_cluster_id: "white_rabbit",
      entity_cluster_label: "White Rabbit",
    },
    {
      source_candidate_id: "alice_e3",
      refined_candidate_id: "alice_e3",
      candidate_type: "entity",
      status: "kept",
      pid: 3,
      span: "Alice",
      start_char: 20,
      end_char: 25,
      entity_cluster_id: "alice",
      entity_cluster_label: "Alice",
    },
  ],
  scenes: [],
})

assert.deepEqual(
  model.axisLanes.cast.map((lane) => lane.itemKeys),
  [
    ["cast:alice"],
    ["cast:sister", "cast:white_rabbit"],
  ],
)

assert.deepEqual(
  model.axisNodes.cast.map((node) => [node.label, node.eventIndex, node.laneIndex]),
  [
    ["Alice", 0, 0],
    ["Alice's sister", 0, 1],
    ["Alice", 1, 0],
    ["White Rabbit", 2, 1],
    ["Alice", 2, 0],
  ],
)
