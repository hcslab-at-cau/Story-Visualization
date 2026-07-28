import assert from "node:assert/strict"
import test from "node:test"
import {
  DEFAULT_EPUB_INGEST_POLICY,
  EpubIngestGuardError,
  IngestConcurrencyGate,
  authorizeEpubIngestRequest,
  readBoundedRequestBody,
  validateDeclaredRequestSize,
  type EpubIngestPolicy,
} from "../src/lib/server/epub-ingest-guard.ts"

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
