import assert from "node:assert/strict"
import test from "node:test"
import {
  EpubIngestGuardError,
  type EpubIngestPolicy,
} from "../src/lib/server/epub-ingest-guard.ts"
import type {
  CorpusImportDependencies,
  CorpusImportInput,
  CorpusImportResult,
} from "../src/lib/corpus-import.ts"
import { EpubParseLimitError } from "../src/lib/epub.ts"
import {
  createEpubPostHandler,
  maxDuration,
  runtime,
} from "../src/app/api/epub/route.ts"

const ADMIN_TOKEN = "a".repeat(32)
const SMALL_POLICY: EpubIngestPolicy = {
  maxRequestBytes: 2_048,
  maxEpubBytes: 8,
  maxZipEntries: 8,
  maxEntryUncompressedBytes: 64,
  maxTotalUncompressedBytes: 128,
  maxCompressionRatio: 4,
}

interface GateState {
  active: boolean
  acquired: number
  released: number
}

const tinyFakeResult: CorpusImportResult = {
  docId: "doc-1",
  chapters: [],
  sourceFile: {
    bucket: "fake-bucket",
    storagePath: "corpus_revisions/doc-1/source.epub",
    fileName: "novel.epub",
    contentType: "application/epub+zip",
    sizeBytes: 32,
    gsUri: "gs://fake-bucket/corpus_revisions/doc-1/source.epub",
  },
  sourceSha256: "0".repeat(64),
  bookId: "book-1",
  corpusRevisionId: "cr_v1_0000000000000000000000000000000000000000000000000000000000000000",
  reused: false,
}

function makeStream(
  chunks: Uint8Array[],
  pullLog: { count: number },
  highWaterMark = 1,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pullLog.count += 1
        const next = chunks.shift()
        if (next === undefined) {
          controller.close()
          return
        }
        controller.enqueue(next)
      },
    },
    { highWaterMark },
  )
}

function formRequest(formData: FormData, token: string | undefined = ADMIN_TOKEN): Request {
  const headers: Record<string, string> = {}
  if (token !== undefined) headers.authorization = `Bearer ${token}`
  return new Request("http://localhost/api/epub", {
    method: "POST",
    headers,
    body: formData,
  })
}

function streamRequest(
  stream: ReadableStream<Uint8Array>,
  contentType: string,
  token: string | null = ADMIN_TOKEN,
  extraHeaders: Record<string, string> = {},
): Request {
  const headers: Record<string, string> = {
    ...extraHeaders,
    "content-type": contentType,
  }
  if (token !== null) headers.authorization = `Bearer ${token}`

  const init: RequestInit & { duplex: "half" } = {
    method: "POST",
    headers,
    body: stream,
    duplex: "half",
  }
  return new Request("http://localhost/api/epub", init)
}

function makeGateState(): GateState {
  return { active: false, acquired: 0, released: 0 }
}

function makeGate(state: GateState): { tryAcquire: () => (() => void) | undefined } {
  return {
    tryAcquire: () => {
      if (state.active) return undefined
      state.active = true
      state.acquired += 1
      let released = false
      return () => {
        if (released) return
        released = true
        state.active = false
        state.released += 1
      }
    },
  }
}

type HandlerOverrides = NonNullable<Parameters<typeof createEpubPostHandler>[0]>

function makeHandler(overrides: HandlerOverrides = {}) {
  const counters = {
    importDependencies: 0,
    parseMultipart: 0,
    readFileBytes: 0,
    validateArchive: 0,
    importCorpus: 0,
  }

  const handler = createEpubPostHandler({
    runtimeConfig: () => ({ production: true, adminToken: ADMIN_TOKEN }),
    policy: SMALL_POLICY,
    gate: makeGate({ active: false, acquired: 0, released: 0 }) as HandlerOverrides["gate"],
    parseMultipart: async (body: Uint8Array, request: Request) => {
      counters.parseMultipart += 1
      return new Request(request.url, {
        method: "POST",
        headers: { "content-type": request.headers.get("content-type") ?? "" },
        body: body as BodyInit,
      }).formData()
    },
    readFileBytes: async (file: File) => {
      counters.readFileBytes += 1
      return Buffer.from(await file.arrayBuffer())
    },
    validateArchive: (buffer: Buffer) => {
      counters.validateArchive += 1
      return {
        entryCount: 1,
        totalCompressedBytes: buffer.byteLength,
        totalUncompressedBytes: buffer.byteLength,
      }
    },
    importCorpus: async () => {
      counters.importCorpus += 1
      return tinyFakeResult
    },
    importDependencies: () => {
      counters.importDependencies += 1
      return {
        repository: {},
        blobStore: {},
        parseEpub: () => Promise.resolve([]),
        now: () => new Date(),
        createClaimToken: () => "claim-token",
      } as unknown as CorpusImportDependencies
    },
    ...overrides,
  })

  return { handler, counters }
}

function badGuardError(statusCode: number, code: string): EpubIngestGuardError {
  return new EpubIngestGuardError(statusCode, code, code)
}

test("EPUB route keeps node runtime and extended handler timeout", () => {
  assert.equal(runtime, "nodejs")
  assert.equal(maxDuration, 120)
})

test("production guard failures leave request.bodyUsed false and do not initialize dependencies", async () => {
  const pullLog = { count: 0 }
  const misconfigured = makeHandler({
    runtimeConfig: () => ({ production: true }),
  })
  const configured = makeHandler({
    runtimeConfig: () => ({ production: true, adminToken: ADMIN_TOKEN }),
  })
  const missingConfigRequest = streamRequest(
    makeStream([new TextEncoder().encode("chunk")], pullLog, 0),
    "multipart/form-data; boundary=production-missing",
    ADMIN_TOKEN,
  )
  const missingAuthRequest = streamRequest(
    makeStream([new TextEncoder().encode("chunk")], pullLog, 0),
    "multipart/form-data; boundary=production-missing-auth",
    null,
  )

  const wrongAuthRequest = streamRequest(
    makeStream([new TextEncoder().encode("chunk")], pullLog, 0),
    "multipart/form-data; boundary=production-wrong-auth",
    "wrong-token",
  )

  const missingConfig = await misconfigured.handler(missingConfigRequest)
  assert.equal(missingConfig.status, 503)
  assert.deepEqual(await missingConfig.json(), {
    error: "EPUB ingest is not configured",
    code: "ingest_not_configured",
  })
  assert.equal(missingConfigRequest.bodyUsed, false)

  const wrongConfig = await configured.handler(missingAuthRequest)
  assert.equal(wrongConfig.status, 401)
  assert.deepEqual(await wrongConfig.json(), {
    error: "Unauthorized",
    code: "unauthorized",
  })
  assert.equal(wrongConfig.headers.get("WWW-Authenticate"), "Bearer")
  assert.equal(missingAuthRequest.bodyUsed, false)

  const wrongToken = await configured.handler(wrongAuthRequest)
  assert.equal(wrongToken.status, 401)
  assert.deepEqual(await wrongToken.json(), {
    error: "Unauthorized",
    code: "unauthorized",
  })
  assert.equal(wrongToken.headers.get("WWW-Authenticate"), "Bearer")
  assert.equal(wrongAuthRequest.bodyUsed, false)

  assert.equal(misconfigured.counters.importDependencies, 0)
  assert.equal(configured.counters.importDependencies, 0)
  assert.equal(pullLog.count, 0)
})

test("invalid content-type and Content-Length validation occur before request parse and dependency init", async () => {
  const badLengthPulls = { count: 0 }
  const oversizeLengthPulls = { count: 0 }
  const wrongContentTypePulls = { count: 0 }
  const badLengthRequest = streamRequest(
    makeStream([new TextEncoder().encode("chunk")], badLengthPulls, 0),
    "multipart/form-data; boundary=invalid-length",
    ADMIN_TOKEN,
    { "content-length": "not-a-number" },
  )
  const oversizeLengthRequest = streamRequest(
    makeStream([new TextEncoder().encode("payload")], oversizeLengthPulls, 0),
    "multipart/form-data; boundary=oversized-length",
    ADMIN_TOKEN,
    { "content-length": String(SMALL_POLICY.maxRequestBytes + 1) },
  )
  const wrongContentTypeRequest = streamRequest(
    makeStream([new TextEncoder().encode("payload")], wrongContentTypePulls, 0),
    "text/plain",
    ADMIN_TOKEN,
  )

  const { handler, counters } = makeHandler({
    runtimeConfig: () => ({ production: true, adminToken: ADMIN_TOKEN }),
  })

  const invalidLength = await handler(badLengthRequest)
  assert.equal(invalidLength.status, 400)
  assert.deepEqual(await invalidLength.json(), {
    error: "Content-Length must be a non-negative decimal integer",
    code: "invalid_content_length",
  })
  assert.equal(badLengthPulls.count, 0)

  const oversizedLength = await handler(oversizeLengthRequest)
  assert.equal(oversizedLength.status, 413)
  assert.deepEqual(await oversizedLength.json(), {
    error: "Request body exceeds the configured size limit",
    code: "request_too_large",
  })
  assert.equal(oversizeLengthPulls.count, 0)

  const invalidContentType = await handler(wrongContentTypeRequest)
  assert.equal(invalidContentType.status, 415)
  assert.deepEqual(await invalidContentType.json(), {
    error: "Request is not multipart form data",
    code: "invalid_content_type",
  })
  assert.equal(wrongContentTypePulls.count, 0)
  assert.equal(counters.importDependencies, 0)
})

test("streamed multipart overflow is rejected before multipart parse", async () => {
  const pullLog = { count: 0 }
  const { handler, counters } = makeHandler({
    runtimeConfig: () => ({ production: true, adminToken: ADMIN_TOKEN }),
  })
  const overflowBody = makeStream(
    [new Uint8Array(1_024), new Uint8Array(1_025)],
    pullLog,
  )
  const request = streamRequest(overflowBody, "multipart/form-data; boundary=overflow", ADMIN_TOKEN)

  const response = await handler(request)
  assert.equal(response.status, 413)
  assert.deepEqual(await response.json(), {
    error: "Request body exceeds the configured size limit",
    code: "request_too_large",
  })
  assert.equal(counters.parseMultipart, 0)
  assert.equal(counters.readFileBytes, 0)
  assert.equal(counters.importDependencies, 0)
  assert.equal(request.bodyUsed, true)
  assert.equal(pullLog.count > 0, true)
})

test("malformed multipart is mapped before read/copy/archive/dependency init", async () => {
  const parseLog = { count: 0 }
  const { handler, counters } = makeHandler({
    runtimeConfig: () => ({ production: true, adminToken: ADMIN_TOKEN }),
    parseMultipart: async () => {
      parseLog.count += 1
      throw new Error("upstream multipart detail must not leak")
    },
  })
  const request = streamRequest(
    makeStream([new TextEncoder().encode("bad")], { count: 0 }, 0),
    "multipart/form-data; boundary=malformed",
    ADMIN_TOKEN,
  )

  const response = await handler(request)
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), {
    error: "Malformed multipart form data",
    code: "malformed_multipart",
  })
  assert.equal(parseLog.count, 1)
  assert.equal(counters.readFileBytes, 0)
  assert.equal(counters.validateArchive, 0)
  assert.equal(counters.importDependencies, 0)
})

test("missing or non-File upload returns missing_file", async () => {
  const { handler, counters } = makeHandler({
    runtimeConfig: () => ({ production: true, adminToken: ADMIN_TOKEN }),
  })
  const missing = new FormData()
  const nonFile = new FormData()
  nonFile.set("file", "not-an-epub-file")

  for (const form of [missing, nonFile]) {
    const response = await handler(formRequest(form, ADMIN_TOKEN))
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), {
      error: "No file provided",
      code: "missing_file",
    })
  }
  assert.equal(counters.readFileBytes, 0)
  assert.equal(counters.validateArchive, 0)
  assert.equal(counters.importDependencies, 0)
})

test("oversize File is rejected before readFileBytes/validateArchive/importDependencies", async () => {
  const hugeContent = new Uint8Array(24)
  const { handler, counters } = makeHandler({
    runtimeConfig: () => ({ production: true, adminToken: ADMIN_TOKEN }),
    policy: { ...SMALL_POLICY, maxEpubBytes: 8 },
  })
  const form = new FormData()
  form.set("file", new File([hugeContent], "novel.epub", { type: "application/epub+zip" }))
  const request = formRequest(form, ADMIN_TOKEN)

  const response = await handler(request)
  assert.equal(response.status, 413)
  assert.deepEqual(await response.json(), {
    error: "Uploaded EPUB exceeds the configured resource limit",
    code: "epub_too_large",
  })
  assert.equal(counters.readFileBytes, 0)
  assert.equal(counters.validateArchive, 0)
  assert.equal(counters.importDependencies, 0)
})

test("invalid bookId fails with canonical code before copy/archive/dependency init", async () => {
  const { handler, counters } = makeHandler({
    runtimeConfig: () => ({ production: true, adminToken: ADMIN_TOKEN }),
    importDependencies: () => {
      throw new Error("should not be called")
    },
  })

  const form = new FormData()
  form.set("file", new File(["content"], "novel.epub", { type: "application/epub+zip" }))
  form.set("bookId", "invalid book id")
  const request = formRequest(form, ADMIN_TOKEN)

  const response = await handler(request)
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), {
    error: "bookId must match ^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$",
    code: "invalid_book_id",
  })
  assert.equal(counters.readFileBytes, 0)
  assert.equal(counters.validateArchive, 0)
  assert.equal(counters.importDependencies, 0)
})

test("invalid archive is rejected with invalid_epub before dependency init", async () => {
  const { handler, counters } = makeHandler({
    runtimeConfig: () => ({ production: true, adminToken: ADMIN_TOKEN }),
    validateArchive: () => {
      counters.validateArchive += 1
      throw badGuardError(422, "invalid_epub")
    },
    importDependencies: () => {
      throw new Error("should not be called")
    },
  })
  const form = new FormData()
  form.set("file", new File(["not zip"], "novel.epub", { type: "application/epub+zip" }))
  const request = formRequest(form, ADMIN_TOKEN)

  const response = await handler(request)
  assert.equal(response.status, 422)
  assert.deepEqual(await response.json(), {
    error: "invalid_epub",
    code: "invalid_epub",
 })
  assert.equal(counters.readFileBytes, 1)
  assert.equal(counters.validateArchive, 1)
  assert.equal(counters.importDependencies, 0)
})

test("EpubParseLimitError maps to 413 epub_resource_limit", async () => {
  const { handler, counters } = makeHandler({
    runtimeConfig: () => ({ production: true, adminToken: ADMIN_TOKEN }),
    importCorpus: async () => {
      counters.importCorpus += 1
      throw new EpubParseLimitError("chapters")
    },
  })
  const form = new FormData()
  form.set("file", new File(["content"], "novel.epub", { type: "application/epub+zip" }))
  const request = formRequest(form, ADMIN_TOKEN)

  const response = await handler(request)
  assert.equal(response.status, 413)
  assert.deepEqual(await response.json(), {
    error: "EPUB content exceeds the configured resource budget",
    code: "epub_resource_limit",
  })
  assert.equal(counters.importCorpus, 1)
})

test("held gate returns 429 and does not consume highWaterMark:0 stream; released gate allows next request", async () => {
  const gateState = makeGateState()
  const gate = makeGate(gateState)
  let unblock = () => {}
  const unblocks = new Promise<void>((resolve) => { unblock = resolve })
  let markStarted = () => {}
  const started = new Promise<void>((resolve) => { markStarted = resolve })
  let importCalls = 0

  const handlerState = makeHandler({
    runtimeConfig: () => ({ production: true, adminToken: ADMIN_TOKEN }),
    gate: gate as HandlerOverrides["gate"],
    importCorpus: async () => {
      importCalls += 1
      markStarted()
      if (importCalls === 1) await unblocks
      return tinyFakeResult
    },
  })

  const firstBody = new FormData()
  firstBody.set("file", new File(["content"], "novel.epub", { type: "application/epub+zip" }))
  const first = handlerState.handler(formRequest(firstBody, ADMIN_TOKEN))

  await started

  const pullLog = { count: 0 }
  const secondBody = makeStream([new TextEncoder().encode("second")], pullLog, 0)
  const secondRequest = streamRequest(
    secondBody,
    "multipart/form-data; boundary=held",
    ADMIN_TOKEN,
  )
  const second = await handlerState.handler(secondRequest)
  assert.equal(second.status, 429)
  assert.deepEqual(await second.json(), {
    error: "EPUB import is already in progress",
    code: "ingest_busy",
  })
  assert.equal(second.headers.get("Retry-After"), "5")
  assert.equal(secondRequest.bodyUsed, false)
  assert.equal(pullLog.count, 0)

  unblock()
  const firstResponse = await first
  assert.equal(firstResponse.status, 200)

  const thirdRequest = formRequest(firstBody, ADMIN_TOKEN)
  const thirdResponse = await handlerState.handler(thirdRequest)
  assert.equal(thirdResponse.status, 200)
  assert.equal(gateState.acquired, 2)
  assert.equal(gateState.released, 2)
  assert.equal(secondRequest.bodyUsed, false)
})

test("import failure still releases the gate", async () => {
  const gateState = makeGateState()
  const gate = makeGate(gateState)
  let importCalls = 0
  const handlerState = makeHandler({
    runtimeConfig: () => ({ production: true, adminToken: ADMIN_TOKEN }),
    gate: gate as HandlerOverrides["gate"],
    importCorpus: async () => {
      importCalls += 1
      if (importCalls === 1) throw new Error("forced failure")
      return tinyFakeResult
    },
  })

  const requestForm = new FormData()
  requestForm.set("file", new File(["content"], "novel.epub", { type: "application/epub+zip" }))
  const first = await handlerState.handler(formRequest(requestForm, ADMIN_TOKEN))
  assert.equal(first.status, 500)
  assert.equal(gateState.active, false)
  assert.equal(gateState.released, 1)

  const second = await handlerState.handler(formRequest(requestForm, ADMIN_TOKEN))
  assert.equal(second.status, 200)
  assert.equal(gateState.released, 2)
  assert.equal(gateState.acquired, 2)
})

test("authorized injected handler returns exactly six response fields", async () => {
  const importedInputs: CorpusImportInput[] = []
  const { handler } = makeHandler({
    runtimeConfig: () => ({ production: true, adminToken: ADMIN_TOKEN }),
    importCorpus: async (input) => {
      importedInputs.push(input)
      return tinyFakeResult
    },
  })
  const form = new FormData()
  form.set("file", new File(["content"], "novel.epub", { type: "text/html" }))
  form.set("title", "Synthetic")
  form.set("source", "current")
  form.set("bookId", "book-1")
  const response = await handler(formRequest(form, ADMIN_TOKEN))

  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.deepEqual(Object.keys(payload).sort(), [
    "bookId",
    "chapters",
    "corpusRevisionId",
    "docId",
    "reused",
    "sourceFile",
  ].sort())
  assert.equal(payload.docId, tinyFakeResult.docId)
  assert.deepEqual(payload.chapters, tinyFakeResult.chapters)

  assert.equal(importedInputs.length, 1)
  const importedInput = importedInputs.at(0)
  assert.ok(importedInput)
  assert.equal(importedInput.buffer.toString("utf8"), "content")
  assert.equal(importedInput.fileName, "novel.epub")
  assert.equal(importedInput.contentType, "application/epub+zip")
  assert.equal(importedInput.title, "Synthetic")
  assert.equal(importedInput.bookId, "book-1")
  assert.equal(importedInput.source, "current")
})
