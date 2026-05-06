import type { SupportEdgeType } from "@/types/schema"

export type KnowledgeGraphNodeKind =
  | "scene"
  | "event"
  | "character"
  | "place"
  | "entity"
  | "mention"

export type KnowledgeGraphEdgeType =
  | SupportEdgeType
  | "scene_sequence"
  | "contains_event"
  | "active_cast"
  | "actor"
  | "located_at"
  | "has_mention"

export interface KnowledgeGraphNode {
  nodeId: string
  localId: string
  kind: KnowledgeGraphNodeKind
  label: string
  docId: string
  chapterId: string
  runId: string
  sourceStageId: string
  sourceArtifactId: string
  sceneId?: string
  eventId?: string
  entityId?: string
  tags: string[]
  searchText: string
  metadata: Record<string, unknown>
}

export interface KnowledgeGraphEdge {
  edgeId: string
  localId: string
  type: KnowledgeGraphEdgeType
  fromNodeId: string
  toNodeId: string
  label: string
  docId: string
  chapterId: string
  runId: string
  sourceStageId: string
  sourceArtifactId: string
  sceneId?: string
  evidence: Array<Record<string, unknown>>
  metadata: Record<string, unknown>
}

export interface KnowledgeGraphProjection {
  nodes: KnowledgeGraphNode[]
  edges: KnowledgeGraphEdge[]
}

export interface KnowledgeGraphQuery {
  docId: string
  chapterId: string
  runId: string
  q?: string
  kind?: KnowledgeGraphNodeKind | "all"
  nodeId?: string
  depth?: number
}

export interface KnowledgeGraphQueryResult extends KnowledgeGraphProjection {
  totalNodes: number
  totalEdges: number
}
