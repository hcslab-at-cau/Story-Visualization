import type { V3EvidencePassId } from "@/lib/pipeline/v3-evidence-types"
import type { V3EvidenceClusteringStageId } from "@/lib/pipeline/v3-evidence-clustering-types"
import type { V3EvidenceGateStageId } from "@/lib/pipeline/v3-evidence-gate-types"
import type { V3EvidenceRefinementStageId } from "@/lib/pipeline/v3-evidence-refinement-types"
import type { V3EventGroupingStageId } from "@/lib/pipeline/v3-event-types"
import type { V3MemoryContractStageId } from "@/lib/pipeline/v3-memory-contract-types"
import type { V3EventFrameStageId, V3SceneSituationStageId } from "@/lib/pipeline/v3-memory-frames-types"
import type {
  V3CausalEdgeStageId,
  V3GoalGroundingStageId,
  V3ProgressiveMemoryStageId,
  V3RetrievalIndexStageId,
} from "@/lib/pipeline/v3-narrative-memory-types"
import type { V3SceneGroupingStageId } from "@/lib/pipeline/v3-scene-types"
import type { V3SemanticIndexStageId } from "@/lib/pipeline/v3-semantic-index-types"

export type PreStageId =
  | "PRE.1"
  | "PRE.2"
  | V3EvidencePassId
  | V3EvidenceRefinementStageId
  | V3EvidenceGateStageId
  | V3EvidenceClusteringStageId
  | V3EventGroupingStageId
  | V3SceneGroupingStageId
  | V3MemoryContractStageId
  | V3SceneSituationStageId
  | V3EventFrameStageId
  | V3GoalGroundingStageId
  | V3CausalEdgeStageId
  | V3ProgressiveMemoryStageId
  | V3RetrievalIndexStageId
  | V3SemanticIndexStageId
  | "ENT.1"

interface RunWithId {
  runId: string
}

interface PreResultsLike {
  pre1?: unknown
  pre2?: unknown
  evid1a?: unknown
  evid1b?: unknown
  evid1c?: unknown
  evid1d?: unknown
  evid2?: unknown
  evid3?: unknown
  evid4?: unknown
  event1?: unknown
  scene0?: unknown
  mem0?: unknown
  mem1?: unknown
  event2?: unknown
  goal1?: unknown
  caus1?: unknown
  mem2?: unknown
  idx1?: unknown
  idx2?: unknown
  ent1?: unknown
}

export function chooseExistingRunId(runs: RunWithId[]): string {
  return runs[0]?.runId ?? ""
}

export function chooseVisiblePreStage(results: PreResultsLike): PreStageId {
  if (results.idx2) return "IDX.2"
  if (results.idx1) return "IDX.1"
  if (results.mem2) return "MEM.2"
  if (results.caus1) return "CAUS.1"
  if (results.goal1) return "GOAL.1"
  if (results.event2) return "EVENT.2"
  if (results.mem1) return "MEM.1"
  if (results.mem0) return "MEM.0"
  if (results.scene0) return "SCENE.0"
  if (results.event1) return "EVENT.1"
  if (results.evid4) return "EVID.4"
  if (results.evid3) return "EVID.3"
  if (results.evid2) return "EVID.2"
  if (results.evid1d) return "EVID.1D"
  if (results.evid1c) return "EVID.1C"
  if (results.evid1b) return "EVID.1B"
  if (results.evid1a) return "EVID.1A"
  if (results.ent1) return "ENT.1"
  return results.pre2 ? "PRE.2" : "PRE.1"
}
