/** UI-specific types */
import { DEFAULT_STAGE_MODELS } from "@/config/pipeline-models"
import type { StageId } from "@/types/schema"

export interface ChapterMeta {
  chapterId: string
  title: string
  index: number
}

export interface DocumentMeta {
  docId: string
  title: string
  createdAt?: unknown
  sourceFile?: {
    bucket: string
    storagePath: string
    gsUri: string
    fileName: string
    contentType: string
    sizeBytes: number
  }
}

export type StageStatus = "idle" | "running" | "done" | "error"

export interface StageState {
  status: StageStatus
  error?: string
}

export interface PipelineStageDef {
  id: StageId
  label: string
  apiPath: string
  group: "pre" | "ent" | "state" | "scene" | "vis" | "sub" | "sup" | "final"
  usesModel?: boolean
  defaultModel?: string
  modelPlaceholder?: string
  implemented?: boolean
}

export const PIPELINE_STAGES: PipelineStageDef[] = [
  { id: "PRE.1", label: "PRE.1 - EPUB to RawChapter JSON", apiPath: "pre1", group: "pre" },
  { id: "PRE.2", label: "PRE.2 - Content Classification", apiPath: "pre2", group: "pre", usesModel: true, defaultModel: DEFAULT_STAGE_MODELS["PRE.2"], modelPlaceholder: "openai/gpt-4o-mini" },
  { id: "ENT.1", label: "ENT.1 - Mention Extraction", apiPath: "ent1", group: "ent", usesModel: true, defaultModel: DEFAULT_STAGE_MODELS["ENT.1"], modelPlaceholder: "openai/gpt-4o-mini" },
  { id: "ENT.2", label: "ENT.2 - Mention Validation", apiPath: "ent2", group: "ent", usesModel: true, defaultModel: DEFAULT_STAGE_MODELS["ENT.2"], modelPlaceholder: "openai/gpt-4o-mini" },
  { id: "ENT.3", label: "ENT.3 - Entity Resolution", apiPath: "ent3", group: "ent", usesModel: true, defaultModel: DEFAULT_STAGE_MODELS["ENT.3"], modelPlaceholder: "openai/gpt-4o-mini" },
  { id: "STATE.1", label: "STATE.1 - State Tracking", apiPath: "state1", group: "state" },
  { id: "STATE.2", label: "STATE.2 - State Validation", apiPath: "state2", group: "state", usesModel: true, defaultModel: DEFAULT_STAGE_MODELS["STATE.2"], modelPlaceholder: "openai/gpt-4o-mini" },
  { id: "STATE.3", label: "STATE.3 - Boundary Detection", apiPath: "state3", group: "state", usesModel: true, defaultModel: DEFAULT_STAGE_MODELS["STATE.3"], modelPlaceholder: "openai/gpt-4o-mini" },
  { id: "SCENE.1", label: "SCENE.1 - Scene Packet Builder", apiPath: "scene1", group: "scene" },
  { id: "SCENE.2", label: "SCENE.2 - Scene Index Extraction", apiPath: "scene2", group: "scene", usesModel: true, defaultModel: DEFAULT_STAGE_MODELS["SCENE.2"], modelPlaceholder: "openai/gpt-4o-mini" },
  { id: "SCENE.3", label: "SCENE.3 - Scene Validation", apiPath: "scene3", group: "scene", usesModel: true, defaultModel: DEFAULT_STAGE_MODELS["SCENE.3"], modelPlaceholder: "openai/gpt-4o-mini" },
  { id: "VIS.1", label: "VIS.1 - Semantic Clarification", apiPath: "vis1", group: "vis", usesModel: true, defaultModel: DEFAULT_STAGE_MODELS["VIS.1"], modelPlaceholder: "openai/gpt-4.1-mini" },
  { id: "VIS.2", label: "VIS.2 - Stage Blueprint", apiPath: "vis2", group: "vis", usesModel: true, defaultModel: DEFAULT_STAGE_MODELS["VIS.2"], modelPlaceholder: "openai/gpt-4.1-mini" },
  { id: "VIS.3", label: "VIS.3 - Render Package", apiPath: "vis3", group: "vis" },
  { id: "VIS.4", label: "VIS.4 - Image Generation", apiPath: "vis4", group: "vis", usesModel: true, defaultModel: DEFAULT_STAGE_MODELS["VIS.4"], modelPlaceholder: "openai/gpt-image-1" },
  { id: "SUB.1", label: "SUB.1 - Subscene Proposal", apiPath: "sub1", group: "sub", usesModel: true, defaultModel: DEFAULT_STAGE_MODELS["SUB.1"], modelPlaceholder: "openai/gpt-4o-mini" },
  { id: "SUB.2", label: "SUB.2 - Subscene State", apiPath: "sub2", group: "sub", usesModel: true, defaultModel: DEFAULT_STAGE_MODELS["SUB.2"], modelPlaceholder: "openai/gpt-4o-mini" },
  { id: "SUB.3", label: "SUB.3 - Subscene Validation", apiPath: "sub3", group: "sub", usesModel: true, defaultModel: DEFAULT_STAGE_MODELS["SUB.3"], modelPlaceholder: "openai/gpt-4o-mini" },
  { id: "SUB.4", label: "SUB.4 - Intervention Packaging", apiPath: "sub4", group: "sub", usesModel: true, defaultModel: DEFAULT_STAGE_MODELS["SUB.4"], modelPlaceholder: "openai/gpt-4o-mini" },
  { id: "SUP.0", label: "SUP.0 - Support Memory", apiPath: "sup0", group: "sup" },
  { id: "SUP.1", label: "SUP.1 - Shared Support Context", apiPath: "sup1", group: "sup" },
  { id: "SUP.2", label: "SUP.2 - Snapshot and Boundary", apiPath: "sup2", group: "sup" },
  { id: "SUP.3", label: "SUP.3 - Causal Bridges", apiPath: "sup3", group: "sup" },
  { id: "SUP.4", label: "SUP.4 - Character and Relation", apiPath: "sup4", group: "sup" },
  { id: "SUP.5", label: "SUP.5 - Reentry and Reference", apiPath: "sup5", group: "sup" },
  { id: "SUP.6", label: "SUP.6 - Support Policy", apiPath: "sup6", group: "sup" },
  { id: "SUP.7", label: "SUP.7 - Reader Support Package", apiPath: "sup7", group: "sup" },
  { id: "FINAL.1", label: "FINAL.1 - Scene Reader Package", apiPath: "final1", group: "final" },
  { id: "FINAL.2", label: "FINAL.2 - Overlay Refinement", apiPath: "final2", group: "final", usesModel: true, defaultModel: DEFAULT_STAGE_MODELS["FINAL.2"], modelPlaceholder: "openai/gpt-4o-mini" },
]
