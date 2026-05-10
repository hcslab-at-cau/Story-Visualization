import type { StageId } from "@/types/schema"

export interface PipelineStageEdge {
  from: StageId
  to: StageId
}

export const PIPELINE_STAGE_EDGES: PipelineStageEdge[] = [
  { from: "PRE.1", to: "PRE.2" },
  { from: "PRE.2", to: "ENT.1" },
  { from: "ENT.1", to: "ENT.2" },
  { from: "ENT.2", to: "ENT.3" },
  { from: "ENT.3", to: "STATE.1" },
  { from: "STATE.1", to: "STATE.2" },
  { from: "STATE.2", to: "STATE.3" },
  { from: "STATE.3", to: "SCENE.1" },
  { from: "SCENE.1", to: "SCENE.2" },
  { from: "SCENE.2", to: "SCENE.3" },
  { from: "SCENE.3", to: "SUB.1" },
  { from: "SUB.1", to: "SUB.2" },
  { from: "SUB.2", to: "SUB.3" },
  { from: "SUB.3", to: "SUB.4" },
  { from: "SCENE.3", to: "VIS.1" },
  { from: "VIS.1", to: "VIS.2" },
  { from: "VIS.2", to: "VIS.3" },
  { from: "VIS.3", to: "VIS.4" },
  { from: "SCENE.3", to: "SUP.0" },
  { from: "SUB.3", to: "SUP.0" },
  { from: "SUP.0", to: "SUP.1" },
  { from: "SUP.1", to: "SUP.2" },
  { from: "SUP.1", to: "SUP.3" },
  { from: "SUP.1", to: "SUP.4" },
  { from: "SUP.1", to: "SUP.5" },
  { from: "SUP.2", to: "SUP.6" },
  { from: "SUP.3", to: "SUP.6" },
  { from: "SUP.4", to: "SUP.6" },
  { from: "SUP.5", to: "SUP.6" },
  { from: "SUP.6", to: "SUP.7" },
  { from: "SUP.7", to: "FINAL.1" },
  { from: "VIS.2", to: "FINAL.1" },
  { from: "VIS.4", to: "FINAL.1" },
  { from: "SUB.4", to: "FINAL.1" },
  { from: "FINAL.1", to: "FINAL.2" },
]

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
  "SCENE.3": ["VIS.1", "VIS.2", "SUB.1", "SUB.2", "SUB.3", "SUB.4", "SUP.0", "FINAL.1"],
  "VIS.1": ["VIS.2"],
  "VIS.2": ["VIS.3", "FINAL.1", "FINAL.2"],
  "VIS.3": ["VIS.4"],
  "VIS.4": ["FINAL.1", "FINAL.2"],
  "SUB.1": ["SUB.2", "SUB.3"],
  "SUB.2": ["SUB.3"],
  "SUB.3": ["SUB.4", "SUP.0", "FINAL.1"],
  "SUB.4": ["FINAL.1"],
  "SUP.0": ["SUP.1"],
  "SUP.1": ["SUP.2", "SUP.3", "SUP.4", "SUP.5"],
  "SUP.2": ["SUP.6"],
  "SUP.3": ["SUP.6"],
  "SUP.4": ["SUP.6"],
  "SUP.5": ["SUP.6"],
  "SUP.6": ["SUP.7"],
  "SUP.7": ["FINAL.1"],
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
