import type { BookMemoryEvidenceRef } from "@/types/book-memory"
import type { ReaderPosition, SupportSpoilerRisk } from "@/types/schema"

export type NarrativeGraphClaimType =
  | "state"
  | "event"
  | "relation"
  | "causal"
  | "place"
  | "goal"

export type NarrativeGraphScope =
  | "actual"
  | "memory"
  | "imagination"
  | "hypothetical"
  | "dialogue_claim"
  | "unreliable"
  | "metaphor"

export interface NarrativeGraphClaim {
  claimId: string
  claimType: NarrativeGraphClaimType
  text: string
  subjectRefs: string[]
  objectRefs: string[]
  evidenceRefs: BookMemoryEvidenceRef[]
  supportLevel: "explicit" | "strong_inference" | "weak_inference"
  confidence: number
  revealStart: ReaderPosition
  revealEnd?: ReaderPosition
  spoilerRisk: SupportSpoilerRisk
  scope: NarrativeGraphScope
  sourceRunId: string
  chapterId: string
  sceneId?: string
  sceneKey?: string
}

export interface NarrativeGraphRelation {
  relationId: string
  relationType: string
  fromClaimId: string
  toClaimId: string
  label: string
  confidence: number
  evidenceRefs: BookMemoryEvidenceRef[]
}

export interface NarrativeGraphSnapshot {
  docId: string
  bookRunId: string
  claims: NarrativeGraphClaim[]
  relations: NarrativeGraphRelation[]
  createdAtIso: string
}

export interface NarrativeGraphQueryResult extends NarrativeGraphSnapshot {
  totalClaims: number
  totalRelations: number
  safetyFilter: {
    readerSceneKey?: string
    allowedClaimCount: number
    removedFutureClaimCount: number
  }
}

