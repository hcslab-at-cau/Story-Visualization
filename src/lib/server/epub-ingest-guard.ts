import { createHash, timingSafeEqual } from "node:crypto"

export interface EpubIngestPolicy {
  maxRequestBytes: number
  maxEpubBytes: number
  maxZipEntries: number
  maxEntryUncompressedBytes: number
  maxTotalUncompressedBytes: number
  maxCompressionRatio: number
}

export const DEFAULT_EPUB_INGEST_POLICY: EpubIngestPolicy = {
  maxRequestBytes: 51 * 1024 * 1024,
  maxEpubBytes: 50 * 1024 * 1024,
  maxZipEntries: 5_000,
  maxEntryUncompressedBytes: 16 * 1024 * 1024,
  maxTotalUncompressedBytes: 256 * 1024 * 1024,
  maxCompressionRatio: 100,
}

export class EpubIngestGuardError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly headers: HeadersInit = {},
  ) {
    super(message)
    this.name = "EpubIngestGuardError"
  }
}

function ingestNotConfigured(): EpubIngestGuardError {
  return new EpubIngestGuardError(
    503,
    "ingest_not_configured",
    "EPUB ingest is not configured",
  )
}

function unauthorized(): EpubIngestGuardError {
  return new EpubIngestGuardError(
    401,
    "unauthorized",
    "Unauthorized",
    { "WWW-Authenticate": "Bearer" },
  )
}

function invalidContentLength(): EpubIngestGuardError {
  return new EpubIngestGuardError(
    400,
    "invalid_content_length",
    "Content-Length must be a non-negative decimal integer",
  )
}

function requestTooLarge(): EpubIngestGuardError {
  return new EpubIngestGuardError(
    413,
    "request_too_large",
    "Request body exceeds the configured size limit",
  )
}

function sha256Utf8(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest()
}

export function authorizeEpubIngestRequest(
  request: Request,
  config: { production: boolean; adminToken?: string },
): void {
  const { production, adminToken } = config

  if (adminToken === undefined) {
    if (production) throw ingestNotConfigured()
    return
  }

  if (Buffer.byteLength(adminToken, "utf8") < 32) {
    throw ingestNotConfigured()
  }

  const actual = sha256Utf8(request.headers.get("authorization") ?? "")
  const expected = sha256Utf8(`Bearer ${adminToken}`)
  if (!timingSafeEqual(actual, expected)) throw unauthorized()
}

export function validateDeclaredRequestSize(
  request: Request,
  maxBytes: number,
): void {
  const contentLength = request.headers.get("content-length")
  if (contentLength === null) return

  if (!/^\d+$/.test(contentLength)) throw invalidContentLength()

  const declaredBytes = BigInt(contentLength)
  if (declaredBytes > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw invalidContentLength()
  }

  if (declaredBytes > BigInt(maxBytes)) throw requestTooLarge()
}

export async function readBoundedRequestBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  if (request.body === null) return new Uint8Array()

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const nextTotalBytes = totalBytes + value.byteLength
      if (!Number.isSafeInteger(nextTotalBytes) || nextTotalBytes > maxBytes) {
        const error = requestTooLarge()
        try {
          await reader.cancel()
        } catch {
          // Preserve the stable public overflow error if stream cancellation fails.
        }
        throw error
      }

      totalBytes = nextTotalBytes
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

export class IngestConcurrencyGate {
  private active = 0

  constructor(private readonly maxActive = 1) {}

  tryAcquire(): (() => void) | undefined {
    if (this.active >= this.maxActive) return undefined

    this.active += 1
    let released = false

    return () => {
      if (released) return
      released = true
      this.active -= 1
    }
  }
}
