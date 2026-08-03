import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { gzipSync } from "node:zlib"

import {
  decodeV3SemanticVectorBlob,
  prepareV3SemanticVectorUpload,
  V3SemanticVectorIntegrityError,
} from "../src/lib/storage.ts"
import { V3_SEMANTIC_VECTOR_VERSION } from "../src/lib/pipeline/v3-semantic-index-types.ts"

function vectorPayload(embedding: number[]) {
  return {
    artifact_version: V3_SEMANTIC_VECTOR_VERSION,
    model: "openai/text-embedding-3-small",
    dimensions: embedding.length,
    source_text_fingerprint: "fingerprint",
    vectors: [{ text_doc_id: "TEXT_EV1", embedding }],
  }
}

test("semantic vector uploads use deterministic content-addressed paths without storage I/O", () => {
  const input = {
    docId: "doc",
    chapterId: "ch01",
    runId: "run-1",
    source: "v3" as const,
  }
  const first = prepareV3SemanticVectorUpload({ ...input, payload: vectorPayload([1, 0]) })
  const same = prepareV3SemanticVectorUpload({ ...input, payload: vectorPayload([1, 0]) })
  const different = prepareV3SemanticVectorUpload({ ...input, payload: vectorPayload([0, 1]) })

  assert.equal(first.hash, same.hash)
  assert.equal(first.fileName, same.fileName)
  assert.equal(first.storagePath, same.storagePath)
  assert.deepEqual(first.buffer, same.buffer)
  assert.notEqual(first.hash, different.hash)
  assert.notEqual(first.storagePath, different.storagePath)
  assert.equal(first.fileName, `${first.hash}.vectors.json.gz`)
  assert.equal(
    first.storagePath,
    `documents_v3/doc/chapters/ch01/runs/run-1/indexes/idx2/${first.hash}.vectors.json.gz`,
  )
})

test("semantic vector decoding classifies malformed gzip and JSON as integrity failures", () => {
  const malformedGzip = Buffer.from("not-gzip", "utf8")
  const malformedJson = gzipSync(Buffer.from("{not-json", "utf8"))
  const hash = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex")

  assert.throws(
    () => decodeV3SemanticVectorBlob(malformedJson, "wrong-content-hash"),
    (error) => error instanceof V3SemanticVectorIntegrityError && /hash/i.test(error.message),
  )
  assert.throws(
    () => decodeV3SemanticVectorBlob(malformedGzip, hash(malformedGzip)),
    (error) => error instanceof V3SemanticVectorIntegrityError && /gzip/i.test(error.message),
  )
  assert.throws(
    () => decodeV3SemanticVectorBlob(malformedJson, hash(malformedJson)),
    (error) => error instanceof V3SemanticVectorIntegrityError && /JSON/i.test(error.message),
  )
})
