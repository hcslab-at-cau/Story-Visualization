import type { StageId } from "@/types/schema"

export const DEFAULT_STAGE_MODELS: Partial<Record<StageId, string>> = {
  "PRE.2": "openai/gpt-4o-mini",
  "ENT.1": "openai/gpt-4o-mini",
  "ENT.2": "google/gemini-3.1-pro-preview",
  "ENT.3": "anthropic/claude-sonnet-4.6",
  "STATE.2": "openai/gpt-4.1-mini",
  "STATE.3": "openai/gpt-4.1-mini",
  "SCENE.2": "openai/gpt-4o-mini",
  "SCENE.3": "openai/gpt-4o-mini",
  "VIS.1": "openai/gpt-4.1-mini",
  "VIS.2": "openai/gpt-4.1-mini",
  "VIS.4": "google/gemini-3.1-flash-image-preview",
  "SUB.1": "openai/gpt-4.1-mini",
  "SUB.2": "openai/gpt-4.1-mini",
  "SUB.3": "anthropic/claude-sonnet-4.6",
  "SUB.4": "openai/gpt-4.1-mini",
  "FINAL.2": "openai/gpt-4.1-mini",
}
