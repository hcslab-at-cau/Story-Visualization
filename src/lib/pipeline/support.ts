import type {
  GroundedSceneModel,
  ReaderProblem,
  ReaderSupportPackageLog,
  ReaderSupportPlan,
  ReaderSupportPacket,
  SceneBoundaries,
  ScenePackets,
  SharedSupportRepresentation,
  SupportCausalBridges,
  SupportCharacterRelations,
  SupportDefaultDisplay,
  SupportEvidenceRef,
  SupportMemoryEdge,
  SupportMemoryEvent,
  SupportMemoryLog,
  SupportMemoryScene,
  SupportPolicySelection,
  SupportReentryReference,
  SupportSceneContext,
  SupportSpoilerRisk,
  SupportSnapshots,
  SupportSuppressionReason,
  SupportTriggerCondition,
  SupportUnit,
  SupportUnitKind,
  ValidatedSubscene,
  ValidatedSubscenes,
} from "@/types/schema"
import { verifySupportUnits } from "@/lib/support-verifier"

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

function evidenceTexts(evidence: SupportEvidenceRef[]): string[] {
  return evidence.map((ref) => asString(ref.text)).filter(Boolean)
}

function firstEvidenceText(evidence: SupportEvidenceRef[]): string | undefined {
  return evidenceTexts(evidence)[0]
}

function includesText(source: string, target: string): boolean {
  return source.toLowerCase().includes(target.toLowerCase())
}

function firstMentionedCandidate(evidence: SupportEvidenceRef[], candidates: string[]): string | undefined {
  const items = uniqueStrings(candidates).filter((candidate) => candidate.length >= 2)
  const texts = evidenceTexts(evidence)
  return items.find((candidate) => texts.some((text) => includesText(text, candidate)))
}

function anchorGranularityForText(text: string | undefined): SupportUnit["anchor_hint"] {
  const preferredText = text?.trim()
  if (!preferredText) return undefined
  return {
    preferred_text: preferredText,
    granularity: preferredText.length <= 36 && !/\s/.test(preferredText) ? "word" : "phrase",
    reason: "Generated from the support unit's most local reader-facing cue.",
  }
}

function supportPoints(points: Array<{ label: string; text?: string }>): NonNullable<SupportUnit["reader_copy"]>["points"] {
  return points
    .filter((point): point is { label: string; text: string } => Boolean(point.text?.trim()))
    .map((point) => ({ label: point.label, text: point.text.trim() }))
}

function firstPronounInEvidence(evidence: SupportEvidenceRef[]): string | undefined {
  for (const text of evidenceTexts(evidence)) {
    const match = text.match(/\b(she|her|hers|he|him|his|they|them|their|it|its)\b/i)
    if (match?.[1]) return match[1]
  }
  return undefined
}

function usefulCue(cue: string): boolean {
  const normalized = cue.trim().toLowerCase()
  return normalized.length >= 4 && normalized !== "no explicit detail" && normalized !== "unknown"
}

function readerProblemForKind(kind: SupportUnitKind): ReaderProblem {
  switch (kind) {
    case "boundary_delta":
      return "boundary_update"
    case "causal_bridge":
      return "causal_gap"
    case "character_focus":
      return "character_reentry"
    case "relation_delta":
      return "relation_delta"
    case "reentry_recap":
      return "session_reentry"
    case "reference_repair":
      return "reference_ambiguity"
    case "spatial_continuity":
    case "visual_context":
      return "spatial_disorientation"
    case "snapshot":
    default:
      return "state_recovery"
  }
}

function defaultDisplayForKind(kind: SupportUnitKind): SupportDefaultDisplay {
  switch (kind) {
    case "snapshot":
    case "boundary_delta":
      return "visible"
    case "reentry_recap":
    case "reference_repair":
    case "visual_context":
      return "trigger_only"
    case "causal_bridge":
    case "character_focus":
    case "relation_delta":
    case "spatial_continuity":
    default:
      return "expandable"
  }
}

function triggerConditionsForKind(kind: SupportUnitKind): SupportTriggerCondition[] {
  switch (kind) {
    case "boundary_delta":
      return ["scene_boundary"]
    case "causal_bridge":
      return ["reader_request"]
    case "character_focus":
    case "relation_delta":
      return ["character_selection", "reader_request"]
    case "reentry_recap":
      return ["session_reentry"]
    case "reference_repair":
      return ["reference_tap"]
    case "visual_context":
      return ["visual_usefulness_high"]
    case "spatial_continuity":
      return ["reader_request"]
    case "snapshot":
    default:
      return ["large_boundary_shift", "session_reentry", "reader_request"]
  }
}

function spoilerRiskForKind(kind: SupportUnitKind): SupportSpoilerRisk {
  switch (kind) {
    case "causal_bridge":
    case "relation_delta":
    case "reentry_recap":
      return "low"
    default:
      return "none"
  }
}

function intrusionCostForKind(kind: SupportUnitKind): number {
  switch (kind) {
    case "boundary_delta":
      return 0.15
    case "reference_repair":
      return 0.2
    case "causal_bridge":
    case "spatial_continuity":
      return 0.35
    case "snapshot":
    case "character_focus":
    case "relation_delta":
      return 0.45
    case "visual_context":
    case "reentry_recap":
    default:
      return 0.55
  }
}

function groundingScoreForEvidence(evidence: SupportEvidenceRef[]): number {
  if (evidence.some((ref) => typeof ref.pid === "number" || Boolean(ref.text))) return 0.9
  if (evidence.length > 0) return 0.72
  return 0.45
}

function boundedScore(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
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
  confidence?: number
  usefulnessScore?: number
  intrusionCost?: number
  redundancyCost?: number
  defaultDisplay?: SupportDefaultDisplay
  triggerPreconditions?: SupportTriggerCondition[]
  scoreNotes?: string[]
  readerCopy?: SupportUnit["reader_copy"]
  anchorHint?: SupportUnit["anchor_hint"]
}): SupportUnit {
  const priority = boundedScore(params.priority)
  const groundingScore = groundingScoreForEvidence(params.evidence)
  const confidence = boundedScore(params.confidence ?? Math.max(0.55, Math.min(0.96, priority * 0.92 + groundingScore * 0.08)))
  const usefulnessScore = boundedScore(params.usefulnessScore ?? priority)
  const intrusionCost = boundedScore(params.intrusionCost ?? intrusionCostForKind(params.kind))
  const redundancyCost = boundedScore(params.redundancyCost ?? 0)

  return {
    unit_id: `${params.sceneId}:${params.kind}:${params.label.toLowerCase().replace(/[^a-z0-9]+/gi, "_")}`,
    scene_id: params.sceneId,
    kind: params.kind,
    reader_problem: readerProblemForKind(params.kind),
    label: params.label,
    title: params.title,
    body: params.body,
    priority,
    display_mode: params.displayMode ?? "side_card",
    evidence: params.evidence,
    source_stage_ids: params.sourceStageIds,
    confidence,
    grounding_score: groundingScore,
    usefulness_score: usefulnessScore,
    intrusion_cost: intrusionCost,
    redundancy_cost: redundancyCost,
    spoiler_risk: spoilerRiskForKind(params.kind),
    default_display: params.defaultDisplay ?? defaultDisplayForKind(params.kind),
    trigger_preconditions: params.triggerPreconditions ?? triggerConditionsForKind(params.kind),
    redundancy_key: `${params.sceneId}:${params.kind}:${readerProblemForKind(params.kind)}`,
    score_notes: params.scoreNotes ?? [
      `usefulness=${usefulnessScore.toFixed(2)}`,
      `grounding=${groundingScore.toFixed(2)}`,
      `intrusion=${intrusionCost.toFixed(2)}`,
    ],
    ...(params.readerCopy ? { reader_copy: params.readerCopy } : {}),
    ...(params.anchorHint ? { anchor_hint: params.anchorHint } : {}),
  }
}

function supportFinalScore(unit: SupportUnit): number {
  const usefulness = unit.usefulness_score ?? unit.priority
  const grounding = unit.grounding_score ?? groundingScoreForEvidence(unit.evidence)
  const confidence = unit.confidence ?? unit.priority
  const intrusion = unit.intrusion_cost ?? intrusionCostForKind(unit.kind)
  const redundancy = unit.redundancy_cost ?? 0
  const spoilerPenalty = unit.spoiler_risk === "high"
    ? 1
    : unit.spoiler_risk === "medium"
      ? 0.55
      : unit.spoiler_risk === "low"
        ? 0.15
        : 0
  return usefulness * grounding * confidence - intrusion * 0.35 - redundancy * 0.25 - spoilerPenalty
}

function suppressionReasonFor(unit: SupportUnit): SupportSuppressionReason | undefined {
  if (unit.spoiler_risk === "high") return "spoiler_risk"
  if ((unit.confidence ?? 1) < 0.45 || (unit.grounding_score ?? 1) < 0.45) return "low_confidence"
  if ((unit.usefulness_score ?? unit.priority) < 0.35) return "low_value"
  if ((unit.intrusion_cost ?? 0) > 0.8) return "too_intrusive"
  return undefined
}

function buildReaderSupportPlan(
  sceneId: string,
  candidateUnits: SupportUnit[],
  suppressedUnits: Array<{ unit: SupportUnit; reason: SupportSuppressionReason; note?: string }>,
): ReaderSupportPlan {
  const verification = verifySupportUnits(candidateUnits)
  const verifiedUnits = verification.filter((item) => !item.suppressed).map((item) => item.unit)
  const verifierSuppressed = verification
    .filter((item) => item.suppressed && item.reason)
    .map((item) => ({ unit: item.unit, reason: item.reason!, note: item.note }))
  const defaultVisible = verifiedUnits.filter((unit) => unit.default_display === "visible")
  const expandable = verifiedUnits.filter((unit) => unit.default_display === "expandable")
  const triggerOnly = verifiedUnits.filter((unit) => unit.default_display === "trigger_only")

  return {
    scene_id: sceneId,
    candidate_units: verifiedUnits,
    default_visible: defaultVisible,
    expandable,
    trigger_only: triggerOnly,
    suppressed: [...suppressedUnits, ...verifierSuppressed].map((item) => ({
      unit_id: item.unit.unit_id,
      reason: item.reason,
      note: item.note,
    })),
    runtime_rules: [
      ...defaultVisible.map((unit) => ({
        rule_id: `${unit.unit_id}:default-visible`,
        unit_id: unit.unit_id,
        trigger: "scene_boundary" as const,
        action: "show" as const,
        reason: "Default visible support for immediate scene recovery.",
      })),
      ...expandable.map((unit) => ({
        rule_id: `${unit.unit_id}:expandable`,
        unit_id: unit.unit_id,
        trigger: "reader_request" as const,
        action: "enable" as const,
        reason: "Available on demand to reduce reading interruption.",
      })),
      ...triggerOnly.flatMap((unit) => (unit.trigger_preconditions ?? []).map((trigger) => ({
        rule_id: `${unit.unit_id}:${trigger}`,
        unit_id: unit.unit_id,
        trigger,
        action: "enable" as const,
        reason: "Trigger-only support is hidden until the reader state warrants it.",
      }))),
    ],
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
      const place = scene.current_state.place
      const cast = compactList(scene.current_state.active_cast, "")
      const goals = compactList(scene.current_state.goals, "")
      const evidenceLabel = firstEvidenceText(scene.evidence)
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
          readerCopy: {
            title: "지금 장면만 짧게 잡기",
            lead: [
              place ? `지금은 ${place}에서 장면이 이어집니다.` : "",
              cast ? `${cast}을 중심으로 보면 됩니다.` : "",
              goals ? `관심은 ${goals} 쪽에 있습니다.` : "",
            ].filter(Boolean).join(" "),
            points: supportPoints([
              { label: "어디", text: place ? `${place}에서 이어집니다.` : undefined },
              { label: "누가", text: cast || undefined },
              { label: "무엇을 보나", text: goals || undefined },
            ]),
            evidence_label: evidenceLabel,
          },
          anchorHint: {
            granularity: "paragraph",
            reason: "A snapshot summarizes the local scene state rather than one word.",
          },
        }),
      ]

      if (scene.boundary_delta.labels.length > 0) {
        const boundaryTarget =
          scene.boundary_delta.cast_entered[0] ||
          scene.boundary_delta.cast_exited[0] ||
          scene.current_state.place ||
          scene.boundary_delta.labels[0]
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
          readerCopy: {
            title: "방금 달라진 점",
            lead: [
              scene.boundary_delta.cast_entered.length > 0
                ? `${scene.boundary_delta.cast_entered.join(", ")}이 새로 들어옵니다.`
                : "",
              scene.boundary_delta.cast_exited.length > 0
                ? `${scene.boundary_delta.cast_exited.join(", ")}이 장면에서 빠집니다.`
                : "",
              scene.boundary_delta.place_changed && place ? `장소 흐름은 ${place} 쪽으로 바뀝니다.` : "",
              scene.boundary_delta.time_changed ? "시간 신호도 함께 바뀝니다." : "",
            ].filter(Boolean).join(" "),
            points: supportPoints([
              { label: "새로 들어온 인물", text: compactList(scene.boundary_delta.cast_entered, "") || undefined },
              { label: "빠진 인물", text: compactList(scene.boundary_delta.cast_exited, "") || undefined },
              { label: "장소 흐름", text: scene.boundary_delta.place_changed ? place : undefined },
              { label: "근거", text: scene.boundary_delta.labels.slice(0, 2).join(" ") || undefined },
            ]),
            evidence_label: evidenceLabel,
          },
          anchorHint: anchorGranularityForText(boundaryTarget),
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
      const units = causalEdges.map((edge) => {
        const bridgeParts = edge.label.split(/\s*(?:->|→|=>)\s*/).filter(Boolean)
        const currentCue = bridgeParts[bridgeParts.length - 1]
        return makeUnit({
          sceneId: scene.scene_id,
          kind: "causal_bridge",
          label: "Why",
          title: "Why this scene follows",
          body: edge.label,
          priority: 0.9,
          evidence: edge.evidence,
          sourceStageIds: ["SUB.3", "SUP.0"],
          displayMode: "side_card",
          anchorHint: anchorGranularityForText(currentCue),
        })
      })

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
          anchorHint: anchorGranularityForText(firstMentionedCandidate(scene.evidence, scene.current_state.active_cast)),
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
        const cast = compactList(context.current_state.active_cast)
        const goals = compactList(context.current_state.goals, "")
        const characterAnchor = firstMentionedCandidate(context.evidence, context.current_state.active_cast)
          || context.current_state.active_cast[0]
        units.push(makeUnit({
          sceneId: context.scene_id,
          kind: "character_focus",
          label: "Cast",
          title: "Who matters here",
          body: `${cast} are active in this scene.`,
          priority: 0.78,
          evidence: context.evidence,
          sourceStageIds: ["ENT.3", "SCENE.3"],
          displayMode: "side_card",
          readerCopy: {
            title: "누가 중심인가요?",
            lead: `${cast}을 중심으로 행동을 따라가면 됩니다.`,
            points: supportPoints([
              { label: "중심 인물", text: cast },
              { label: "신경 쓰는 것", text: goals || undefined },
              { label: "본문에서 보이는 단서", text: firstEvidenceText(context.evidence) },
            ]),
            evidence_label: firstEvidenceText(context.evidence),
          },
          anchorHint: anchorGranularityForText(characterAnchor),
        }))
      }

      if (scene && scene.relations.length > 0) {
        const relationText = scene.relations.slice(0, 3).join(" / ")
        const relationAnchor = firstMentionedCandidate(scene.evidence, scene.active_cast) || scene.active_cast[0]
        units.push(makeUnit({
          sceneId: context.scene_id,
          kind: "relation_delta",
          label: "Relation",
          title: "Relationship signal",
          body: relationText,
          priority: 0.76,
          evidence: scene.evidence,
          sourceStageIds: ["SCENE.3"],
          displayMode: "popover",
          readerCopy: {
            title: "관계에서 볼 점",
            lead: "이 부분은 인물들이 서로 어떻게 반응하는지 보면 흐름이 잡힙니다.",
            points: supportPoints([
              { label: "관계 신호", text: relationText },
              { label: "관련 인물", text: compactList(scene.active_cast, "") || undefined },
              { label: "본문 근거", text: firstEvidenceText(scene.evidence) },
            ]),
            evidence_label: firstEvidenceText(scene.evidence),
          },
          anchorHint: anchorGranularityForText(relationAnchor),
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
        const recapText = previousScenes
          .map((item) => `${item.scene_title}: ${item.summary || compactList(item.actions)}`)
          .join(" ")
        units.push(makeUnit({
          sceneId: context.scene_id,
          kind: "reentry_recap",
          label: "Resume",
          title: "Quick re-entry recap",
          body: recapText,
          priority: 0.68,
          evidence: previousScenes.flatMap((item) => firstEvidence(item)).slice(0, 4),
          sourceStageIds: ["SUP.0"],
          displayMode: "drawer",
          readerCopy: {
            title: "다시 이어 읽기",
            lead: "잠시 쉬었다가 돌아왔다면, 직전 흐름만 짧게 떠올리면 됩니다.",
            points: supportPoints([
              { label: "직전 흐름", text: recapText },
              { label: "지금 장면", text: context.scene_title },
            ]),
            evidence_label: firstEvidenceText(previousScenes.flatMap((item) => firstEvidence(item))),
          },
          anchorHint: {
            granularity: "paragraph",
            reason: "A re-entry recap belongs to the paragraph where reading resumes.",
          },
        }))
      }

      const pronounAnchor = firstPronounInEvidence(context.evidence)
      if (context.current_state.active_cast.length > 0 && pronounAnchor) {
        const cast = compactList(context.current_state.active_cast)
        units.push(makeUnit({
          sceneId: context.scene_id,
          kind: "reference_repair",
          label: "Names",
          title: "Reference repair",
          body: `Expression: ${pronounAnchor}. Candidates: ${cast}.`,
          priority: 0.58,
          evidence: context.evidence,
          sourceStageIds: ["ENT.3", "SCENE.3"],
          displayMode: "popover",
          readerCopy: {
            title: "누구를 가리키나요?",
            lead: `여기서는 ${pronounAnchor}이 누구를 가리키는지 바로 앞뒤 인물을 기준으로 확인하면 됩니다.`,
            points: supportPoints([
              { label: "본문 표현", text: pronounAnchor },
              { label: "후보", text: cast },
              { label: "본문 근거", text: firstEvidenceText(context.evidence) },
            ]),
            evidence_label: firstEvidenceText(context.evidence),
          },
          anchorHint: {
            preferred_text: pronounAnchor,
            granularity: "word",
            reason: "Reference repair should attach to the pronoun or short expression itself.",
          },
        }))
      }

      if (scene?.place || scene?.mentioned_places.length) {
        const placeAnchor = firstMentionedCandidate(scene.evidence, [
          scene.place || "",
          ...scene.mentioned_places,
        ]) || scene.place || scene.mentioned_places[0]
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
          readerCopy: {
            title: "어디로 이어지나요?",
            lead: scene.place
              ? `${scene.place}을 기준으로 인물의 이동과 위치를 따라가면 됩니다.`
              : "함께 언급된 장소들을 기준으로 위치 흐름을 잡으면 됩니다.",
            points: supportPoints([
              { label: "지금 위치", text: scene.place },
              { label: "함께 언급된 곳", text: compactList(scene.mentioned_places, "") || undefined },
              { label: "본문 근거", text: firstEvidenceText(scene.evidence) },
            ]),
            evidence_label: firstEvidenceText(scene.evidence),
          },
          anchorHint: anchorGranularityForText(placeAnchor),
        }))
      }

      if (scene?.environment.length) {
        const visualCues = scene.environment.filter(usefulCue)
        const visualAnchor = firstMentionedCandidate(scene.evidence, visualCues) || visualCues[0]
        if (visualAnchor) {
          units.push(makeUnit({
            sceneId: context.scene_id,
            kind: "visual_context",
            label: "Scene cues",
            title: "Visual context cues",
            body: compactList(visualCues),
            priority: 0.52,
            evidence: scene.evidence,
            sourceStageIds: ["SCENE.3", "VIS.1"],
            displayMode: "popover",
            readerCopy: {
              title: "장면을 떠올려 보면",
              lead: `${visualAnchor} 같은 단서를 떠올리면 이 부분의 장면이 더 선명해집니다.`,
              points: supportPoints([
                { label: "장면 단서", text: compactList(visualCues) },
                { label: "본문 근거", text: firstEvidenceText(scene.evidence) },
              ]),
              evidence_label: firstEvidenceText(scene.evidence),
            },
            anchorHint: anchorGranularityForText(visualAnchor),
          }))
        }
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
    ].sort((a, b) => supportFinalScore(b) - supportFinalScore(a))
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
      const suppressed = units
        .map((unit) => {
          const reason = suppressionReasonFor(unit)
          return reason ? { unit, reason, note: `final_score=${supportFinalScore(unit).toFixed(2)}` } : null
        })
        .filter((item): item is { unit: SupportUnit; reason: SupportSuppressionReason; note: string } => Boolean(item))
      const eligible = units.filter((unit) => !suppressed.some((item) => item.unit.unit_id === unit.unit_id))
      const selected = eligible.slice(0, 5)
      const selectedKinds = new Set(selected.map((unit) => unit.kind))
      return {
        scene_id: sceneId,
        selected_units: selected,
        deferred_units: eligible.slice(5),
        suppressed_units: suppressed,
        policy_notes: [
          `selected ${selected.length} of ${units.length} units`,
          `suppressed ${suppressed.length} units`,
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
    const supportPlan = buildReaderSupportPlan(
      scene.scene_id,
      [...scene.selected_units, ...scene.deferred_units],
      scene.suppressed_units ?? [],
    )
    const visibleUnits = supportPlan.default_visible.slice(0, 1)
    const beforeText = visibleUnits.length > 0
      ? visibleUnits
      : scene.selected_units.filter((unit) => (
          unit.kind === "snapshot" ||
          unit.kind === "boundary_delta"
        )).slice(0, 1)
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
      display_plan: supportPlan,
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
