import type { ArtifactBase } from "@/types/schema"
import type { V3EvidenceCandidateType } from "@/lib/pipeline/v3-evidence-types"

export const V3_EVIDENCE_CLUSTERING_STAGE_ID = "EVID.4" as const
export const V3_EVIDENCE_CLUSTERING_PROFILE = "v3_evidence_entity_clustering" as const

export type V3EvidenceClusteringStageId = typeof V3_EVIDENCE_CLUSTERING_STAGE_ID
export type V3ClusteredEntityType = Extract<V3EvidenceCandidateType, "cast" | "place" | "time" | "object">

export interface V3EvidenceEntityCluster {
  cluster_id: string
  entity_type: V3ClusteredEntityType
  canonical_label: string
  aliases: string[]
  refined_candidate_ids: string[]
  source_candidate_ids: string[]
  evidence_pids: number[]
  mention_count: number
}

export interface V3EvidenceClusteringArtifact extends ArtifactBase {
  stage_id: V3EvidenceClusteringStageId
  method: "rule"
  extraction_profile: typeof V3_EVIDENCE_CLUSTERING_PROFILE
  source_stage_ids: ["EVID.3"]
  cluster_stats: {
    input_refined_candidates: number
    entity_like_candidates: number
    entity_clusters: number
    singleton_clusters: number
    unclustered_candidates: number
    by_type: Partial<Record<V3ClusteredEntityType, number>>
  }
  entity_clusters: V3EvidenceEntityCluster[]
  candidate_cluster_map: Record<string, string>
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function isV3EvidenceClusteringArtifact(value: unknown): value is V3EvidenceClusteringArtifact {
  if (!isObjectRecord(value)) return false
  if (value.stage_id !== V3_EVIDENCE_CLUSTERING_STAGE_ID) return false
  if (value.extraction_profile !== V3_EVIDENCE_CLUSTERING_PROFILE) return false
  if (!Array.isArray(value.entity_clusters)) return false
  if (!isObjectRecord(value.cluster_stats)) return false
  if (!isObjectRecord(value.candidate_cluster_map)) return false
  return true
}
