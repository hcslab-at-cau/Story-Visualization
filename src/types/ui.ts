/** UI-specific types */

export interface ChapterMeta {
  chapterId: string
  title: string
  index: number
}

export interface DocumentMeta {
  docId: string
  title: string
}

export type StageStatus = "idle" | "running" | "done" | "error"

export interface StageState {
  status: StageStatus
  error?: string
}

export const PIPELINE_STAGES = [
  { id: "PRE.1",   label: "PRE.1 — EPUB to RawChapter JSON",  apiPath: "pre1" },
  { id: "PRE.2",   label: "PRE.2 — Content Classification",   apiPath: "pre2" },
  { id: "ENT.1",   label: "ENT.1 — Mention Extraction",       apiPath: "ent1" },
  { id: "ENT.2",   label: "ENT.2 — Mention Validation",       apiPath: "ent2" },
  { id: "ENT.3",   label: "ENT.3 — Entity Resolution",        apiPath: "ent3" },
  { id: "STATE.1", label: "STATE.1 — State Tracking",         apiPath: "state1" },
  { id: "STATE.2", label: "STATE.2 — State Validation",       apiPath: "state2" },
  { id: "STATE.3", label: "STATE.3 — Boundary Detection",     apiPath: "state3" },
  { id: "SCENE.1", label: "SCENE.1 — Scene Packet Builder",   apiPath: "scene1" },
  { id: "SCENE.2", label: "SCENE.2 — Scene Index Extraction", apiPath: "scene2" },
  { id: "SCENE.3", label: "SCENE.3 — Scene Validation",       apiPath: "scene3" },
  { id: "SUB.1",   label: "SUB.1 — Subscene Proposal",        apiPath: "sub1" },
  { id: "SUB.2",   label: "SUB.2 — Subscene State",           apiPath: "sub2" },
  { id: "SUB.3",   label: "SUB.3 — Subscene Validation",      apiPath: "sub3" },
  { id: "SUB.4",   label: "SUB.4 — Intervention Packaging",   apiPath: "sub4" },
  { id: "FINAL.1", label: "FINAL.1 — Scene Reader Package",   apiPath: "final1" },
  { id: "FINAL.2", label: "FINAL.2 — Overlay Refinement",     apiPath: "final2" },
] as const
