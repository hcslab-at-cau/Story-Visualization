import type {
  V3MemoryContractArtifact,
  V3MemoryEventContract,
  V3MemoryEvidenceRef,
} from "./v3-memory-contract-types"
import type {
  V3EventArgument,
  V3EventFramesArtifact,
  V3SceneSituationCardsArtifact,
  V3SceneSituationRef,
} from "./v3-memory-frames-types"

const V3_SCENE_SITUATION_STAGE_ID = "MEM.1"
const V3_SCENE_SITUATION_PROFILE = "v3_scene_situation_cards"
const V3_SCENE_SITUATION_VERSION = "v3-scene-situation-cards-0.1"
const V3_EVENT_FRAME_STAGE_ID = "EVENT.2"
const V3_EVENT_FRAME_PROFILE = "v3_event_argument_frames"
const V3_EVENT_FRAME_VERSION = "v3-event-argument-frames-0.1"

interface BuildV3SceneSituationCardsParams {
  docId: string
  chapterId: string
  parents?: Record<string, string>
  memoryContract: V3MemoryContractArtifact
}

interface BuildV3EventFramesParams {
  docId: string
  chapterId: string
  parents?: Record<string, string>
  memoryContract: V3MemoryContractArtifact
  sceneCards: V3SceneSituationCardsArtifact
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)))
}

function normalized(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim()
}

function evidenceLabel(ref: V3MemoryEvidenceRef | undefined, fallback: string): string {
  return ref?.entity_cluster_label ?? ref?.label ?? ref?.span ?? fallback
}

function refIdFor(ref: V3MemoryEvidenceRef | undefined, fallback: string): string {
  return ref?.entity_cluster_id ?? ref?.source_candidate_id ?? fallback
}

function refsForEventIds(memoryContract: V3MemoryContractArtifact, eventIds: string[]): string[] {
  const eventIdSet = new Set(eventIds)
  return unique(
    memoryContract.events
      .filter((event) => eventIdSet.has(event.event_id))
      .flatMap((event) => event.evidence_refs),
  )
}

function groupedSceneRefs(
  evidenceById: Map<string, V3MemoryEvidenceRef>,
  refs: string[],
): V3SceneSituationRef[] {
  const grouped = new Map<string, V3SceneSituationRef>()
  for (const evidenceId of refs) {
    const evidence = evidenceById.get(evidenceId)
    if (!evidence) continue
    const refId = refIdFor(evidence, evidenceId)
    const current = grouped.get(refId)
    if (current) {
      current.evidence_refs = unique([...current.evidence_refs, evidenceId])
      continue
    }
    grouped.set(refId, {
      ref_id: refId,
      label: evidenceLabel(evidence, evidenceId),
      evidence_refs: [evidenceId],
    })
  }
  return [...grouped.values()]
}

function labels(values: V3SceneSituationRef[]): string[] {
  return unique(values.map((value) => value.label))
}

function retrievalText(parts: string[]): string {
  return unique(parts.map((part) => part.trim()).filter(Boolean)).join(" | ")
}

export function buildV3SceneSituationCards({
  docId,
  chapterId,
  parents = {},
  memoryContract,
}: BuildV3SceneSituationCardsParams): V3SceneSituationCardsArtifact {
  const evidenceById = new Map(memoryContract.evidence_refs.map((evidence) => [evidence.source_candidate_id, evidence]))
  const eventsBySceneId = new Map<string, V3MemoryEventContract[]>()
  for (const event of memoryContract.events) {
    if (!event.scene_id) continue
    eventsBySceneId.set(event.scene_id, [...(eventsBySceneId.get(event.scene_id) ?? []), event])
  }

  const sceneCards = memoryContract.scenes.map((scene) => {
    const events = eventsBySceneId.get(scene.scene_id) ?? []
    const time = groupedSceneRefs(evidenceById, events.flatMap((event) => event.axis_refs.time))
    const place = groupedSceneRefs(evidenceById, events.flatMap((event) => event.axis_refs.place))
    const cast = groupedSceneRefs(evidenceById, events.flatMap((event) => event.axis_refs.cast))
      .map((ref) => ({ ...ref, scene_role: "present" as const }))
    const salientObjects = groupedSceneRefs(evidenceById, events.flatMap((event) => event.axis_refs.object))
    const goals = groupedSceneRefs(evidenceById, events.flatMap((event) => event.axis_refs.goal))
    const activeGoalOrTension = labels(goals).join("; ") || undefined
    const evidenceRefs = refsForEventIds(memoryContract, scene.event_ids)

    return {
      scene_id: scene.scene_id,
      scene_order: scene.scene_order,
      text_span: scene.text_span,
      event_ids: scene.event_ids,
      situation: {
        time,
        place,
        cast,
        action_focus: scene.axis_labels.action_focus || scene.summary,
        ...(activeGoalOrTension ? { active_goal_or_tension: activeGoalOrTension } : {}),
        salient_objects: salientObjects,
      },
      summary_for_retrieval: retrievalText([
        scene.summary,
        scene.axis_labels.action_focus,
        ...labels(time),
        ...labels(place),
        ...labels(cast),
        ...labels(salientObjects),
        ...labels(goals),
      ]),
      evidence_refs: evidenceRefs,
      explicitness: evidenceRefs.length > 0 ? "explicit" as const : "mixed" as const,
      confidence: scene.confidence,
    }
  })

  return {
    run_id: `v3_scene_situation_cards__${docId}__${chapterId}`,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: V3_SCENE_SITUATION_STAGE_ID,
    method: "rule",
    parents,
    artifact_version: V3_SCENE_SITUATION_VERSION,
    extraction_profile: V3_SCENE_SITUATION_PROFILE,
    source_stage_ids: ["MEM.0"],
    card_stats: {
      input_scenes: memoryContract.scenes.length,
      input_events: memoryContract.events.length,
      scene_cards: sceneCards.length,
      scenes_with_goal_or_tension: sceneCards.filter((card) => Boolean(card.situation.active_goal_or_tension)).length,
    },
    scene_cards: sceneCards,
  }
}

function firstEvidenceLabel(evidenceById: Map<string, V3MemoryEvidenceRef>, refs: string[], fallback: string): string {
  const first = refs.map((ref) => evidenceById.get(ref)).find(Boolean)
  return evidenceLabel(first, fallback)
}

function findRefByHint(
  evidenceById: Map<string, V3MemoryEvidenceRef>,
  candidateRefs: string[],
  hint: string | undefined,
): string | undefined {
  const target = normalized(hint)
  if (!target) return undefined
  return candidateRefs.find((candidateRef) => {
    const evidence = evidenceById.get(candidateRef)
    return [
      evidence?.span,
      evidence?.label,
      evidence?.entity_cluster_label,
    ].some((value) => normalized(value) === target)
  })
}

function argumentFor(
  evidenceById: Map<string, V3MemoryEvidenceRef>,
  role: V3EventArgument["role"],
  evidenceId: string,
  roleBasis: V3EventArgument["role_basis"],
): V3EventArgument | null {
  const evidence = evidenceById.get(evidenceId)
  if (!evidence) return null
  return {
    role,
    ref_id: refIdFor(evidence, evidenceId),
    evidence_ref: evidenceId,
    label: evidenceLabel(evidence, evidenceId),
    role_basis: roleBasis,
  }
}

function addArgument(
  target: V3EventArgument[],
  evidenceById: Map<string, V3MemoryEvidenceRef>,
  role: V3EventArgument["role"],
  evidenceId: string | undefined,
  roleBasis: V3EventArgument["role_basis"],
): void {
  if (!evidenceId) return
  const argument = argumentFor(evidenceById, role, evidenceId, roleBasis)
  if (!argument) return
  const key = `${argument.role}:${argument.ref_id}:${argument.evidence_ref}`
  if (target.some((item) => `${item.role}:${item.ref_id}:${item.evidence_ref}` === key)) return
  target.push(argument)
}

export function buildV3EventFrames({
  docId,
  chapterId,
  parents = {},
  memoryContract,
}: BuildV3EventFramesParams): V3EventFramesArtifact {
  const evidenceById = new Map(memoryContract.evidence_refs.map((evidence) => [evidence.source_candidate_id, evidence]))
  const eventFrames = memoryContract.events.map((event) => {
    const trigger = event.trigger_refs.map((ref) => evidenceById.get(ref)).find(Boolean)
    const argumentsList: V3EventArgument[] = []
    const actorRef = findRefByHint(evidenceById, event.axis_refs.cast, trigger?.subject_hint)
    const targetObjectRef = findRefByHint(evidenceById, event.axis_refs.object, trigger?.object_hint ?? trigger?.target_span)

    addArgument(argumentsList, evidenceById, "actor", actorRef, "action_hint")
    for (const castRef of event.axis_refs.cast.filter((ref) => ref !== actorRef)) {
      addArgument(argumentsList, evidenceById, "mentioned_only", castRef, "event_axis")
    }

    addArgument(argumentsList, evidenceById, "target_object", targetObjectRef, "action_hint")
    for (const objectRef of event.axis_refs.object.filter((ref) => ref !== targetObjectRef)) {
      addArgument(argumentsList, evidenceById, "theme_object", objectRef, "event_axis")
    }

    for (const placeRef of event.axis_refs.place) {
      addArgument(argumentsList, evidenceById, "location", placeRef, "event_axis")
    }
    for (const timeRef of event.axis_refs.time) {
      addArgument(argumentsList, evidenceById, "time_anchor", timeRef, "event_axis")
    }

    return {
      event_id: event.event_id,
      ...(event.scene_id ? { scene_id: event.scene_id } : {}),
      event_order: event.event_order,
      event_type: event.trigger_refs.length > 0 ? "action" as const : "state_description" as const,
      predicate: firstEvidenceLabel(evidenceById, event.trigger_refs, event.summary),
      trigger_refs: event.trigger_refs,
      arguments: argumentsList,
      time_refs: event.axis_refs.time,
      goal_cue_refs: event.axis_refs.goal,
      causal_cue_refs: event.axis_refs.causality,
      evidence_refs: event.evidence_refs,
      scope: event.scope,
      confidence: event.confidence,
    }
  })

  return {
    run_id: `v3_event_argument_frames__${docId}__${chapterId}`,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: V3_EVENT_FRAME_STAGE_ID,
    method: "rule",
    parents,
    artifact_version: V3_EVENT_FRAME_VERSION,
    extraction_profile: V3_EVENT_FRAME_PROFILE,
    source_stage_ids: ["MEM.0", "MEM.1"],
    frame_stats: {
      input_events: memoryContract.events.length,
      event_frames: eventFrames.length,
      frames_with_trigger: eventFrames.filter((event) => event.trigger_refs.length > 0).length,
      arguments_total: eventFrames.reduce((total, event) => total + event.arguments.length, 0),
    },
    event_frames: eventFrames,
  }
}
