export type ReadinessStatus = "ready" | "warning" | "missing" | "unknown"

export interface ReadinessCheck {
  id: string
  label: string
  status: ReadinessStatus
  detail: string
  action?: string
}

export interface RunReadinessReport {
  docId: string
  chapterId: string
  selectedRunId: string
  artifacts: {
    ent3: boolean
    sup0: boolean
    sup7: boolean
    final1: boolean
    final2: boolean
  }
  graph: {
    projected: boolean
    totalNodes: number
    totalEdges: number
  }
  bookMemory: {
    exists: boolean
    bookRunId?: string
    chapterRunId?: string
    runMatchesSelected: boolean
    missingReason?: string
  }
  narrativeGraph: {
    available: boolean
    claimCount: number
    relationCount: number
    removedFutureClaimCount: number
  }
  reader: {
    effectiveRunId: string
    final1OnEffectiveRun: boolean
    final2OnEffectiveRun: boolean
    fallbackToSelectedRun: boolean
  }
  checks: ReadinessCheck[]
  recommendations: string[]
}
