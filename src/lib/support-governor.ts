import type { ReaderSupportPacket, SupportUnit } from "@/types/schema"

export interface GovernedReaderSupport {
  beforeText: SupportUnit[]
  besideVisual: SupportUnit[]
  onDemand: SupportUnit[]
  hiddenTriggerCount: number
  suppressedCount: number
  reentryActive: boolean
  diagnostics: string[]
}

const DEFAULT_REENTRY_GAP_MS = 10 * 60 * 1000

function isBesideVisualUnit(unit: SupportUnit, options: { visualUseful: boolean }): boolean {
  if (unit.kind === "visual_context") return options.visualUseful
  return (
    unit.kind === "character_focus" ||
    unit.kind === "spatial_continuity"
  )
}

function uniqueUnits(units: SupportUnit[]): SupportUnit[] {
  const seen = new Set<string>()
  return units.filter((unit) => {
    if (seen.has(unit.unit_id)) return false
    seen.add(unit.unit_id)
    return true
  })
}

function triggerAllowed(unit: SupportUnit, options: { reentryActive: boolean; visualUseful: boolean }): boolean {
  if (unit.kind === "reentry_recap") return options.reentryActive
  if (unit.kind === "visual_context") return options.visualUseful
  return false
}

function isRecoveryUnit(unit: SupportUnit): boolean {
  return (
    unit.reader_problem === "state_recovery" ||
    unit.reader_problem === "boundary_update" ||
    unit.kind === "snapshot" ||
    unit.kind === "boundary_delta"
  )
}

function hasDisplayPlanBuckets(plan: ReaderSupportPacket["display_plan"]): boolean {
  if (!plan) return false
  return (
    (plan.default_visible?.length ?? 0) > 0 ||
    (plan.expandable?.length ?? 0) > 0 ||
    (plan.trigger_only?.length ?? 0) > 0 ||
    (plan.suppressed?.length ?? 0) > 0
  )
}

export function governReaderSupport(
  support: ReaderSupportPacket | undefined,
  options: {
    resumeGapMs?: number
    reentryGapMs?: number
    visualUseful?: boolean
    sceneBoundaryActive?: boolean
    longPauseActive?: boolean
    backscrollActive?: boolean
    supportFatigueScore?: number
  } = {},
): GovernedReaderSupport {
  if (!support) {
    return {
      beforeText: [],
      besideVisual: [],
      onDemand: [],
      hiddenTriggerCount: 0,
      suppressedCount: 0,
      reentryActive: false,
      diagnostics: ["support_missing"],
    }
  }

  const reentryActive = (options.resumeGapMs ?? 0) >= (options.reentryGapMs ?? DEFAULT_REENTRY_GAP_MS)
  const visualUseful = options.visualUseful ?? true
  const sceneBoundaryActive = options.sceneBoundaryActive ?? true
  const readerRecoverySignal = Boolean(options.longPauseActive || options.backscrollActive)
  const supportFatigueScore = Math.max(0, Math.min(1, options.supportFatigueScore ?? 0))
  const fatigueHigh = supportFatigueScore >= 0.65
  const diagnostics = [
    reentryActive ? "session_reentry" : "",
    readerRecoverySignal ? "recovery_signal" : "",
    visualUseful ? "visual_useful" : "visual_suppressed",
    fatigueHigh ? "support_fatigue_high" : "",
  ].filter(Boolean)
  const plan = hasDisplayPlanBuckets(support.display_plan) ? support.display_plan : undefined

  if (!plan) {
    const beforeText = fatigueHigh ? [] : support.display_slots.before_text.slice(0, 1)
    const overflowBeforeText = support.display_slots.before_text.slice(1)
    return {
      beforeText,
      besideVisual: support.display_slots.beside_visual,
      onDemand: uniqueUnits([...support.display_slots.before_text.filter((unit) => !beforeText.includes(unit)), ...overflowBeforeText, ...support.display_slots.on_demand]),
      hiddenTriggerCount: 0,
      suppressedCount: 0,
      reentryActive,
      diagnostics: support.display_plan ? [...diagnostics, "legacy_display_slots"] : diagnostics,
    }
  }

  const defaultVisible = plan.default_visible ?? []
  const planExpandable = plan.expandable ?? []
  const planTriggerOnly = plan.trigger_only ?? []
  const planSuppressed = plan.suppressed ?? []
  let beforeText = sceneBoundaryActive && !fatigueHigh ? defaultVisible.slice(0, 1) : []
  const overflowVisible = defaultVisible.slice(1)
  const runtimeSuppressed = visualUseful
    ? []
    : [...planExpandable, ...planTriggerOnly].filter((unit) => unit.kind === "visual_context")
  const expandable = planExpandable.filter((unit) => !runtimeSuppressed.includes(unit))
  const triggerOnly = planTriggerOnly.filter((unit) => !runtimeSuppressed.includes(unit))
  const besideVisual = expandable.filter((unit) => isBesideVisualUnit(unit, { visualUseful }))
  const expandableOnDemand = expandable.filter((unit) => !isBesideVisualUnit(unit, { visualUseful }))
  const triggered = triggerOnly.filter((unit) => triggerAllowed(unit, { reentryActive, visualUseful }))
  if (beforeText.length === 0 && readerRecoverySignal && !fatigueHigh) {
    const recoveryUnit = uniqueUnits([...expandableOnDemand, ...triggered, ...overflowVisible])
      .find(isRecoveryUnit)
    if (recoveryUnit) {
      beforeText = [recoveryUnit]
      diagnostics.push("promoted_recovery_unit")
    }
  }
  const hiddenTriggerCount = Math.max(0, planTriggerOnly.length - triggered.length)

  return {
    beforeText,
    besideVisual,
    onDemand: uniqueUnits([...overflowVisible, ...expandableOnDemand, ...triggered].filter((unit) => !beforeText.includes(unit))),
    hiddenTriggerCount,
    suppressedCount: planSuppressed.length + runtimeSuppressed.length,
    reentryActive,
    diagnostics,
  }
}
