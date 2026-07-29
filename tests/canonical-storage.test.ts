import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { CorpusImportError } from "../src/lib/corpus-import.ts"
import { __testOnly } from "../src/lib/storage.ts"

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex")
}

type SaveOptions = {
  resumable?: boolean
  metadata?: {
    contentType?: string
    metadata?: Record<string, string>
  }
  preconditionOpts?: {
    ifGenerationMatch?: number
  }
}

class FakeFile {
  readonly path: string
  saveCalls: Array<{ buffer: Buffer; options: SaveOptions }> = []
  getMetadataCalls = 0
  downloadCalls = 0
  saveError: unknown = null
  metadataResponse: [Record<string, unknown>, unknown?] = [{}]
  downloadResponse: [Buffer] = [Buffer.alloc(0)]

  constructor(path: string) {
    this.path = path
  }

  async save(buffer: Buffer, options: SaveOptions): Promise<void> {
    this.saveCalls.push({ buffer, options })
    if (this.saveError !== null) throw this.saveError
  }

  async getMetadata(): Promise<[Record<string, unknown>, unknown?]> {
    this.getMetadataCalls += 1
    return this.metadataResponse
  }

  async download(): Promise<[Buffer]> {
    this.downloadCalls += 1
    return this.downloadResponse
  }
}

class FakeBucket {
  fileCalls = 0
  lastPath?: string
  readonly fileInstance?: FakeFile

  constructor(fileInstance?: FakeFile) {
    this.fileInstance = fileInstance
  }

  file(path: string): FakeFile {
    this.fileCalls += 1
    this.lastPath = path
    return this.fileInstance ?? new FakeFile(path)
  }
}

function createWriter(bucket: FakeBucket, transformedError = (error: unknown) => error instanceof Error ? error : new Error(String(error))) {
  return __testOnly.createPutCanonicalSourceEpub({
    bucketName: () => "fake-corpus-bucket",
    explainError: transformedError,
    getBucket: () => bucket,
  })
}

function validInput() {
  const buffer = Buffer.from("canonical epub bytes")
  const sourceSha256 = sha256(buffer)
  return {
    buffer,
    contentType: "application/epub+zip",
    corpusRevisionId: `cr_v1_${sourceSha256}`,
    fileName: "Original Name.epub",
    sourceSha256,
  }
}

test("putCanonicalSourceEpub writes the canonical object to a fixed path with create-only metadata", async () => {
  const input = validInput()
  const file = new FakeFile(`corpus_revisions/${input.corpusRevisionId}/source.epub`)
  const bucket = new FakeBucket(file)
  const putCanonicalSourceEpub = createWriter(bucket)

  const stored = await putCanonicalSourceEpub(input)

  assert.equal(bucket.fileCalls, 1)
  assert.equal(bucket.lastPath, `corpus_revisions/${input.corpusRevisionId}/source.epub`)
  assert.equal(file.saveCalls.length, 1)
  assert.deepEqual(file.saveCalls[0], {
    buffer: input.buffer,
    options: {
      metadata: {
        contentType: input.contentType,
        metadata: {
          originalFileName: input.fileName,
          sizeBytes: String(input.buffer.byteLength),
          sourceSha256: input.sourceSha256,
        },
      },
      preconditionOpts: { ifGenerationMatch: 0 },
      resumable: false,
    },
  })
  assert.deepEqual(stored, {
    bucket: "fake-corpus-bucket",
    contentType: input.contentType,
    fileName: input.fileName,
    gsUri: `gs://fake-corpus-bucket/corpus_revisions/${input.corpusRevisionId}/source.epub`,
    sizeBytes: input.buffer.byteLength,
    storagePath: `corpus_revisions/${input.corpusRevisionId}/source.epub`,
  })
})

test("putCanonicalSourceEpub reuses a matching 412 object and returns stored metadata when present", async () => {
  const input = validInput()
  const file = new FakeFile(`corpus_revisions/${input.corpusRevisionId}/source.epub`)
  file.saveError = { code: 412 }
  file.metadataResponse = [{
    contentType: "application/octet-stream",
    metadata: {
      originalFileName: "Stored Name.epub",
      sizeBytes: String(input.buffer.byteLength),
      sourceSha256: input.sourceSha256,
    },
  }]
  file.downloadResponse = [Buffer.from(input.buffer)]
  const putCanonicalSourceEpub = createWriter(new FakeBucket(file))

  const stored = await putCanonicalSourceEpub(input)

  assert.equal(file.getMetadataCalls, 1)
  assert.equal(file.downloadCalls, 1)
  assert.equal(stored.fileName, "Stored Name.epub")
  assert.equal(stored.contentType, "application/octet-stream")
})

test("putCanonicalSourceEpub rejects mismatched 412 metadata before reusing the object", async () => {
  const input = validInput()
  const file = new FakeFile(`corpus_revisions/${input.corpusRevisionId}/source.epub`)
  file.saveError = { code: 412 }
  file.metadataResponse = [{
    contentType: input.contentType,
    metadata: {
      originalFileName: input.fileName,
      sizeBytes: String(input.buffer.byteLength + 1),
      sourceSha256: input.sourceSha256,
    },
  }]
  const putCanonicalSourceEpub = createWriter(new FakeBucket(file))

  await assert.rejects(
    putCanonicalSourceEpub(input),
    (error: unknown) => error instanceof CorpusImportError &&
      error.statusCode === 409 &&
      error.code === "source_integrity_conflict",
  )
  assert.equal(file.downloadCalls, 0)
})

test("putCanonicalSourceEpub rejects 412 reuse when downloaded bytes do not match the claimed digest", async () => {
  const input = validInput()
  const file = new FakeFile(`corpus_revisions/${input.corpusRevisionId}/source.epub`)
  file.saveError = { code: 412 }
  file.metadataResponse = [{
    contentType: input.contentType,
    metadata: {
      originalFileName: input.fileName,
      sizeBytes: String(input.buffer.byteLength),
      sourceSha256: input.sourceSha256,
    },
  }]
  file.downloadResponse = [Buffer.from("tampered bytes")]
  const putCanonicalSourceEpub = createWriter(new FakeBucket(file))

  await assert.rejects(
    putCanonicalSourceEpub(input),
    (error: unknown) => error instanceof CorpusImportError &&
      error.statusCode === 409 &&
      error.code === "source_integrity_conflict",
  )
  assert.equal(file.downloadCalls, 1)
})

test("putCanonicalSourceEpub validates canonical identity before touching the bucket", async () => {
  const input = validInput()
  const bucket = new FakeBucket()
  const putCanonicalSourceEpub = createWriter(bucket)

  await assert.rejects(
    putCanonicalSourceEpub({
      ...input,
      corpusRevisionId: "cr_v1_invalid",
    }),
    /corpusRevisionId/,
  )
  await assert.rejects(
    putCanonicalSourceEpub({
      ...input,
      sourceSha256: "ABC",
    }),
    /sourceSha256/,
  )
  assert.equal(bucket.fileCalls, 0)
})

test("putCanonicalSourceEpub preserves the credential error context for non-412 failures", async () => {
  const input = validInput()
  const file = new FakeFile(`corpus_revisions/${input.corpusRevisionId}/source.epub`)
  file.saveError = new Error("raw storage failure")
  const transformed = new Error("wrapped storage failure")
  const putCanonicalSourceEpub = createWriter(
    new FakeBucket(file),
    () => transformed,
  )

  await assert.rejects(putCanonicalSourceEpub(input), transformed)
  assert.equal(file.getMetadataCalls, 0)
  assert.equal(file.downloadCalls, 0)
})
