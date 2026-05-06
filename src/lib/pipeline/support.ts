import type {
  GroundedSceneModel,
  ReaderSupportPackageLog,
  ReaderSupportPacket,
  SceneBoundaries,
  ScenePackets,
  SharedSupportRepresentation,
  SupportCausalBridges,
  SupportCharacterRelations,
  SupportEvidenceRef,
  SupportMemoryEdge,
  SupportMemoryEvent,
  SupportMemoryLog,
  SupportMemoryScene,
  SupportPolicySelection,
  SupportReentryReference,
  SupportSceneContext,
  SupportSnapshots,
  SupportUnit,
  SupportUnitKind,
  ValidatedSubscene,
  ValidatedSubscenes,
} from "@/types/schema"

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item)) as Record<string, unknown>[]
    : []
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function compactList(values: string[], fallback = "no explicit detail"): string {
  const items = uniqueStrings(values)
  if (items.length === 0) return fallback
  return items.slice(0, 4).join(", ")
}

function textFromGroundedItem(item: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = asString(item[key])
    if (value) return value
  }
  const nested = asRecord(item.item)
  for (const key of keys) {
    const value = asString(nested[key])
    if (value) return value
  }
  return ""
}

function evidenceFromItem(
  sceneId: string,
  sourceStage: string,
  item: Record<string, unknown>,
): SupportEvidenceRef[] {
  const pids = Array.isArray(item.evidence_pids) ? item.evidence_pids : []
  const texts = Array.isArray(item.evidence_text) ? item.evidence_text : []

  if (pids.length === 0 && texts.length === 0) {
    return [{ scene_id: sceneId, source_stage: sourceStage }]
  }

  const max = Math.max(pids.length, texts.length, 1)
  return Array.from({ length: max }, (_, index) => ({
    scene_id: sceneId,
    pid: typeof pids[index] === "number" ? pids[index] : undefined,
    text: asString(texts[index]) || undefined,
    source_stage: sourceStage,
  }))
}

function sceneIndexById(groundedLog: GroundedSceneModel): Map<string, Record<string, unknown>> {
  return new Map(
    groundedLog.validated.map((entry) => [
      entry.scene_id,
      asRecord(entry.validated_scene_index),
    ]),
  )
}

function subscenesByScene(sub3Log?: ValidatedSubscenes): Map<string, ValidatedSubscene[]> {
  return new Map(
    (sub3Log?.packets ?? []).map((packet) => [packet.scene_id, packet.validated_subscenes]),
  )
}

function namesFromSceneItems(items: unknown): string[] {
  return uniqueStrings(asRecordArray(items).map((item) => textFromGroundedItem(item, ["name", "label"])))
}

function valuesFromSceneItems(items: unknown, keys: string[]): string[] {
  return uniqueStrings(asRecordArray(items).map((item) => textFromGroundedItem(item, keys)))
}

function scenePlace(sceneIndex: Record<string, unknown>): string {
  const place = asRecord(sceneIndex.scene_place)
  return (
    asString(place.actual_place) ||
    asString(place.current_place) ||
    asString(place.name) ||
    asString(sceneIndex.current_place)
  )
}

function sceneTime(sceneIndex: Record<string, unknown>): string {
  const time = asRecord(sceneIndex.scene_time)
  return asString(time.actual_time) || asString(time.current_time) || asString(time.label)
}

function relationLabels(sceneIndex: Record<string, unknown>): string[] {
  return uniqueStrings(
    asRecordArray(sceneIndex.relations).map((relation) => {
      const label = asString(relation.relation_label) || asString(relation.label)
      const source = asString(relation.source) || asString(relation.character_a)
      const target = asString(relation.target) || asString(relation.character_b)
      if (label && source && target) return `${source} - ${target}: ${label}`
      if (label) return label
      if (source && target) return `${source} - ${target}`
      return ""
    }),
  )
}

function firstEvidence(scene: SupportMemoryScene, sourceStage = "SCENE.3"): SupportEvidenceRef[] {
  return scene.evidence.length > 0
    ? scene.evidence.slice(0, 3)
    : [{ scene_id: scene.scene_id, source_stage: sourceStage }]
}

function makeUnit(params: {
  sceneId: string
  kind: SupportUnitKind
  label: string
  title: string
  body: string
  priority: number
  evidence: SupportEvidenceRef[]
  sourceStageIds: string[]
  displayMode?: SupportUnit["display_mode"]
}): SupportUnit {
  return {
    unit_id: `${params.sceneId}:${params.kind}:${params.label.toLowerCase().replace(/[^a-z0-9]+/gi, "_")}`,
    scene_id: params.sceneId,
    kind: params.kind,
    label: params.label,
    title: params.title,
    body: params.body,
    priority: Math.max(0, Math.min(1, params.priority)),
    display_mode: params.displayMode ?? "side_card",
    evidence: params.evidence,
    source_stage_ids: params.sourceStageIds,
  }
}

export function runSupportMemoryBuild(
  packetLog: ScenePackets,
  boundaryLog: SceneBoundaries,
  groundedLog: GroundedSceneModel,
  sub3Log: ValidatedSubscenes | undefined,
  docId: string,
  chapterId: string,
  parents: Record<string, string> = {},
): SupportMemoryLog {
  const indexMap = sceneIndexById(groundedLog)
  const subsceneMap = subscenesByScene(sub3Log)
  const titleMap = boundaryLog.scene_titles

  const scenes: SupportMemoryScene[] = packetLog.packets.map((packet) => {
    const sceneIndex = indexMap.get(packet.scene_id) ?? {}
    const actions = valuesFromSceneItems(sceneIndex.main_actions, ["action", "label", "summary"])
    const goals = valuesFromSceneItems(sceneIndex.goals, ["content", "goal", "label"])
    const objects = valuesFromSceneItems(sceneIndex.objects, ["name", "label"])
    const environment = valuesFromSceneItems(sceneIndex.environment, ["label", "name", "description"])
    const onstageCast = namesFromSceneItems(sceneIndex.onstage_cast)
    const subscenes = subsceneMap.get(packet.scene_id) ?? []

    const evidence = [
      ...asRecordArray(sceneIndex.main_actions).flatMap((item) => evidenceFromItem(packet.scene_id, "SCENE.3", item)),
      ...asRecordArray(sceneIndex.goals).flatMap((item) => evidenceFromItem(packet.scene_id, "SCENE.3", item)),
    ].slice(0, 6)

    return {
      scene_id: packet.scene_id,
      scene_title: titleMap[packet.scene_id] ?? packet.scene_id,
      start_pid: packet.start_pid,
      end_pid: packet.end_pid,
      previous_scene_id: packet.previous_scene_id,
      next_scene_id: packet.next_scene_id,
      summary: asString(sceneIndex.scene_summary),
      place: scenePlace(sceneIndex) || packet.scene_current_places[0],
      mentioned_places: uniqueStrings([
        ...packet.scene_current_places,
        ...packet.scene_mentioned_places,
      ]),
      time: sceneTime(sceneIndex) || packet.scene_time_signals[0],
      active_cast: onstageCast.length > 0 ? onstageCast : packet.scene_cast_union,
      actions,
      goals,
      objects,
      environment,
      relations: relationLabels(sceneIndex),
      subscene_summaries: subscenes.map((subscene) => subscene.headline || subscene.action_summary),
      evidence,
    }
  })

  const events: SupportMemoryEvent[] = []
  for (const scene of scenes) {
    scene.actions.forEach((action, index) => {
      events.push({
        event_id: `${scene.scene_id}:action:${index + 1}`,
        scene_id: scene.scene_id,
        label: action,
        actors: scene.active_cast,
        place: scene.place,
        action,
        evidence: firstEvidence(scene),
      })
    })

    for (const subscene of subsceneMap.get(scene.scene_id) ?? []) {
      events.push({
        event_id: `${scene.scene_id}:${subscene.subscene_id}`,
        scene_id: scene.scene_id,
        subscene_id: subscene.subscene_id,
        label: subscene.headline || subscene.action_summary,
        actors: subscene.active_cast,
        place: scene.place,
        action: subscene.action_summary,
        causal_input: subscene.causal_input,
        causal_result: subscene.causal_result,
        evidence: [{ scene_id: scene.scene_id, subscene_id: subscene.subscene_id, source_stage: "SUB.3" }],
      })
    }
  }

  const edges: SupportMemoryEdge[] = []
  for (let i = 1; i < scenes.length; i++) {
    const prev = scenes[i - 1]
    const current = scenes[i]
    const sharedCast = current.active_cast.filter((name) => prev.active_cast.includes(name))

    if (prev.place && current.place && prev.place !== current.place) {
      edges.push({
        edge_id: `${prev.scene_id}->${current.scene_id}:place`,
        type: "place_shift",
        from_scene_id: prev.scene_id,
        to_scene_id: current.scene_id,
        label: `${prev.place} -> ${current.place}`,
        evidence: firstEvidence(current, "STATE.3"),
      })
    }

    const entered = current.active_cast.filter((name) => !prev.active_cast.includes(name))
    const exited = prev.active_cast.filter((name) => !current.active_cast.includes(name))
    if (entered.length > 0 || exited.length > 0) {
      edges.push({
        edge_id: `${prev.scene_id}->${current.scene_id}:cast`,
        type: "cast_change",
        from_scene_id: prev.scene_id,
        to_scene_id: current.scene_id,
        label: [
          entered.length > 0 ? `entered: ${entered.join(", ")}` : "",
          exited.length > 0 ? `exited: ${exited.join(", ")}` : "",
        ].filter(Boolean).join("; "),
        evidence: firstEvidence(current, "STATE.2"),
      })
    }

    if (sharedCast.length > 0) {
      edges.push({
        edge_id: `${prev.scene_id}->${current.scene_id}:cast-thread`,
        type: "same_character_thread",
        from_scene_id: prev.scene_id,
        to_scene_id: current.scene_id,
        label: `continued cast: ${sharedCast.slice(0, 3).join(", ")}`,
        evidence: firstEvidence(current, "ENT.3"),
      })
    }

    const prevEvent = events.findLast((event) => event.scene_id === prev.scene_id && event.causal_result)
    const currentEvent = events.find((event) => event.scene_id === current.scene_id)
    if (prevEvent?.causal_result && currentEvent) {
      edges.push({
        edge_id: `${prevEvent.event_id}->${currentEvent.event_id}:cause`,
        type: "causal_bridge",
        from_scene_id: prev.scene_id,
        to_scene_id: current.scene_id,
        from_event_id: prevEvent.event_id,
        to_event_id: currentEvent.event_id,
        label: `${prevEvent.causal_result} -> ${currentEvent.action}`,
        evidence: [...prevEvent.evidence, ...currentEvent.evidence].slice(0, 4),
      })
    }
  }

  return {
    run_id: `support_memory__${docId}__${chapterId}`,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: "SUP.0",
    method: "rule",
    parents,
    memory: { scenes, events, edges },
  }
}

export function runSharedSupportRepresentation(
  memoryLog: SupportMemoryLog,
  docId: string,
  chapterId: string,
  parents: Record<string, string> = {},
): SharedSupportRepresentation {
  const scenes: SupportSceneContext[] = memoryLog.memory.scenes.map((scene, index, allScenes) => {
    const previous = index > 0 ? allScenes[index - 1] : undefined
    const incomingEdges = memoryLog.memory.edges.filter((edge) => edge.to_scene_id === scene.scene_id)
    const castEntered = previous
      ? scene.active_cast.filter((name) => !previous.active_cast.includes(name))
      : scene.active_cast
    const castExited = previous
      ? previous.active_cast.filter((name) => !scene.active_cast.includes(name))
      : []
    const labels = incomingEdges.map((edge) => edge.label)
    const candidateUnits: SupportUnitKind[] = ["snapshot"]

    if (labels.length > 0) candidateUnits.push("boundary_delta")
    if (incomingEdges.some((edge) => edge.type === "causal_bridge")) candidateUnits.push("causal_bridge")
    if (scene.active_cast.length > 0) candidateUnits.push("character_focus", "reference_repair")
    if (scene.relations.length > 0) candidateUnits.push("relation_delta")
    if (index > 0) candidateUnits.push("reentry_recap")
    if (scene.place || scene.mentioned_places.length > 0) candidateUnits.push("spatial_continuity")
    if (scene.environment.length > 0) candidateUnits.push("visual_context")

    return {
      scene_id: scene.scene_id,
      scene_title: scene.scene_title,
      current_state: {
        summary: scene.summary,
        place: scene.place,
        time: scene.time,
        active_cast: scene.active_cast,
        goals: scene.goals,
      },
      boundary_delta: {
        place_changed: Boolean(previous?.place && scene.place && previous.place !== scene.place),
        cast_entered: castEntered,
        cast_exited: castExited,
        time_changed: Boolean(previous?.time && scene.time && previous.time !== scene.time),
        labels,
      },
      prior_threads: incomingEdges.map((edge) => ({
        kind: edge.type,
        from_scene_id: edge.from_scene_id,
        label: edge.label,
      })),
      candidate_units: uniqueStrings(candidateUnits) as SupportUnitKind[],
      evidence: firstEvidence(scene),
    }
  })

  return {
    run_id: `shared_support__${docId}__${chapterId}`,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: "SUP.1",
    method: "rule",
    parents,
    scenes,
  }
}

export function runSupportSnapshots(
  sharedLog: SharedSupportRepresentation,
  docId: string,
  chapterId: string,
  parents: Record<string, string> = {},
): SupportSnapshots {
  return {
    run_id: `support_snapshots__${docId}__${chapterId}`,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: "SUP.2",
    method: "rule",
    parents,
    scenes: sharedLog.scenes.map((scene) => {
      const units: SupportUnit[] = [
        makeUnit({
          sceneId: scene.scene_id,
          kind: "snapshot",
          label: "Now",
          title: "Current-state snapshot",
          body: [
            scene.current_state.summary,
            scene.current_state.place ? `Place: ${scene.current_state.place}.` : "",
            scene.current_state.active_cast.length > 0
              ? `Cast: ${compactList(scene.current_state.active_cast)}.`
              : "",
            scene.current_state.goals.length > 0
              ? `Goals: ${compactList(scene.current_state.goals)}.`
              : "",
          ].filter(Boolean).join(" "),
          priority: 0.92,
          evidence: scene.evidence,
          sourceStageIds: ["SCENE.3", "STATE.2"],
          displayMode: "side_card",
        }),
      ]

      if (scene.boundary_delta.labels.length > 0) {
        units.push(makeUnit({
          sceneId: scene.scene_id,
          kind: "boundary_delta",
          label: "Shift",
          title: "What changed at the boundary",
          body: [
            scene.boundary_delta.place_changed ? "The place changed." : "",
            scene.boundary_delta.time_changed ? "The time signal changed." : "",
            scene.boundary_delta.cast_entered.length > 0
              ? `Entered: ${scene.boundary_delta.cast_entered.join(", ")}.`
              : "",
            scene.boundary_delta.cast_exited.length > 0
              ? `Exited: ${scene.boundary_delta.cast_exited.join(", ")}.`
              : "",
            scene.boundary_delta.labels.slice(0, 2).join(" "),
          ].filter(Boolean).join(" "),
          priority: 0.86,
          evidence: scene.evidence,
          sourceStageIds: ["STATE.3", "SCENE.1"],
          displayMode: "inline_chip",
        }))
      }

      return { scene_id: scene.scene_id, units }
    }),
  }
}

export function runSupportCausalBridges(
  sharedLog: SharedSupportRepresentation,
  memoryLog: SupportMemoryLog,
  docId: string,
  chapterId: string,
  parents: Record<string, string> = {},
): SupportCausalBridges {
  return {
    run_id: `support_causal__${docId}__${chapterId}`,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: "SUP.3",
    method: "rule",
    parents,
    scenes: sharedLog.scenes.map((scene) => {
      const causalEdges = memoryLog.memory.edges.filter(
        (edge) => edge.to_scene_id === scene.scene_id && edge.type === "causal_bridge",
      )
      const fallbackThread = scene.prior_threads.find((thread) => thread.kind === "same_character_thread")
      const units = causalEdges.map((edge) => makeUnit({
        sceneId: scene.scene_id,
        kind: "causal_bridge",
        label: "Why",
        title: "Why this scene follows",
        body: edge.label,
        priority: 0.9,
        evidence: edge.evidence,
        sourceStageIds: ["SUB.3", "SUP.0"],
        displayMode: "side_card",
      }))

      if (units.length === 0 && fallbackThread) {
        units.push(makeUnit({
          sceneId: scene.scene_id,
          kind: "causal_bridge",
          label: "Thread",
          title: "Continuing thread",
          body: fallbackThread.label,
          priority: 0.62,
          evidence: scene.evidence,
          sourceStageIds: ["SUP.1"],
          displayMode: "popover",
        }))
      }

      return { scene_id: scene.scene_id, units }
    }),
  }
}

export function runSupportCharacterRelations(
  sharedLog: SharedSupportRepresentation,
  memoryLog: SupportMemoryLog,
  docId: string,
  chapterId: string,
  parents: Record<string, string> = {},
): SupportCharacterRelations {
  const sceneMap = new Map(memoryLog.memory.scenes.map((scene) => [scene.scene_id, scene]))
  return {
    run_id: `support_character_relations__${docId}__${chapterId}`,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: "SUP.4",
    method: "rule",
    parents,
    scenes: sharedLog.scenes.map((context) => {
      const scene = sceneMap.get(context.scene_id)
      const units: SupportUnit[] = []

      if (context.current_state.active_cast.length > 0) {
        units.push(makeUnit({
          sceneId: context.scene_id,
          kind: "character_focus",
          label: "Cast",
          title: "Who matters here",
          body: `${compactList(context.current_state.active_cast)} are active in this scene.`,
          priority: 0.78,
          evidence: context.evidence,
          sourceStageIds: ["ENT.3", "SCENE.3"],
          displayMode: "side_card",
        }))
      }

      if (scene && scene.relations.length > 0) {
        units.push(makeUnit({
          sceneId: context.scene_id,
          kind: "relation_delta",
          label: "Relation",
          title: "Relationship signal",
          body: scene.relations.slice(0, 3).join(" / "),
          priority: 0.76,
          evidence: scene.evidence,
          sourceStageIds: ["SCENE.3"],
          displayMode: "popover",
        }))
      }

      return { scene_id: context.scene_id, units }
    }),
  }
}

export function runSupportReentryReference(
  sharedLog: SharedSupportRepresentation,
  memoryLog: SupportMemoryLog,
  docId: string,
  chapterId: string,
  parents: Record<string, string> = {},
): SupportReentryReference {
  return {
    run_id: `support_reentry_reference__${docId}__${chapterId}`,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: "SUP.5",
    method: "rule",
    parents,
    scenes: sharedLog.scenes.map((context, index) => {
      const scene = memoryLog.memory.scenes.find((item) => item.scene_id === context.scene_id)
      const previousScenes = memoryLog.memory.scenes.slice(Math.max(0, index - 2), index)
      const units: SupportUnit[] = []

      if (previousScenes.length > 0) {
        units.push(makeUnit({
          sceneId: context.scene_id,
          kind: "reentry_recap",
          label: "Resume",
          title: "Quick re-entry recap",
          body: previousScenes
            .map((item) => `${item.scene_title}: ${item.summary || compactList(item.actions)}`)
            .join(" "),
          priority: 0.68,
          evidence: previousScenes.flatMap((item) => firstEvidence(item)).slice(0, 4),
          sourceStageIds: ["SUP.0"],
          displayMode: "drawer",
        }))
      }

      if (context.current_state.active_cast.length > 0) {
        units.push(makeUnit({
          sceneId: context.scene_id,
          kind: "reference_repair",
          label: "Names",
          title: "Reference repair",
          body: `When this scene uses pronouns or short references, resolve them first against: ${compactList(context.current_state.active_cast)}.`,
          priority: 0.58,
          evidence: context.evidence,
          sourceStageIds: ["ENT.3", "SCENE.3"],
          displayMode: "popover",
        }))
      }

      if (scene?.place || scene?.mentioned_places.length) {
        units.push(makeUnit({
          sceneId: context.scene_id,
          kind: "spatial_continuity",
          label: "Place",
          title: "Spatial continuity",
          body: `Current place: ${scene.place || "unknown"}. Nearby/mentioned places: ${compactList(scene.mentioned_places)}.`,
          priority: 0.64,
          evidence: scene.evidence,
          sourceStageIds: ["STATE.2", "SCENE.3"],
          displayMode: "side_card",
        }))
      }

      if (scene?.environment.length) {
        units.push(makeUnit({
          sceneId: context.scene_id,
          kind: "visual_context",
          label: "Scene cues",
          title: "Visual context cues",
          body: compactList(scene.environment),
          priority: 0.52,
          evidence: scene.evidence,
          sourceStageIds: ["SCENE.3", "VIS.1"],
          displayMode: "popover",
        }))
      }

      return { scene_id: context.scene_id, units }
    }),
  }
}

export function runSupportPolicySelection(
  snapshots: SupportSnapshots,
  causal: SupportCausalBridges,
  characterRelations: SupportCharacterRelations,
  reentryReference: SupportReentryReference,
  docId: string,
  chapterId: string,
  parents: Record<string, string> = {},
): SupportPolicySelection {
  const sceneIds = uniqueStrings([
    ...snapshots.scenes.map((scene) => scene.scene_id),
    ...causal.scenes.map((scene) => scene.scene_id),
    ...characterRelations.scenes.map((scene) => scene.scene_id),
    ...reentryReference.scenes.map((scene) => scene.scene_id),
  ])

  function unitsFor(sceneId: string): SupportUnit[] {
    return [
      ...(snapshots.scenes.find((scene) => scene.scene_id === sceneId)?.units ?? []),
      ...(causal.scenes.find((scene) => scene.scene_id === sceneId)?.units ?? []),
      ...(characterRelations.scenes.find((scene) => scene.scene_id === sceneId)?.units ?? []),
      ...(reentryReference.scenes.find((scene) => scene.scene_id === sceneId)?.units ?? []),
    ].sort((a, b) => b.priority - a.priority)
  }

  return {
    run_id: `support_policy__${docId}__${chapterId}`,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: "SUP.6",
    method: "rule",
    parents,
    scenes: sceneIds.map((sceneId) => {
      const units = unitsFor(sceneId)
      const selected = units.slice(0, 5)
      const selectedKinds = new Set(selected.map((unit) => unit.kind))
      return {
        scene_id: sceneId,
        selected_units: selected,
        deferred_units: units.slice(5),
        policy_notes: [
          `selected ${selected.length} of ${units.length} units`,
          selectedKinds.has("snapshot") ? "snapshot is available" : "snapshot missing",
          selectedKinds.has("causal_bridge") ? "causal context is available" : "causal context deferred or unavailable",
        ],
      }
    }),
  }
}

export function runReaderSupportPackage(
  policyLog: SupportPolicySelection,
  sharedLog: SharedSupportRepresentation,
  docId: string,
  chapterId: string,
  parents: Record<string, string> = {},
): ReaderSupportPackageLog {
  const titleMap = new Map(sharedLog.scenes.map((scene) => [scene.scene_id, scene.scene_title]))

  const packets: ReaderSupportPacket[] = policyLog.scenes.map((scene) => {
    const beforeText = scene.selected_units.filter((unit) => (
      unit.kind === "snapshot" ||
      unit.kind === "boundary_delta" ||
      unit.kind === "causal_bridge"
    ))
    const besideVisual = scene.selected_units.filter((unit) => (
      unit.kind === "character_focus" ||
      unit.kind === "spatial_continuity" ||
      unit.kind === "visual_context"
    ))
    const onDemand = scene.selected_units.filter((unit) => (
      !beforeText.includes(unit) && !besideVisual.includes(unit)
    ))

    return {
      scene_id: scene.scene_id,
      scene_title: titleMap.get(scene.scene_id) ?? scene.scene_id,
      primary_units: scene.selected_units.slice(0, 3),
      overflow_units: [...scene.selected_units.slice(3), ...scene.deferred_units],
      display_slots: {
        before_text: beforeText,
        beside_visual: besideVisual,
        on_demand: onDemand,
      },
    }
  })

  return {
    run_id: `reader_support_package__${docId}__${chapterId}`,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: "SUP.7",
    method: "rule",
    parents,
    packets,
  }
}
