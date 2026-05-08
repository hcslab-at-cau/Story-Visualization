import type { ReaderSupportPacket, SupportUnit } from "@/types/schema"

export interface GovernedReaderSupport {
  beforeText: SupportUnit[]
  besideVisual: SupportUnit[]
  onDemand: SupportUnit[]
  hiddenTriggerCount: number
  suppressedCount: number
  reentryActive: boolean
}

const DEFAULT_REENTRY_GAP_MS = 10 * 60 * 1000

function isBesideVisualUnit(unit: SupportUnit): boolean {
  return (
    unit.kind === "character_focus" ||
    unit.kind === "spatial_continuity" ||
    unit.kind === "visual_context"
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

function triggerAllowed(unit: SupportUnit, options: { reentryActive: boolean }): boolean {
  if (unit.kind === "reentry_recap") return options.reentryActive
  return false
}

export function governReaderSupport(
  support: ReaderSupportPacket | undefined,
  options: {
    resumeGapMs?: number
    reentryGapMs?: number
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
    }
  }

  const reentryActive = (options.resumeGapMs ?? 0) >= (options.reentryGapMs ?? DEFAULT_REENTRY_GAP_MS)
  const plan = support.display_plan

  if (!plan) {
    const beforeText = support.display_slots.before_text.slice(0, 1)
    const overflowBeforeText = support.display_slots.before_text.slice(1)
    return {
      beforeText,
      besideVisual: support.display_slots.beside_visual,
      onDemand: uniqueUnits([...overflowBeforeText, ...support.display_slots.on_demand]),
      hiddenTriggerCount: 0,
      suppressedCount: 0,
      reentryActive,
    }
  }

  const beforeText = plan.default_visible.slice(0, 1)
  const overflowVisible = plan.default_visible.slice(1)
  const besideVisual = plan.expandable.filter(isBesideVisualUnit)
  const expandableOnDemand = plan.expandable.filter((unit) => !isBesideVisualUnit(unit))
  const triggered = plan.trigger_only.filter((unit) => triggerAllowed(unit, { reentryActive }))
  const hiddenTriggerCount = Math.max(0, plan.trigger_only.length - triggered.length)

  return {
    beforeText,
    besideVisual,
    onDemand: uniqueUnits([...overflowVisible, ...expandableOnDemand, ...triggered]),
    hiddenTriggerCount,
    suppressedCount: plan.suppressed.length,
    reentryActive,
  }
}
