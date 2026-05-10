import { createHash } from "crypto"
import type {
  EntityGraph,
  PipelineArtifact,
  SupportMemoryLog,
} from "@/types/schema"
import type {
  KnowledgeGraphEdge,
  KnowledgeGraphEdgeType,
  KnowledgeGraphNode,
  KnowledgeGraphNodeKind,
  KnowledgeGraphProjection,
} from "@/types/graph"

interface ProjectionContext {
  docId: string
  chapterId: string
  runId: string
  sourceStageId: string
  sourceArtifactId: string
}

function hashId(prefix: string, value: string): string {
  const hash = createHash("sha256").update(value).digest("hex").slice(0, 28)
  return `${prefix}_${hash}`
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9가-힣]+/gi, "_").replace(/^_+|_+$/g, "")
}

function compactStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))))
}

function evidenceRecords(values: unknown[]): Array<Record<string, unknown>> {
  return values.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object"))
}

function nodeId(ctx: ProjectionContext, localId: string): string {
  return hashId("kg_node", `${ctx.docId}|${ctx.chapterId}|${ctx.runId}|${localId}`)
}

function edgeId(ctx: ProjectionContext, localId: string): string {
  return hashId("kg_edge", `${ctx.docId}|${ctx.chapterId}|${ctx.runId}|${localId}`)
}

function buildSearchText(parts: unknown[]): string {
  return parts
    .flatMap((part) => {
      if (Array.isArray(part)) return part
      if (part && typeof part === "object") return Object.values(part as Record<string, unknown>)
      return [part]
    })
    .map((part) => (typeof part === "string" ? part : ""))
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

class GraphBuilder {
  private nodes = new Map<string, KnowledgeGraphNode>()
  private edges = new Map<string, KnowledgeGraphEdge>()

  constructor(private readonly ctx: ProjectionContext) {}

  addNode(params: {
    localId: string
    kind: KnowledgeGraphNodeKind
    label: string
    sceneId?: string
    eventId?: string
    entityId?: string
    tags?: Array<string | undefined>
    metadata?: Record<string, unknown>
  }): string {
    const id = nodeId(this.ctx, params.localId)
    const tags = compactStrings(params.tags ?? [])
    const metadata = params.metadata ?? {}
    const existing = this.nodes.get(id)
    const nextTags = existing ? compactStrings([...existing.tags, ...tags]) : tags
    this.nodes.set(id, {
      nodeId: id,
      localId: params.localId,
      kind: params.kind,
      label: params.label || params.localId,
      docId: this.ctx.docId,
      chapterId: this.ctx.chapterId,
      runId: this.ctx.runId,
      sourceStageId: this.ctx.sourceStageId,
      sourceArtifactId: this.ctx.sourceArtifactId,
      sceneId: params.sceneId ?? existing?.sceneId,
      eventId: params.eventId ?? existing?.eventId,
      entityId: params.entityId ?? existing?.entityId,
      tags: nextTags,
      searchText: buildSearchText([params.label, nextTags, metadata]),
      metadata: {
        ...(existing?.metadata ?? {}),
        ...metadata,
      },
    })
    return id
  }

  addEdge(params: {
    localId: string
    type: KnowledgeGraphEdgeType
    fromNodeId: string
    toNodeId: string
    label: string
    sceneId?: string
    evidence?: Array<Record<string, unknown>>
    metadata?: Record<string, unknown>
  }): void {
    if (!params.fromNodeId || !params.toNodeId) return
    const id = edgeId(this.ctx, params.localId)
    this.edges.set(id, {
      edgeId: id,
      localId: params.localId,
      type: params.type,
      fromNodeId: params.fromNodeId,
      toNodeId: params.toNodeId,
      label: params.label || params.type,
      docId: this.ctx.docId,
      chapterId: this.ctx.chapterId,
      runId: this.ctx.runId,
      sourceStageId: this.ctx.sourceStageId,
      sourceArtifactId: this.ctx.sourceArtifactId,
      sceneId: params.sceneId,
      evidence: params.evidence ?? [],
      metadata: params.metadata ?? {},
    })
  }

  build(): KnowledgeGraphProjection {
    return {
      nodes: Array.from(this.nodes.values()),
      edges: Array.from(this.edges.values()),
    }
  }
}

function projectSupportMemory(ctx: ProjectionContext, artifact: SupportMemoryLog): KnowledgeGraphProjection {
  const builder = new GraphBuilder(ctx)
  const sceneNodeById = new Map<string, string>()
  const eventNodeById = new Map<string, string>()

  for (const scene of artifact.memory.scenes) {
    const sceneNode = builder.addNode({
      localId: `scene:${scene.scene_id}`,
      kind: "scene",
      label: scene.scene_title || scene.scene_id,
      sceneId: scene.scene_id,
      tags: [
        scene.scene_id,
        scene.place,
        scene.time,
        ...scene.active_cast,
        ...scene.mentioned_places,
        ...scene.goals,
        ...scene.actions,
      ],
      metadata: {
        start_pid: scene.start_pid,
        end_pid: scene.end_pid,
        summary: scene.summary,
        place: scene.place,
        time: scene.time,
        active_cast: scene.active_cast,
        goals: scene.goals,
        actions: scene.actions,
      },
    })
    sceneNodeById.set(scene.scene_id, sceneNode)

    if (scene.previous_scene_id) {
      const previousNode = sceneNodeById.get(scene.previous_scene_id)
      if (previousNode) {
        builder.addEdge({
          localId: `scene-sequence:${scene.previous_scene_id}->${scene.scene_id}`,
          type: "scene_sequence",
          fromNodeId: previousNode,
          toNodeId: sceneNode,
          label: `${scene.previous_scene_id} -> ${scene.scene_id}`,
          sceneId: scene.scene_id,
        })
      }
    }

    for (const name of scene.active_cast) {
      const characterNode = builder.addNode({
        localId: `character:${normalizeKey(name)}`,
        kind: "character",
        label: name,
        sceneId: scene.scene_id,
        tags: [name, scene.scene_id],
      })
      builder.addEdge({
        localId: `active-cast:${scene.scene_id}:${normalizeKey(name)}`,
        type: "active_cast",
        fromNodeId: sceneNode,
        toNodeId: characterNode,
        label: `${name} appears in ${scene.scene_id}`,
        sceneId: scene.scene_id,
      })
    }

    for (const place of compactStrings([scene.place, ...scene.mentioned_places])) {
      const placeNode = builder.addNode({
        localId: `place:${normalizeKey(place)}`,
        kind: "place",
        label: place,
        sceneId: scene.scene_id,
        tags: [place, scene.scene_id],
      })
      builder.addEdge({
        localId: `located-at:${scene.scene_id}:${normalizeKey(place)}`,
        type: "located_at",
        fromNodeId: sceneNode,
        toNodeId: placeNode,
        label: `${scene.scene_id} at ${place}`,
        sceneId: scene.scene_id,
      })
    }
  }

  for (const event of artifact.memory.events) {
    const eventNode = builder.addNode({
      localId: `event:${event.event_id}`,
      kind: "event",
      label: event.label || event.action,
      sceneId: event.scene_id,
      eventId: event.event_id,
      tags: [event.label, event.action, event.place, ...event.actors],
      metadata: {
        action: event.action,
        actors: event.actors,
        place: event.place,
        causal_input: event.causal_input,
        causal_result: event.causal_result,
        subscene_id: event.subscene_id,
      },
    })
    eventNodeById.set(event.event_id, eventNode)

    const sceneNode = sceneNodeById.get(event.scene_id)
    if (sceneNode) {
      builder.addEdge({
        localId: `contains-event:${event.scene_id}:${event.event_id}`,
        type: "contains_event",
        fromNodeId: sceneNode,
        toNodeId: eventNode,
        label: `${event.scene_id} contains ${event.label}`,
        sceneId: event.scene_id,
        evidence: evidenceRecords(event.evidence),
      })
    }

    for (const actor of event.actors) {
      const characterNode = builder.addNode({
        localId: `character:${normalizeKey(actor)}`,
        kind: "character",
        label: actor,
        sceneId: event.scene_id,
        tags: [actor, event.scene_id],
      })
      builder.addEdge({
        localId: `actor:${event.event_id}:${normalizeKey(actor)}`,
        type: "actor",
        fromNodeId: eventNode,
        toNodeId: characterNode,
        label: `${actor}: ${event.action}`,
        sceneId: event.scene_id,
        evidence: evidenceRecords(event.evidence),
      })
    }
  }

  for (const edge of artifact.memory.edges) {
    const fromNode = edge.from_event_id
      ? eventNodeById.get(edge.from_event_id)
      : sceneNodeById.get(edge.from_scene_id)
    const toNode = edge.to_event_id
      ? eventNodeById.get(edge.to_event_id)
      : sceneNodeById.get(edge.to_scene_id)
    if (!fromNode || !toNode) continue

    builder.addEdge({
      localId: `memory-edge:${edge.edge_id}`,
      type: edge.type,
      fromNodeId: fromNode,
      toNodeId: toNode,
      label: edge.label,
      sceneId: edge.to_scene_id,
      evidence: evidenceRecords(edge.evidence),
      metadata: {
        from_scene_id: edge.from_scene_id,
        to_scene_id: edge.to_scene_id,
        from_event_id: edge.from_event_id,
        to_event_id: edge.to_event_id,
      },
    })
  }

  return builder.build()
}

function projectEntityGraph(ctx: ProjectionContext, artifact: EntityGraph): KnowledgeGraphProjection {
  const builder = new GraphBuilder(ctx)

  for (const entity of artifact.entities) {
    const entityNode = builder.addNode({
      localId: `entity:${entity.entity_id}`,
      kind: "entity",
      label: entity.canonical_name,
      entityId: entity.entity_id,
      tags: [
        entity.canonical_name,
        entity.mention_type,
        ...entity.mentions.map((mention) => mention.span),
      ],
      metadata: {
        mention_type: entity.mention_type,
        mention_count: entity.mentions.length,
      },
    })

    for (const mention of entity.mentions) {
      const mentionNode = builder.addNode({
        localId: `mention:${mention.mention_id}`,
        kind: "mention",
        label: mention.span,
        entityId: entity.entity_id,
        tags: [mention.span, entity.canonical_name],
        metadata: {
          pid: mention.pid,
          start_char: mention.start_char,
          end_char: mention.end_char,
        },
      })
      builder.addEdge({
        localId: `has-mention:${entity.entity_id}:${mention.mention_id}`,
        type: "has_mention",
        fromNodeId: entityNode,
        toNodeId: mentionNode,
        label: `${entity.canonical_name} mentioned as ${mention.span}`,
      })
    }
  }

  return builder.build()
}

export function projectKnowledgeGraphArtifact(params: {
  docId: string
  chapterId: string
  runId: string
  sourceArtifactId: string
  artifact: PipelineArtifact
}): KnowledgeGraphProjection {
  const ctx: ProjectionContext = {
    docId: params.docId,
    chapterId: params.chapterId,
    runId: params.runId,
    sourceStageId: params.artifact.stage_id,
    sourceArtifactId: params.sourceArtifactId,
  }

  if (params.artifact.stage_id === "SUP.0") {
    return projectSupportMemory(ctx, params.artifact as SupportMemoryLog)
  }

  if (params.artifact.stage_id === "ENT.3") {
    return projectEntityGraph(ctx, params.artifact as EntityGraph)
  }

  return { nodes: [], edges: [] }
}
