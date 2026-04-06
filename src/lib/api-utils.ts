/**
 * Shared utilities for API Route Handlers.
 */

import { LLMClient } from "@/lib/llm-client"
import type { PipelineArtifact } from "@/types/schema"

export interface BaseRequestBody {
  docId: string
  chapterId: string
  runId: string
  model?: string
  parents?: Record<string, string>
}

export function createLLMClient(body: BaseRequestBody): LLMClient {
  const apiKey = process.env.OPENROUTER_API_KEY
  const model = body.model ?? process.env.OPENROUTER_DEFAULT_MODEL ?? "openai/gpt-4o-mini"
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set in .env.local")
  }
  return new LLMClient(model, apiKey)
}

export function attachLLMDebug<T extends PipelineArtifact>(artifact: T, llm?: LLMClient): T {
  const trials = llm?.getDebugTrials() ?? []
  if (trials.length === 0) return artifact
  return {
    ...artifact,
    llm_debug: { trials },
  }
}

export function errorResponse(message: string, status = 500): Response {
  return Response.json({ error: message }, { status })
}

export function okResponse(data: unknown): Response {
  return Response.json(data)
}
