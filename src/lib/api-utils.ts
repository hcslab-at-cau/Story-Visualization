/**
 * Shared utilities for API Route Handlers.
 */

import { LLMClient } from "@/lib/llm-client"
import type { PipelineArtifact, StageId } from "@/types/schema"

export interface BaseRequestBody {
  docId: string
  chapterId: string
  runId: string
  model?: string
  parents?: Record<string, string>
  source?: string
  seedSource?: string
}

export interface PipelineProgressEvent {
  message: string
  stageId?: StageId
  completed?: number
  total?: number
  unit?: string
}

export type ProgressReporter = (progress: string | PipelineProgressEvent) => void

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

function normalizeProgress(progress: string | PipelineProgressEvent): PipelineProgressEvent {
  if (typeof progress === "string") {
    return { message: progress }
  }
  return progress
}

function streamEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: string,
  data: unknown,
): void {
  controller.enqueue(
    encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
  )
}

export function wantsProgressStream(request: Request): boolean {
  return request.headers.get("accept")?.includes("text/event-stream") ?? false
}

export function progressStreamResponse<T>(
  executor: (progress: ProgressReporter) => Promise<T>,
): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const progress: ProgressReporter = (event) => {
        streamEvent(controller, encoder, "progress", normalizeProgress(event))
      }

      try {
        const result = await executor(progress)
        streamEvent(controller, encoder, "result", result)
      } catch (error) {
        streamEvent(controller, encoder, "error", {
          error: error instanceof Error ? error.message : String(error),
        })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
}
