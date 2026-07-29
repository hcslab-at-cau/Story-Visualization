import { createHash, timingSafeEqual } from "node:crypto"
import AdmZip from "adm-zip"

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

export interface EpubArchiveSummary {
  entryCount: number
  totalCompressedBytes: number
  totalUncompressedBytes: number
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

function invalidEpub(): EpubIngestGuardError {
  return new EpubIngestGuardError(
    422,
    "invalid_epub",
    "Invalid EPUB archive",
  )
}

function epubResourceLimit(): EpubIngestGuardError {
  return new EpubIngestGuardError(
    413,
    "epub_resource_limit",
    "EPUB archive exceeds the configured resource limits",
  )
}

function rethrowStableArchiveError(error: unknown): never {
  if (error instanceof EpubIngestGuardError) throw error
  throw invalidEpub()
}

function requireSafeArchiveInteger(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw invalidEpub()
}

function addArchiveBytes(total: number, value: number): number {
  const next = total + value
  requireSafeArchiveInteger(next)
  return next
}

function rejectUnsafeExtraFields(extra: Buffer): void {
  let offset = 0
  while (offset < extra.length) {
    if (extra.length - offset < 4) throw invalidEpub()

    const headerId = extra.readUInt16LE(offset)
    const dataLength = extra.readUInt16LE(offset + 2)
    offset += 4
    if (dataLength > extra.length - offset) throw invalidEpub()
    if (headerId === 0x0001) throw invalidEpub()
    offset += dataLength
  }
}

function archiveEntryKey(entryName: string, isDirectory: boolean): string {
  if (
    entryName.includes("\0") ||
    entryName.includes("\\") ||
    entryName.startsWith("/") ||
    /^[A-Za-z]:/.test(entryName)
  ) {
    throw invalidEpub()
  }

  const segments = entryName.split("/")
  if (isDirectory) {
    if (segments.at(-1) !== "") throw invalidEpub()
    segments.pop()
  }
  if (
    segments.length === 0 ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw invalidEpub()
  }
  return segments.join("/")
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

export function validateEpubArchive(
  buffer: Buffer,
  policy: EpubIngestPolicy = DEFAULT_EPUB_INGEST_POLICY,
): EpubArchiveSummary {
  let archive: AdmZip
  try {
    archive = new AdmZip(buffer)
  } catch {
    throw invalidEpub()
  }

  let entryCount: number
  try {
    entryCount = archive.getEntryCount()
    requireSafeArchiveInteger(entryCount)
  } catch (error) {
    rethrowStableArchiveError(error)
  }
  if (entryCount > policy.maxZipEntries) throw epubResourceLimit()

  let entries: AdmZip.IZipEntry[]
  try {
    entries = archive.getEntries()
    if (entries.length !== entryCount) throw invalidEpub()
  } catch (error) {
    rethrowStableArchiveError(error)
  }

  let totalCompressedBytes = 0
  let totalUncompressedBytes = 0
  let mimetypeEntry: AdmZip.IZipEntry | undefined
  let mimetypeCount = 0
  let containerCount = 0
  const entryKeys = new Set<string>()

  try {
    for (const entry of entries) {
      rejectUnsafeExtraFields(entry.extra)

      const entryName = entry.entryName
      const key = archiveEntryKey(entryName, entry.isDirectory)
      if (entryKeys.has(key)) throw invalidEpub()
      entryKeys.add(key)

      const { flags, encrypted, method, compressedSize, size } = entry.header
      requireSafeArchiveInteger(flags)
      requireSafeArchiveInteger(method)
      requireSafeArchiveInteger(compressedSize)
      requireSafeArchiveInteger(size)
      if (encrypted || (flags & 0x0001) !== 0) throw invalidEpub()
      if (method !== 0 && method !== 8) throw invalidEpub()
      if (method === 0 && compressedSize !== size) throw invalidEpub()
      if (method === 8 && compressedSize > 0 && size === 0) throw invalidEpub()

      if (size > policy.maxEntryUncompressedBytes) throw epubResourceLimit()
      totalCompressedBytes = addArchiveBytes(totalCompressedBytes, compressedSize)
      totalUncompressedBytes = addArchiveBytes(totalUncompressedBytes, size)
      if (totalUncompressedBytes > policy.maxTotalUncompressedBytes) {
        throw epubResourceLimit()
      }
      if (
        (compressedSize === 0 && size > 0) ||
        (compressedSize > 0 && size / compressedSize > policy.maxCompressionRatio)
      ) {
        throw epubResourceLimit()
      }

      if (entryName === "mimetype") {
        mimetypeCount += 1
        mimetypeEntry = entry
      }
      if (entryName === "META-INF/container.xml") containerCount += 1
    }

    if (mimetypeCount !== 1 || mimetypeEntry === undefined || containerCount !== 1) {
      throw invalidEpub()
    }
    if (
      mimetypeEntry.header.method !== 0 ||
      mimetypeEntry.header.compressedSize !== 20 ||
      mimetypeEntry.header.size !== 20
    ) {
      throw invalidEpub()
    }
  } catch (error) {
    rethrowStableArchiveError(error)
  }

  let mimetype: Buffer
  try {
    mimetype = mimetypeEntry.getData()
  } catch {
    throw invalidEpub()
  }
  if (!mimetype.equals(Buffer.from("application/epub+zip", "ascii"))) {
    throw invalidEpub()
  }

  return {
    entryCount,
    totalCompressedBytes,
    totalUncompressedBytes,
  }
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
