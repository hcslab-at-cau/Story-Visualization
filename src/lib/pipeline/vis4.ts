/**
 * VIS.4 - Image Generation (OpenRouter chat completions + Firebase Storage)
 */

import type { RenderPackage, RenderedImageResult, RenderedImages } from "@/types/schema"
import { uploadGeneratedImage } from "@/lib/storage"

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
const DEFAULT_IMAGE_MODEL = "google/gemini-3.1-flash-image-preview"
const DEFAULT_IMAGE_ASPECT_RATIO = "3:2"
const DEFAULT_IMAGE_SIZE = "1K"

function resolveModel(explicitModel?: string): string {
  return explicitModel?.trim() || DEFAULT_IMAGE_MODEL
}

function getOpenRouterApiKey(): string {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set in .env.local")
  }
  return apiKey
}

function decodeBase64Image(b64: string): Buffer {
  return Buffer.from(b64, "base64")
}

async function downloadImageBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download generated image: HTTP ${response.status}`)
  }
  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

function inferMimeType(model: string, outputFormat: string): string {
  const normalized = outputFormat.toLowerCase()
  if (normalized === "jpeg" || normalized === "jpg") return "image/jpeg"
  if (normalized === "webp") return "image/webp"
  if (normalized === "png") return "image/png"

  if (model.startsWith("google/")) return "image/png"
  return "image/png"
}

async function generateSingleImage(params: {
  prompt: string
  model: string
}): Promise<{ buffer: Buffer; contentType: string; outputFormat: string }> {
  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getOpenRouterApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      messages: [
        {
          role: "user",
          content: params.prompt,
        },
      ],
      modalities: ["image", "text"],
      stream: false,
      image_config: {
        aspect_ratio: DEFAULT_IMAGE_ASPECT_RATIO,
        image_size: DEFAULT_IMAGE_SIZE,
      },
    }),
  })

  if (!response.ok) {
    const rawText = await response.text()
    throw new Error(`OpenRouter image request failed: HTTP ${response.status} ${rawText.slice(0, 400)}`)
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        images?: Array<{
          type?: string
          image_url?: {
            url?: string
          }
        }>
      }
    }>
  }

  const imageUrl = payload.choices?.[0]?.message?.images?.[0]?.image_url?.url
  if (!imageUrl || typeof imageUrl !== "string") {
    throw new Error("OpenRouter image response contained no generated image")
  }

  if (imageUrl.startsWith("data:image/")) {
    const match = imageUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
    if (!match) {
      throw new Error("Generated image returned an unreadable data URL")
    }

    const contentType = match[1]
    const b64 = match[2]
    const outputFormat = contentType.split("/")[1] || "png"
    return {
      buffer: decodeBase64Image(b64),
      contentType,
      outputFormat,
    }
  }

  const buffer = await downloadImageBuffer(imageUrl)
  return {
    buffer,
    contentType: inferMimeType(params.model, "png"),
    outputFormat: "png",
  }
}

export async function runImageGeneration(
  renderPackage: RenderPackage,
  docId: string,
  chapterId: string,
  runId: string,
  parents: Record<string, string> = {},
  explicitModel?: string,
): Promise<RenderedImages> {
  const model = resolveModel(explicitModel)
  const results: RenderedImageResult[] = []

  for (const item of renderPackage.items) {
    try {
      const generated = await generateSingleImage({
        prompt: item.full_prompt,
        model,
      })

      const stored = await uploadGeneratedImage({
        docId,
        chapterId,
        runId,
        sceneId: item.scene_id,
        buffer: generated.buffer,
        contentType: generated.contentType,
        fileExtension: generated.outputFormat,
      })

      results.push({
        scene_id: item.scene_id,
        image_path: stored.downloadUrl,
        prompt_used: item.full_prompt,
        model,
        success: true,
        storage_path: stored.storagePath,
        gs_uri: stored.gsUri,
        download_url: stored.downloadUrl,
        content_type: stored.contentType,
        size_bytes: stored.sizeBytes,
      })
    } catch (error) {
      results.push({
        scene_id: item.scene_id,
        prompt_used: item.full_prompt,
        model,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    run_id: `image_gen__${docId}__${chapterId}`,
    doc_id: docId,
    chapter_id: chapterId,
    stage_id: "VIS.4",
    method: "image_api",
    model,
    style: renderPackage.items[0]?.prompt_schema_version ?? "vis3.render_package.v1",
    parents,
    results,
  }
}
