import type { StageId } from "@/types/schema"

const DIRECT_DEPENDENTS: Partial<Record<StageId, StageId[]>> = {
  "PRE.1": ["PRE.2"],
  "PRE.2": ["ENT.1", "STATE.2"],
  "ENT.1": ["ENT.2"],
  "ENT.2": ["ENT.3"],
  "ENT.3": ["STATE.1", "STATE.2", "SCENE.1", "SCENE.3"],
  "STATE.1": ["STATE.2", "STATE.3", "SCENE.1"],
  "STATE.2": ["STATE.3", "SCENE.1", "SCENE.3"],
  "STATE.3": ["SCENE.1", "FINAL.1"],
  "SCENE.1": ["SCENE.2", "SCENE.3", "VIS.1", "VIS.2", "SUB.1", "SUB.2", "SUB.3", "SUB.4", "FINAL.1"],
  "SCENE.2": ["SCENE.3"],
  "SCENE.3": ["VIS.1", "VIS.2", "SUB.1", "SUB.2", "SUB.3", "SUB.4", "FINAL.1"],
  "VIS.1": ["VIS.2"],
  "VIS.2": ["VIS.3", "FINAL.1", "FINAL.2"],
  "VIS.3": ["VIS.4"],
  "VIS.4": ["FINAL.1", "FINAL.2"],
  "SUB.1": ["SUB.2", "SUB.3"],
  "SUB.2": ["SUB.3"],
  "SUB.3": ["SUB.4", "FINAL.1"],
  "SUB.4": ["FINAL.1"],
  "FINAL.1": ["FINAL.2"],
}

export function getDescendantStages(stageId: StageId): Set<StageId> {
  const descendants = new Set<StageId>()
  const queue = [...(DIRECT_DEPENDENTS[stageId] ?? [])]

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || descendants.has(current)) continue
    descendants.add(current)
    queue.push(...(DIRECT_DEPENDENTS[current] ?? []))
  }

  return descendants
}
