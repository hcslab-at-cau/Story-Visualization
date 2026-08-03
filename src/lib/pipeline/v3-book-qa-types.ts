import type { V3EvidenceClusteringArtifact } from "./v3-evidence-clustering-types"
import type { V3EvidenceGateArtifact } from "./v3-evidence-gate-types"

export const V3_BOOK_QA_STAGE_ID = "BOOK.1" as const
export const V3_BOOK_QA_CORPUS_VERSION = "v3-book-qa-corpus-0.1" as const
export const V3_BOOK_QA_PINNED_STAGE_IDS = [
  "PRE.1",
  "PRE.2",
  "EVID.3",
  "EVID.4",
  "MEM.0",
  "MEM.1",
  "EVENT.2",
  "IDX.1",
  "IDX.2",
] as const

export type V3BookQAPinnedStageId = typeof V3_BOOK_QA_PINNED_STAGE_IDS[number]

export interface V3BookReaderPosition {
  chapter_id: string
  pid: number
}

export interface V3BookQAChapterRef {
  chapter_id: string
  chapter_title: string
  chapter_index: number
  run_id: string
  progress_end_pid: number
  artifact_ids: Partial<Record<V3BookQAPinnedStageId, string>>
}

export interface V3BookQAReadinessDiagnostic {
  chapter_id: string
  run_id: string
  stage_id: V3BookQAPinnedStageId
  code: string
  message: string
}

export interface V3BookQACorpusManifest {
  stage_id: typeof V3_BOOK_QA_STAGE_ID
  artifact_version: typeof V3_BOOK_QA_CORPUS_VERSION
  qa_corpus_id: string
  doc_id: string
  ordered_chapter_ids: string[]
  chapters: V3BookQAChapterRef[]
  fingerprint: string
  readiness: V3BookQAReadinessDiagnostic[]
}

export interface V3BookQAReadableChapter extends V3BookQAChapterRef {
  readable_through_pid: number
  is_current: boolean
}

export type V3BookEntityType = "cast" | "place" | "object"

export interface V3BookEntityAlias {
  value: string
  evidence_pids: number[]
  available_from_pid: number
}

export interface V3BookEntityGroupMember {
  chapter_id: string
  chapter_index: number
  run_id: string
  local_cluster_id: string
  canonical_label: string
  aliases: V3BookEntityAlias[]
  evidence_pids: number[]
  link_available_from_pid: number
}

export interface V3BookEntityGroup {
  global_entity_id: string
  entity_type: V3BookEntityType
  /** Internal only. Reader-facing code must use a progress-filtered visible label. */
  canonical_label: string
  members: V3BookEntityGroupMember[]
}

export interface V3BookVisibleEntityGroupMember {
  chapter_id: string
  chapter_index: number
  run_id: string
  local_cluster_id: string
  aliases: V3BookEntityAlias[]
  evidence_pids: number[]
  link_available_from_pid: number
}

export interface V3BookVisibleEntityGroup {
  global_entity_id: string
  entity_type: V3BookEntityType
  label: string
  members: V3BookVisibleEntityGroupMember[]
}

export type V3BookEntityGroupingDiagnosticCode =
  | "excluded_entity_type"
  | "missing_candidate_provenance"
  | "candidate_cluster_not_found"
  | "candidate_type_mismatch"
  | "unprovenanced_alias"
  | "denied_identity_key"
  | "ambiguous_identity_key"
  | "transitive_chapter_conflict"
  | "singleton_cluster"

export interface V3BookEntityGroupingDiagnostic {
  code: V3BookEntityGroupingDiagnosticCode
  message: string
  chapter_id?: string
  run_id?: string
  local_cluster_id?: string
  refined_candidate_id?: string
  entity_type?: V3BookEntityType | "time"
  identity_key?: string
  alias?: string
}

export interface V3BookEntityGroupingChapterInput {
  chapterId: string
  chapterIndex: number
  runId: string
  evidenceGate: V3EvidenceGateArtifact
  evidenceClusters: V3EvidenceClusteringArtifact
}

export interface V3BookEntityGroupingResult {
  groups: V3BookEntityGroup[]
  diagnostics: V3BookEntityGroupingDiagnostic[]
}
