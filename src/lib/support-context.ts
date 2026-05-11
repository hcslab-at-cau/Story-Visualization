import type {
  BookEntityOccurrence,
  BookEntityThread,
  BookMemoryEdge,
  BookMemoryEdgeType,
  BookMemoryEvidenceRef,
  BookMemorySceneRef,
  BookMemorySnapshot,
} from "@/types/book-memory"
import { queryNarrativeGraphSnapshot } from "@/lib/narrative-graph"
import { verifySupportUnits } from "@/lib/support-verifier"
import type {
  NarrativeClaim,
  ReaderProblem,
  ReaderSupportPackageLog,
  ReaderSupportPacket,
  ReaderSupportPlan,
  SupportDefaultDisplay,
  SupportEvidenceRef,
  SupportRuntimeRule,
  SupportTriggerCondition,
  SupportUnit,
  SupportUnitKind,
} from "@/types/schema"
import type {
  SupportContextKind,
  SupportContextPayload,
  SupportContextReaderPosition,
} from "@/types/support-context"

function sceneKeyFor(chapterId: string, sceneId: string): string {
  return `${chapterId}:${sceneId}`
}

function sortScenes(scenes: BookMemorySceneRef[]): BookMemorySceneRef[] {
  return [...scenes].sort((a, b) => {
    if (a.chapterIndex !== b.chapterIndex) return a.chapterIndex - b.chapterIndex
    if (a.startPid !== b.startPid) return a.startPid - b.startPid
    return a.sceneKey.localeCompare(b.sceneKey)
  })
}

function edgePriority(edge: BookMemoryEdge): number {
  switch (edge.type) {
    case "cross_chapter_causal_bridge":
      return 0
    case "cross_chapter_place_shift":
      return 1
    case "cross_chapter_same_place":
      return 2
    case "cross_chapter_character_thread":
      return 3
    case "entity_reappearance":
      return 4
    case "chapter_sequence":
    default:
      return 5
  }
}

function boundedScore(value: number): number {
  if (Number.isNaN(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 96)
}

function evidenceKey(ref: SupportEvidenceRef): string {
  return [
    ref.scene_id,
    ref.subscene_id ?? "",
    ref.pid ?? "",
    ref.source_stage,
    ref.text ?? "",
  ].join(":")
}

function unitKey(unit: SupportUnit): string {
  return unit.redundancy_key ?? unit.unit_id
}

function uniqueUnits(units: SupportUnit[]): SupportUnit[] {
  const seen = new Set<string>()
  return units.filter((unit) => {
    const key = unitKey(unit)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function uniqueRuntimeRules(rules: SupportRuntimeRule[]): SupportRuntimeRule[] {
  const seen = new Set<string>()
  return rules.filter((rule) => {
    if (seen.has(rule.rule_id)) return false
    seen.add(rule.rule_id)
    return true
  })
}

function uniqueEvidenceRefs(refs: SupportEvidenceRef[]): SupportEvidenceRef[] {
  const seen = new Set<string>()
  return refs.filter((ref) => {
    const key = evidenceKey(ref)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function supportEvidenceFromBook(ref: BookMemoryEvidenceRef): SupportEvidenceRef {
  return {
    scene_id: ref.sceneId ?? ref.chapterId,
    text: ref.text,
    source_stage: ref.sourceStageId,
  }
}

function groundingScoreForEvidence(evidence: SupportEvidenceRef[]): number {
  if (evidence.length === 0) return 0.35
  const withText = evidence.filter((ref) => Boolean(ref.text?.trim())).length
  return boundedScore(0.58 + Math.min(0.24, evidence.length * 0.04) + Math.min(0.18, withText * 0.04))
}

function edgeKind(type: BookMemoryEdgeType): SupportUnitKind {
  switch (type) {
    case "cross_chapter_causal_bridge":
      return "causal_bridge"
    case "cross_chapter_place_shift":
    case "cross_chapter_same_place":
      return "spatial_continuity"
    case "cross_chapter_character_thread":
    case "entity_reappearance":
      return "character_focus"
    case "chapter_sequence":
    default:
      return "boundary_delta"
  }
}

function edgeReaderProblem(type: BookMemoryEdgeType): ReaderProblem {
  switch (type) {
    case "cross_chapter_causal_bridge":
      return "causal_gap"
    case "cross_chapter_place_shift":
    case "cross_chapter_same_place":
      return "spatial_disorientation"
    case "cross_chapter_character_thread":
    case "entity_reappearance":
      return "character_reentry"
    case "chapter_sequence":
    default:
      return "boundary_update"
  }
}

function edgeTitle(type: BookMemoryEdgeType): string {
  switch (type) {
    case "cross_chapter_causal_bridge":
      return "Earlier cause for the current scene"
    case "cross_chapter_place_shift":
      return "Place transition from earlier reading"
    case "cross_chapter_same_place":
      return "Earlier scene in the same place"
    case "cross_chapter_character_thread":
      return "Character thread from earlier reading"
    case "entity_reappearance":
      return "Reappearing entity"
    case "chapter_sequence":
    default:
      return "Previous chapter boundary"
  }
}

function edgeLabel(type: BookMemoryEdgeType): string {
  switch (type) {
    case "cross_chapter_causal_bridge":
      return "Why"
    case "cross_chapter_place_shift":
    case "cross_chapter_same_place":
      return "Place"
    case "cross_chapter_character_thread":
    case "entity_reappearance":
      return "Thread"
    case "chapter_sequence":
    default:
      return "Earlier"
  }
}

function edgeDefaultDisplay(type: BookMemoryEdgeType): SupportDefaultDisplay {
  return type === "cross_chapter_causal_bridge" ? "expandable" : "expandable"
}

function edgeTriggerPreconditions(type: BookMemoryEdgeType): SupportTriggerCondition[] {
  if (type === "cross_chapter_causal_bridge") return ["reader_request"]
  if (type === "cross_chapter_place_shift" || type === "cross_chapter_same_place") {
    return ["reader_request", "visual_usefulness_high"]
  }
  return ["reader_request"]
}

function narrativeClaimForEdge(
  edge: BookMemoryEdge,
  evidence: SupportEvidenceRef[],
): NarrativeClaim {
  return {
    claim_id: `claim:${edge.edgeId}`,
    claim_type: edge.type === "cross_chapter_causal_bridge"
      ? "causal"
      : edge.type === "cross_chapter_place_shift" || edge.type === "cross_chapter_same_place"
        ? "place"
        : edge.type === "cross_chapter_character_thread" || edge.type === "entity_reappearance"
          ? "relation"
          : "event",
    subject_refs: [edge.fromSceneKey],
    object_refs: [edge.toSceneKey],
    text: edge.label,
    evidence_refs: evidence,
    support_level: edge.type === "cross_chapter_causal_bridge" ? "strong_inference" : "explicit",
    confidence: boundedScore(edge.weight),
    reveal_start: {
      chapter_id: edge.toChapterId,
      scene_id: edge.toSceneKey.split(":")[1],
    },
    spoiler_risk: "none",
    scope: "actual",
    source_run_id: edge.evidence[0]?.runId ?? "",
  }
}

function supportUnitFromBookEdge(edge: BookMemoryEdge, sceneId: string): SupportUnit {
  const evidence = uniqueEvidenceRefs(edge.evidence.map(supportEvidenceFromBook))
  const kind = edgeKind(edge.type)
  const confidence = boundedScore(Math.max(0.52, edge.weight))
  const groundingScore = groundingScoreForEvidence(evidence)
  const usefulnessScore = boundedScore(
    (edge.type === "cross_chapter_causal_bridge" ? 0.86 : 0.68) +
    Math.min(0.08, edge.weight * 0.08),
  )
  const intrusionCost = kind === "causal_bridge" ? 0.42 : 0.32

  const unit: SupportUnit = {
    unit_id: `${sceneId}:book_context:${safeId(edge.edgeId)}`,
    scene_id: sceneId,
    kind,
    reader_problem: edgeReaderProblem(edge.type),
    label: edgeLabel(edge.type),
    title: edgeTitle(edge.type),
    body: edge.label,
    priority: usefulnessScore,
    display_mode: kind === "causal_bridge" ? "popover" : "side_card",
    evidence,
    source_stage_ids: ["BOOK.0"],
    confidence,
    grounding_score: groundingScore,
    usefulness_score: usefulnessScore,
    intrusion_cost: intrusionCost,
    redundancy_cost: 0.08,
    spoiler_risk: "none",
    default_display: edgeDefaultDisplay(edge.type),
    trigger_preconditions: edgeTriggerPreconditions(edge.type),
    redundancy_key: `book:${edge.type}:${edge.fromSceneKey}:${edge.toSceneKey}`,
    score_notes: [
      `book_memory=${edge.type}`,
      `usefulness=${usefulnessScore.toFixed(2)}`,
      `grounding=${groundingScore.toFixed(2)}`,
      `intrusion=${intrusionCost.toFixed(2)}`,
    ],
    claims: [narrativeClaimForEdge(edge, evidence)],
  }
  return verifySupportUnits([unit])[0]?.unit ?? unit
}

function runtimeRulesForUnits(units: SupportUnit[]): SupportRuntimeRule[] {
  return units.flatMap((unit) => {
    if (unit.default_display === "visible") {
      const visibleRule: SupportRuntimeRule = {
        rule_id: `${unit.unit_id}:default-visible`,
        unit_id: unit.unit_id,
        trigger: "scene_boundary",
        action: "show",
        reason: "Visible support for immediate scene recovery.",
      }
      return [visibleRule]
    }

    return (unit.trigger_preconditions ?? ["reader_request"]).map((trigger): SupportRuntimeRule => ({
      rule_id: `${unit.unit_id}:${trigger}`,
      unit_id: unit.unit_id,
      trigger,
      action: "enable",
      reason: "Book-level memory support remains hidden until the reader requests or triggers it.",
    }))
  })
}

function mergeSupportPlan(
  plan: ReaderSupportPlan | undefined,
  packet: ReaderSupportPacket,
  additions: SupportUnit[],
): ReaderSupportPlan {
  const baseCandidateUnits = plan?.candidate_units ?? [
    ...packet.primary_units,
    ...packet.overflow_units,
  ]
  const verification = verifySupportUnits(uniqueUnits([...baseCandidateUnits, ...additions]))
  const candidateUnits = verification.filter((item) => !item.suppressed).map((item) => item.unit)
  const suppressed = [
    ...(plan?.suppressed ?? []),
    ...verification
      .filter((item) => item.suppressed && item.reason)
      .map((item) => ({
        unit_id: item.unit.unit_id,
        reason: item.reason!,
        note: item.note,
      })),
  ]
  const defaultVisible = candidateUnits.filter((unit) => unit.default_display === "visible")
  const expandable = candidateUnits.filter((unit) => unit.default_display === "expandable")
  const triggerOnly = candidateUnits.filter((unit) => unit.default_display === "trigger_only")

  return {
    scene_id: plan?.scene_id ?? packet.scene_id,
    candidate_units: candidateUnits,
    default_visible: defaultVisible,
    expandable,
    trigger_only: triggerOnly,
    suppressed,
    runtime_rules: uniqueRuntimeRules([
      ...(plan?.runtime_rules ?? runtimeRulesForUnits(baseCandidateUnits)),
      ...runtimeRulesForUnits(additions),
    ]),
  }
}

function mergePacketWithBookUnits(packet: ReaderSupportPacket, additions: SupportUnit[]): ReaderSupportPacket {
  if (additions.length === 0) return packet
  const displayPlan = mergeSupportPlan(packet.display_plan, packet, additions)
  const onDemand = uniqueUnits([
    ...packet.display_slots.on_demand,
    ...additions,
  ])
  const overflowUnits = uniqueUnits([
    ...packet.overflow_units,
    ...additions,
  ])

  return {
    ...packet,
    overflow_units: overflowUnits,
    display_slots: {
      ...packet.display_slots,
      on_demand: onDemand,
    },
    display_plan: displayPlan,
  }
}

function filterEdgesForKind(edges: BookMemoryEdge[], supportKind: SupportContextKind): BookMemoryEdge[] {
  if (supportKind === "all") return edges
  if (supportKind === "causal_bridge") {
    return edges.filter((edge) => edge.type === "cross_chapter_causal_bridge")
  }
  if (supportKind === "spatial_continuity" || supportKind === "visual_context") {
    return edges.filter((edge) => (
      edge.type === "cross_chapter_place_shift" ||
      edge.type === "cross_chapter_same_place"
    ))
  }
  if (
    supportKind === "character_focus" ||
    supportKind === "reference_repair" ||
    supportKind === "relation_delta"
  ) {
    return edges.filter((edge) => (
      edge.type === "cross_chapter_character_thread" ||
      edge.type === "entity_reappearance"
    ))
  }
  if (supportKind === "boundary_delta" || supportKind === "snapshot" || supportKind === "reentry_recap") {
    return edges.filter((edge) => edge.type !== "entity_reappearance")
  }
  return edges
}

function uniqueEvidence(edges: BookMemoryEdge[]): BookMemoryEvidenceRef[] {
  const seen = new Set<string>()
  const refs: BookMemoryEvidenceRef[] = []
  for (const ref of edges.flatMap((edge) => edge.evidence)) {
    const key = [
      ref.chapterId,
      ref.runId,
      ref.sourceStageId,
      ref.sceneId,
      ref.eventId,
      ref.entityId,
      ref.text,
    ].join(":")
    if (seen.has(key)) continue
    seen.add(key)
    refs.push(ref)
  }
  return refs
}

function occurrenceSceneKey(occurrence: BookEntityOccurrence): string | undefined {
  return occurrence.firstSceneKey
}

function safeOccurrence(
  occurrence: BookEntityOccurrence,
  allowedSceneKeys: Set<string>,
): boolean {
  const key = occurrenceSceneKey(occurrence)
  return key ? allowedSceneKeys.has(key) : false
}

function buildPlaceChain(
  orderedScenes: BookMemorySceneRef[],
  currentSceneIndex: number,
  currentScene?: BookMemorySceneRef,
): BookMemorySceneRef[] {
  if (!currentScene || currentSceneIndex < 0) return []
  const previous = orderedScenes
    .slice(0, currentSceneIndex)
    .filter((scene) => scene.place && currentScene.place && scene.place === currentScene.place)
    .slice(-2)
  const immediatePrevious = orderedScenes[currentSceneIndex - 1]
  return [...previous, immediatePrevious, currentScene]
    .filter((scene): scene is BookMemorySceneRef => Boolean(scene))
    .filter((scene, index, all) => all.findIndex((item) => item.sceneKey === scene.sceneKey) === index)
}

export function buildSupportContext(
  snapshot: BookMemorySnapshot,
  params: {
    chapterId: string
    sceneId: string
    supportKind?: SupportContextKind
    readerPosition?: SupportContextReaderPosition
  },
): SupportContextPayload {
  const supportKind = params.supportKind ?? "all"
  const readerPosition = params.readerPosition ?? {
    chapterId: params.chapterId,
    sceneId: params.sceneId,
  }
  const sceneKey = sceneKeyFor(params.chapterId, params.sceneId)
  const orderedScenes = sortScenes(snapshot.sceneRefs)
  const currentSceneIndex = orderedScenes.findIndex((scene) => scene.sceneKey === sceneKey)
  const currentScene = currentSceneIndex >= 0 ? orderedScenes[currentSceneIndex] : undefined
  const allowedScenes = currentSceneIndex >= 0
    ? orderedScenes.slice(0, currentSceneIndex + 1)
    : orderedScenes.filter((scene) => (
        scene.chapterId === readerPosition.chapterId &&
        (readerPosition.pid === undefined || scene.startPid <= readerPosition.pid)
      ))
  const allowedSceneKeys = new Set(allowedScenes.map((scene) => scene.sceneKey))

  const safeEdges = snapshot.edges.filter((edge) => (
    allowedSceneKeys.has(edge.fromSceneKey) && allowedSceneKeys.has(edge.toSceneKey)
  ))
  const filteredSafeEdges = filterEdgesForKind(safeEdges, supportKind)
    .sort((a, b) => edgePriority(a) - edgePriority(b) || b.weight - a.weight)
  const narrativeGraph = queryNarrativeGraphSnapshot(snapshot, {
    chapterId: params.chapterId,
    sceneId: params.sceneId,
    supportKind,
  })
  const incomingEdges = filteredSafeEdges.filter((edge) => edge.toSceneKey === sceneKey)
  const outgoingEdges = filteredSafeEdges.filter((edge) => (
    edge.fromSceneKey === sceneKey && allowedSceneKeys.has(edge.toSceneKey)
  ))
  const causalEdges = incomingEdges.filter((edge) => edge.type === "cross_chapter_causal_bridge")

  let removedFutureThreadOccurrenceCount = 0
  const entityThreads = snapshot.entityThreads
    .map((thread) => {
      const currentOccurrence = thread.occurrences.find((occurrence) => (
        occurrence.chapterId === params.chapterId &&
        occurrenceSceneKey(occurrence) === sceneKey
      )) ?? thread.occurrences.find((occurrence) => occurrence.chapterId === params.chapterId)
      if (!currentOccurrence) return null
      const priorOccurrences = thread.occurrences.filter((occurrence) => safeOccurrence(occurrence, allowedSceneKeys))
      removedFutureThreadOccurrenceCount += Math.max(0, thread.occurrences.length - priorOccurrences.length)
      return {
        thread,
        currentOccurrence,
        priorOccurrences,
      }
    })
    .filter((item): item is {
      thread: BookEntityThread
      currentOccurrence: BookEntityOccurrence
      priorOccurrences: BookEntityOccurrence[]
    } => Boolean(item))
    .filter((item) => item.priorOccurrences.length > 0)

  const nearbyScenes = currentSceneIndex >= 0
    ? orderedScenes.slice(Math.max(0, currentSceneIndex - 2), currentSceneIndex + 1)
    : allowedScenes.slice(-3)

  return {
    docId: snapshot.docId,
    bookRunId: snapshot.bookRunId,
    supportKind,
    sceneKey,
    readerPosition,
    currentScene,
    currentChapterRunId: snapshot.chapterRunIds[params.chapterId],
    incomingEdges,
    outgoingEdges,
    causalEdges,
    placeChain: buildPlaceChain(orderedScenes, currentSceneIndex, currentScene),
    entityThreads,
    narrativeClaims: narrativeGraph.claims,
    nearbyScenes,
    evidenceRefs: uniqueEvidence([...incomingEdges, ...outgoingEdges]),
    safetyFilterResult: {
      currentSceneFound: Boolean(currentScene),
      allowedSceneCount: allowedSceneKeys.size,
      removedFutureEdgeCount: snapshot.edges.length - safeEdges.length,
      removedFutureThreadOccurrenceCount,
    },
    sourceSnapshot: {
      bookRunId: snapshot.bookRunId,
      createdAtIso: snapshot.createdAtIso,
      chapterRunIds: snapshot.chapterRunIds,
    },
  }
}

export function enrichReaderSupportPackageWithBookContext(
  packageLog: ReaderSupportPackageLog,
  snapshot: BookMemorySnapshot | null | undefined,
): ReaderSupportPackageLog {
  if (!snapshot) return packageLog

  const packets = packageLog.packets.map((packet) => {
    const context = buildSupportContext(snapshot, {
      chapterId: packageLog.chapter_id,
      sceneId: packet.scene_id,
      supportKind: "all",
    })
    const additions = uniqueUnits(
      context.incomingEdges
        .filter((edge) => edge.type !== "chapter_sequence")
        .slice(0, 4)
        .map((edge) => supportUnitFromBookEdge(edge, packet.scene_id)),
    )

    return mergePacketWithBookUnits(packet, additions)
  })

  return {
    ...packageLog,
    parents: {
      ...packageLog.parents,
      "BOOK.0": snapshot.bookRunId,
    },
    packets,
  }
}
