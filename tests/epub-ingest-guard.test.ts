import assert from "node:assert/strict"
import test from "node:test"
import {
  DEFAULT_EPUB_INGEST_POLICY,
  EpubIngestGuardError,
  IngestConcurrencyGate,
  authorizeEpubIngestRequest,
  readBoundedRequestBody,
  validateEpubArchive,
  validateDeclaredRequestSize,
  type EpubIngestPolicy,
} from "../src/lib/server/epub-ingest-guard.ts"
import { buildSyntheticEpub } from "./helpers/synthetic-epub.ts"

const SMALL_POLICY: EpubIngestPolicy = {
  maxRequestBytes: 12,
  maxEpubBytes: 8,
  maxZipEntries: 8,
  maxEntryUncompressedBytes: 64,
  maxTotalUncompressedBytes: 128,
  maxCompressionRatio: 4,
}

function matchesGuardError(
  statusCode: number,
  code: string,
  headers?: Record<string, string>,
): (error: unknown) => boolean {
  return (error: unknown) => {
    if (!(error instanceof EpubIngestGuardError)) return false
    if (error.statusCode !== statusCode || error.code !== code) return false

    const actualHeaders = new Headers(error.headers)
    return Object.entries(headers ?? {}).every(
      ([name, value]) => actualHeaders.get(name) === value,
    )
  }
}

interface CentralDirectoryEntry {
  centralOffset: number
  centralSize: number
  compressedSize: number
  localOffset: number
  name: string
}

const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minimumOffset = Math.max(0, buffer.length - 65_557)
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      return offset
    }
  }
  throw new Error("Synthetic ZIP is missing its end-of-central-directory record")
}

function listCentralDirectoryEntries(buffer: Buffer): CentralDirectoryEntry[] {
  const endOffset = findEndOfCentralDirectory(buffer)
  const centralDirectoryOffset = buffer.readUInt32LE(endOffset + 16)
  const entryCount = buffer.readUInt16LE(endOffset + 10)
  const entries: CentralDirectoryEntry[] = []
  let offset = centralDirectoryOffset

  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(buffer.readUInt32LE(offset), CENTRAL_DIRECTORY_SIGNATURE)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const centralSize = 46 + nameLength + extraLength + commentLength

    entries.push({
      centralOffset: offset,
      centralSize,
      compressedSize: buffer.readUInt32LE(offset + 20),
      localOffset: buffer.readUInt32LE(offset + 42),
      name: buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"),
    })
    offset += centralSize
  }

  return entries
}

function requireCentralDirectoryEntry(buffer: Buffer, name: string): CentralDirectoryEntry {
  const entry = listCentralDirectoryEntries(buffer).find((candidate) => candidate.name === name)
  assert.ok(entry, `Synthetic ZIP entry not found: ${name}`)
  return entry
}

function patchEntryMetadata(
  source: Buffer,
  name: string,
  patch: { flags?: number; method?: number; compressedSize?: number; uncompressedSize?: number },
): Buffer {
  const buffer = Buffer.from(source)
  const entry = requireCentralDirectoryEntry(buffer, name)
  assert.equal(buffer.readUInt32LE(entry.localOffset), LOCAL_FILE_HEADER_SIGNATURE)

  if (patch.flags !== undefined) {
    buffer.writeUInt16LE(patch.flags, entry.centralOffset + 8)
    buffer.writeUInt16LE(patch.flags, entry.localOffset + 6)
  }
  if (patch.method !== undefined) {
    buffer.writeUInt16LE(patch.method, entry.centralOffset + 10)
    buffer.writeUInt16LE(patch.method, entry.localOffset + 8)
  }
  if (patch.compressedSize !== undefined) {
    buffer.writeUInt32LE(patch.compressedSize, entry.centralOffset + 20)
    buffer.writeUInt32LE(patch.compressedSize, entry.localOffset + 18)
  }
  if (patch.uncompressedSize !== undefined) {
    buffer.writeUInt32LE(patch.uncompressedSize, entry.centralOffset + 24)
    buffer.writeUInt32LE(patch.uncompressedSize, entry.localOffset + 22)
  }

  return buffer
}

function duplicateZipEntry(source: Buffer, name: string): Buffer {
  const endOffset = findEndOfCentralDirectory(source)
  const centralDirectoryOffset = source.readUInt32LE(endOffset + 16)
  const entry = requireCentralDirectoryEntry(source, name)
  const localNameLength = source.readUInt16LE(entry.localOffset + 26)
  const localExtraLength = source.readUInt16LE(entry.localOffset + 28)
  const localSize = 30 + localNameLength + localExtraLength + entry.compressedSize
  const duplicateLocal = Buffer.from(source.subarray(entry.localOffset, entry.localOffset + localSize))
  const duplicateCentral = Buffer.from(
    source.subarray(entry.centralOffset, entry.centralOffset + entry.centralSize),
  )
  duplicateCentral.writeUInt32LE(centralDirectoryOffset, 42)

  const endRecord = Buffer.from(source.subarray(endOffset))
  const diskEntries = endRecord.readUInt16LE(8)
  const totalEntries = endRecord.readUInt16LE(10)
  endRecord.writeUInt16LE(diskEntries + 1, 8)
  endRecord.writeUInt16LE(totalEntries + 1, 10)
  endRecord.writeUInt32LE(endRecord.readUInt32LE(12) + duplicateCentral.length, 12)
  endRecord.writeUInt32LE(centralDirectoryOffset + duplicateLocal.length, 16)

  return Buffer.concat([
    source.subarray(0, centralDirectoryOffset),
    duplicateLocal,
    source.subarray(centralDirectoryOffset, endOffset),
    duplicateCentral,
    endRecord,
  ])
}

function addCentralDirectoryExtraField(
  source: Buffer,
  name: string,
  headerId: number,
  data: Buffer,
): Buffer {
  const endOffset = findEndOfCentralDirectory(source)
  const entry = requireCentralDirectoryEntry(source, name)
  const nameLength = source.readUInt16LE(entry.centralOffset + 28)
  const extraLength = source.readUInt16LE(entry.centralOffset + 30)
  const field = Buffer.alloc(4 + data.length)
  field.writeUInt16LE(headerId, 0)
  field.writeUInt16LE(data.length, 2)
  data.copy(field, 4)

  const insertionOffset = entry.centralOffset + 46 + nameLength + extraLength
  const buffer = Buffer.concat([
    source.subarray(0, insertionOffset),
    field,
    source.subarray(insertionOffset),
  ])
  buffer.writeUInt16LE(extraLength + field.length, entry.centralOffset + 30)

  const patchedEndOffset = endOffset + field.length
  buffer.writeUInt32LE(
    buffer.readUInt32LE(patchedEndOffset + 12) + field.length,
    patchedEndOffset + 12,
  )
  return buffer
}

test("default EPUB ingest policy exposes the operational limits", () => {
  assert.deepEqual(DEFAULT_EPUB_INGEST_POLICY, {
    maxRequestBytes: 51 * 1024 * 1024,
    maxEpubBytes: 50 * 1024 * 1024,
    maxZipEntries: 5_000,
    maxEntryUncompressedBytes: 16 * 1024 * 1024,
    maxTotalUncompressedBytes: 256 * 1024 * 1024,
    maxCompressionRatio: 100,
  })
})

test("production without an admin token fails closed", () => {
  assert.throws(
    () => authorizeEpubIngestRequest(new Request("http://local/api/epub"), {
      production: true,
      adminToken: undefined,
    }),
    matchesGuardError(503, "ingest_not_configured"),
  )
})

test("a present short token fails closed in every environment", () => {
  for (const production of [false, true]) {
    assert.throws(
      () => authorizeEpubIngestRequest(new Request("http://local/api/epub"), {
        production,
        adminToken: "too-short",
      }),
      matchesGuardError(503, "ingest_not_configured"),
    )
  }
})

test("development without an admin token bypasses authentication", () => {
  assert.doesNotThrow(() => authorizeEpubIngestRequest(
    new Request("http://local/api/epub"),
    { production: false, adminToken: undefined },
  ))
})

test("production accepts an exact 32-byte bearer credential", () => {
  const adminToken = "a".repeat(32)
  const request = new Request("http://local/api/epub", {
    headers: { authorization: `Bearer ${adminToken}` },
  })

  assert.doesNotThrow(() => authorizeEpubIngestRequest(request, {
    production: true,
    adminToken,
  }))
})

test("configured development accepts the exact bearer credential", () => {
  const adminToken = "d".repeat(32)
  const request = new Request("http://local/api/epub", {
    headers: { authorization: `Bearer ${adminToken}` },
  })

  assert.doesNotThrow(() => authorizeEpubIngestRequest(request, {
    production: false,
    adminToken,
  }))
})

test("configured development rejects a missing bearer credential", () => {
  assert.throws(
    () => authorizeEpubIngestRequest(new Request("http://local/api/epub"), {
      production: false,
      adminToken: "d".repeat(32),
    }),
    matchesGuardError(401, "unauthorized", {
      "www-authenticate": "Bearer",
    }),
  )
})

test("missing and wrong bearer credentials return a generic challenge", () => {
  const adminToken = "a".repeat(32)
  const requests = [
    new Request("http://local/api/epub"),
    new Request("http://local/api/epub", {
      headers: { authorization: "Bearer wrong-value" },
    }),
    new Request("http://local/api/epub", {
      headers: { authorization: `bearer ${adminToken}` },
    }),
  ]

  for (const request of requests) {
    assert.throws(
      () => authorizeEpubIngestRequest(request, {
        production: true,
        adminToken,
      }),
      matchesGuardError(401, "unauthorized", {
        "www-authenticate": "Bearer",
      }),
    )
  }
})

test("admin token minimum length is measured in UTF-8 bytes", () => {
  const adminToken = "é".repeat(16)
  assert.equal(Buffer.byteLength(adminToken, "utf8"), 32)

  const request = new Request("http://local/api/epub", {
    headers: { authorization: `Bearer ${adminToken}` },
  })
  assert.doesNotThrow(() => authorizeEpubIngestRequest(request, {
    production: true,
    adminToken,
  }))
})

test("a missing Content-Length is allowed", () => {
  assert.doesNotThrow(() => validateDeclaredRequestSize(
    new Request("http://local/api/epub"),
    SMALL_POLICY.maxRequestBytes,
  ))
})

test("a declared request exactly at the limit is allowed", () => {
  const request = new Request("http://local/api/epub", {
    headers: { "content-length": String(SMALL_POLICY.maxRequestBytes) },
  })

  assert.doesNotThrow(() => validateDeclaredRequestSize(
    request,
    SMALL_POLICY.maxRequestBytes,
  ))
})

test("non-decimal or negative Content-Length values are rejected", () => {
  for (const value of ["", "1.5", "+1", "1e2", "-1", "0x10"]) {
    const request = new Request("http://local/api/epub", {
      headers: { "content-length": value },
    })

    assert.throws(
      () => validateDeclaredRequestSize(request, SMALL_POLICY.maxRequestBytes),
      matchesGuardError(400, "invalid_content_length"),
    )
  }
})

test("a very large decimal Content-Length is classified as request too large", () => {
  const request = new Request("http://local/api/epub", {
    headers: { "content-length": "9".repeat(128) },
  })

  assert.throws(
    () => validateDeclaredRequestSize(request, SMALL_POLICY.maxRequestBytes),
    matchesGuardError(413, "request_too_large"),
  )
})

test("an oversized declared request is rejected", () => {
  const request = new Request("http://local/api/epub", {
    headers: { "content-length": String(SMALL_POLICY.maxRequestBytes + 1) },
  })

  assert.throws(
    () => validateDeclaredRequestSize(request, SMALL_POLICY.maxRequestBytes),
    matchesGuardError(413, "request_too_large"),
  )
})

test("bounded body reading accepts and joins chunks at the exact boundary", async () => {
  const request = new Request("http://local/api/epub", {
    method: "POST",
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([1, 2, 3, 4, 5]))
        controller.enqueue(Uint8Array.from([6, 7, 8, 9, 10, 11, 12]))
        controller.close()
      },
    }),
    duplex: "half",
  } as RequestInit & { duplex: "half" })

  const body = await readBoundedRequestBody(request, SMALL_POLICY.maxRequestBytes)

  assert.deepEqual(body, Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))
})

test("bounded body reading returns an empty array when the body is absent", async () => {
  const body = await readBoundedRequestBody(
    new Request("http://local/api/epub"),
    SMALL_POLICY.maxRequestBytes,
  )

  assert.equal(body.byteLength, 0)
})

test("bounded body reading cancels dishonest chunked requests on overflow", async () => {
  let canceled = false
  const request = new Request("http://local/api/epub", {
    method: "POST",
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8))
        controller.enqueue(new Uint8Array(8))
      },
      cancel() {
        canceled = true
      },
    }),
    duplex: "half",
  } as RequestInit & { duplex: "half" })

  await assert.rejects(
    readBoundedRequestBody(request, SMALL_POLICY.maxRequestBytes),
    matchesGuardError(413, "request_too_large"),
  )
  assert.equal(canceled, true)
})

test("a cancellation failure does not replace the request-too-large error", async () => {
  const request = new Request("http://local/api/epub", {
    method: "POST",
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(SMALL_POLICY.maxRequestBytes + 1))
      },
      cancel() {
        throw new Error("cancel failed")
      },
    }),
    duplex: "half",
  } as RequestInit & { duplex: "half" })

  await assert.rejects(
    readBoundedRequestBody(request, SMALL_POLICY.maxRequestBytes),
    matchesGuardError(413, "request_too_large"),
  )
})

test("the concurrency gate rejects acquisition while its only slot is held", () => {
  const gate = new IngestConcurrencyGate()
  const release = gate.tryAcquire()

  assert.equal(typeof release, "function")
  assert.equal(gate.tryAcquire(), undefined)

  release?.()
  const nextRelease = gate.tryAcquire()
  assert.equal(typeof nextRelease, "function")
  nextRelease?.()
})

test("a concurrency slot release is idempotent", () => {
  const gate = new IngestConcurrencyGate()
  const release = gate.tryAcquire()
  assert.equal(typeof release, "function")

  release?.()
  release?.()

  const secondRelease = gate.tryAcquire()
  assert.equal(typeof secondRelease, "function")
  assert.equal(gate.tryAcquire(), undefined)
  secondRelease?.()
})

test("archive preflight accepts the synthetic EPUB and reports declared totals", async () => {
  const buffer = await buildSyntheticEpub()

  const summary = validateEpubArchive(buffer)

  assert.ok(summary.entryCount > 2)
  assert.ok(summary.totalCompressedBytes > 20)
  assert.ok(summary.totalUncompressedBytes >= summary.totalCompressedBytes)
})

test("archive preflight rejects non-ZIP bytes without leaking parser details", () => {
  assert.throws(
    () => validateEpubArchive(Buffer.from("not a ZIP archive")),
    (error: unknown) => matchesGuardError(422, "invalid_epub")(error) &&
      error instanceof EpubIngestGuardError && error.message === "Invalid EPUB archive",
  )
})

test("archive preflight requires exactly one root mimetype entry", async () => {
  const omitted = await buildSyntheticEpub({ omitMimetype: true })
  const duplicated = duplicateZipEntry(await buildSyntheticEpub(), "mimetype")

  for (const buffer of [omitted, duplicated]) {
    assert.throws(
      () => validateEpubArchive(buffer),
      matchesGuardError(422, "invalid_epub"),
    )
  }
})

test("archive preflight requires exactly one META-INF/container.xml entry", async () => {
  const omitted = await buildSyntheticEpub({ omitContainer: true })
  const duplicated = duplicateZipEntry(
    await buildSyntheticEpub(),
    "META-INF/container.xml",
  )

  for (const buffer of [omitted, duplicated]) {
    assert.throws(
      () => validateEpubArchive(buffer),
      matchesGuardError(422, "invalid_epub"),
    )
  }
})

test("archive preflight requires byte-exact 20-byte mimetype content", async () => {
  const wrongBytes = await buildSyntheticEpub({
    extraEntries: [{
      path: "mimetype",
      content: "application/epub+zix",
      compression: "STORE",
    }],
  })
  const wrongLength = await buildSyntheticEpub({
    extraEntries: [{
      path: "mimetype",
      content: "application/epub+zip!",
      compression: "STORE",
    }],
  })

  for (const buffer of [wrongBytes, wrongLength]) {
    assert.throws(
      () => validateEpubArchive(buffer),
      matchesGuardError(422, "invalid_epub"),
    )
  }
})

test("archive preflight requires STORE compression for mimetype", async () => {
  const buffer = await buildSyntheticEpub({
    extraEntries: [{
      path: "mimetype",
      content: "application/epub+zip",
      compression: "DEFLATE",
    }],
  })

  assert.throws(
    () => validateEpubArchive(buffer),
    matchesGuardError(422, "invalid_epub"),
  )
})

test("archive preflight rejects traversal, empty, and dot path segments", async () => {
  for (const path of [
    "OEBPS/../escape.txt",
    "OEBPS//empty.txt",
    "OEBPS/./dot.txt",
  ]) {
    const buffer = await buildSyntheticEpub({
      extraEntries: [{ path, content: "unsafe" }],
    })

    assert.throws(
      () => validateEpubArchive(buffer),
      matchesGuardError(422, "invalid_epub"),
    )
  }
})

test("archive preflight rejects absolute, drive-prefixed, backslash, and NUL paths", async () => {
  for (const path of [
    "/absolute.txt",
    "//server/share.txt",
    "C:/drive.txt",
    "OEBPS\\backslash.txt",
    "OEBPS/nul\0suffix.txt",
  ]) {
    const buffer = await buildSyntheticEpub({
      extraEntries: [{ path, content: "unsafe" }],
    })

    assert.throws(
      () => validateEpubArchive(buffer),
      (error: unknown) => matchesGuardError(422, "invalid_epub")(error) &&
        error instanceof EpubIngestGuardError && !error.message.includes(path),
    )
  }
})

test("archive preflight rejects duplicate paths and file-directory aliases", async () => {
  const exactDuplicate = duplicateZipEntry(
    await buildSyntheticEpub(),
    "OEBPS/content.opf",
  )
  const fileDirectoryAlias = await buildSyntheticEpub({
    extraEntries: [
      { path: "OEBPS/alias", content: "file", compression: "STORE" },
      { path: "OEBPS/alias/", content: "", compression: "STORE" },
    ],
  })

  for (const buffer of [exactDuplicate, fileDirectoryAlias]) {
    assert.throws(
      () => validateEpubArchive(buffer),
      matchesGuardError(422, "invalid_epub"),
    )
  }
})

test("archive duplicate keys remain case-sensitive", async () => {
  const buffer = await buildSyntheticEpub({
    extraEntries: [
      { path: "OEBPS/Case.txt", content: "upper", compression: "STORE" },
      { path: "OEBPS/case.txt", content: "lower", compression: "STORE" },
    ],
  })

  assert.doesNotThrow(() => validateEpubArchive(buffer))
})

test("archive preflight rejects encrypted entries", async () => {
  const source = await buildSyntheticEpub()
  const target = requireCentralDirectoryEntry(source, "OEBPS/content.opf")
  const encrypted = patchEntryMetadata(source, target.name, { flags: 0x0001 })

  assert.throws(
    () => validateEpubArchive(encrypted),
    matchesGuardError(422, "invalid_epub"),
  )
})

test("archive preflight rejects unsupported compression methods", async () => {
  const buffer = patchEntryMetadata(
    await buildSyntheticEpub(),
    "OEBPS/content.opf",
    { method: 99 },
  )

  assert.throws(
    () => validateEpubArchive(buffer),
    matchesGuardError(422, "invalid_epub"),
  )
})

test("archive preflight rejects mismatched STORE sizes", async () => {
  const source = await buildSyntheticEpub({
    extraEntries: [{
      path: "OEBPS/stored.txt",
      content: "stored payload",
      compression: "STORE",
    }],
  })
  const buffer = patchEntryMetadata(source, "OEBPS/stored.txt", {
    uncompressedSize: 1,
  })

  assert.throws(
    () => validateEpubArchive(buffer),
    matchesGuardError(422, "invalid_epub"),
  )
})

test("archive preflight rejects non-empty DEFLATE payloads declaring zero output", async () => {
  const buffer = patchEntryMetadata(
    await buildSyntheticEpub(),
    "OEBPS/content.opf",
    { uncompressedSize: 0 },
  )

  assert.throws(
    () => validateEpubArchive(buffer),
    matchesGuardError(422, "invalid_epub"),
  )
})

test("archive preflight rejects ZIP64 per-entry metadata", async () => {
  const buffer = addCentralDirectoryExtraField(
    await buildSyntheticEpub(),
    "OEBPS/content.opf",
    0x0001,
    Buffer.alloc(8),
  )

  assert.throws(
    () => validateEpubArchive(buffer),
    matchesGuardError(422, "invalid_epub"),
  )
})

test("archive preflight enforces the entry-count budget", async () => {
  const buffer = await buildSyntheticEpub()

  assert.throws(
    () => validateEpubArchive(buffer, {
      ...DEFAULT_EPUB_INGEST_POLICY,
      maxZipEntries: 1,
    }),
    matchesGuardError(413, "epub_resource_limit"),
  )
})

test("archive preflight enforces the per-entry declared output budget", async () => {
  const buffer = await buildSyntheticEpub({ chapters: [], extraEntries: [{
    path: "OEBPS/large.txt",
    content: "x".repeat(2_048),
    compression: "STORE",
  }] })

  assert.throws(
    () => validateEpubArchive(buffer, {
      ...DEFAULT_EPUB_INGEST_POLICY,
      maxEntryUncompressedBytes: 1_024,
    }),
    matchesGuardError(413, "epub_resource_limit"),
  )
})

test("archive preflight enforces the aggregate declared output budget", async () => {
  const buffer = await buildSyntheticEpub({ chapters: [] })

  assert.throws(
    () => validateEpubArchive(buffer, {
      ...DEFAULT_EPUB_INGEST_POLICY,
      maxTotalUncompressedBytes: 1,
    }),
    matchesGuardError(413, "epub_resource_limit"),
  )
})

test("archive preflight rejects excessive compression before mimetype extraction", async () => {
  const buffer = await buildSyntheticEpub({
    extraEntries: [
      {
        path: "mimetype",
        content: "application/epub+zix",
        compression: "STORE",
      },
      {
        path: "OEBPS/repeated.txt",
        content: "x".repeat(4_096),
        compression: "DEFLATE",
      },
    ],
  })

  assert.throws(
    () => validateEpubArchive(buffer, {
      ...DEFAULT_EPUB_INGEST_POLICY,
      maxCompressionRatio: 2,
    }),
    matchesGuardError(413, "epub_resource_limit"),
  )
})

test("archive preflight treats non-empty output from zero compressed bytes as excessive", async () => {
  const source = await buildSyntheticEpub({ chapters: [] })
  const buffer = patchEntryMetadata(source, "OEBPS/content.opf", {
    compressedSize: 0,
    uncompressedSize: 1,
  })

  assert.throws(
    () => validateEpubArchive(buffer),
    matchesGuardError(413, "epub_resource_limit"),
  )
})
