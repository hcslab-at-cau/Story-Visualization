import OpenAI from "openai"

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
const DEFAULT_EMBEDDING_MODEL = "openai/text-embedding-3-small"
const DEFAULT_EMBEDDING_DIMENSIONS = 1536
const EMBEDDING_BATCH_SIZE = 256

interface EmbedTextsOptions {
  model?: string
  dimensions?: number
}

export interface EmbeddingBatchResult {
  model: string
  dimensions: number
  embeddings: number[][]
  promptTokens: number
}

export async function embedTexts(
  texts: string[],
  options: EmbedTextsOptions = {},
): Promise<EmbeddingBatchResult> {
  if (texts.length === 0) throw new Error("At least one text is required for embedding")
  if (texts.some((text) => text.trim().length === 0)) throw new Error("Embedding input cannot be empty")

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is required to build or query IDX.2")

  const model = options.model ?? process.env.OPENROUTER_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL
  const dimensions = options.dimensions ?? DEFAULT_EMBEDDING_DIMENSIONS
  const client = new OpenAI({ apiKey, baseURL: OPENROUTER_BASE_URL })
  const embeddings: number[][] = []
  let promptTokens = 0

  for (let offset = 0; offset < texts.length; offset += EMBEDDING_BATCH_SIZE) {
    const response = await client.embeddings.create({
      model,
      input: texts.slice(offset, offset + EMBEDDING_BATCH_SIZE),
      dimensions,
      encoding_format: "float",
    })
    embeddings.push(...response.data.toSorted((left, right) => left.index - right.index).map((item) => item.embedding))
    promptTokens += response.usage?.prompt_tokens ?? 0
  }

  if (embeddings.length !== texts.length) {
    throw new Error(`Embedding provider returned ${embeddings.length} vectors for ${texts.length} inputs`)
  }
  if (embeddings.some((embedding) => embedding.length !== dimensions)) {
    throw new Error(`Embedding provider returned vectors that do not match ${dimensions} dimensions`)
  }

  return { model, dimensions, embeddings, promptTokens }
}
