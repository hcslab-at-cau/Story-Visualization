import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  DEFAULT_EPUB_PARSE_LIMITS,
  EpubParseError,
  EpubParseLimitError,
  parseEpub,
} from "../src/lib/epub.ts"
import { parseEpubInProcessForTesting } from "./helpers/in-process-epub-parser.ts"
import {
  DEFAULT_EPUB_INGEST_POLICY,
  validateEpubArchive,
} from "../src/lib/server/epub-ingest-guard.ts"
import type {
  EpubParserWorkerFactory,
  EpubParserWorkerHandle,
} from "../src/lib/server/epub-parser-worker.ts"
import { buildSyntheticEpub } from "./helpers/synthetic-epub.ts"

function workerTempDirectory(): string {
  return mkdtempSync(join(tmpdir(), "story-epub-worker-test-"))
}

function isInvalidEpub(error: unknown): boolean {
  return error instanceof EpubParseError && error.message === "Invalid EPUB archive"
}

class FailingWorker extends EventEmitter implements EpubParserWorkerHandle {
  constructor(mode: "invalid-message" | "abnormal-exit") {
    super()
    queueMicrotask(() => {
      if (mode === "invalid-message") this.emit("message", { type: "unexpected" })
      else this.emit("exit", 7)
    })
  }

  postMessage(): void {}

  async terminate(): Promise<number> {
    return 1
  }
}

function failingWorkerFactory(
  mode: "invalid-message" | "abnormal-exit",
): EpubParserWorkerFactory {
  return () => new FailingWorker(mode)
}

test("isolated parse preserves normalized output from the in-process reference", async () => {
  const buffer = await buildSyntheticEpub()
  const corpusRevisionId = `cr_v1_${"a".repeat(64)}`
  const context = {
    docId: corpusRevisionId,
    bookId: "book-worker-equivalence",
    corpusRevisionId,
  }
  const tempDirectory = workerTempDirectory()

  try {
    const isolated = await parseEpub(
      buffer,
      context,
      DEFAULT_EPUB_PARSE_LIMITS,
      { tempDirectory },
    )
    const reference = await parseEpubInProcessForTesting(
      buffer,
      context,
      DEFAULT_EPUB_PARSE_LIMITS,
    )

    assert.deepEqual(isolated, reference)
    assert.deepEqual(readdirSync(tempDirectory), [])
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true })
  }
})

test("isolated parse contains an epub2 callback crash and keeps the parent usable", async () => {
  const malformedContainer = await buildSyntheticEpub({
    extraEntries: [{
      path: "META-INF/container.xml",
      content: "not xml",
      compression: "DEFLATE",
    }],
  })
  const malformedChapterCallback = await buildSyntheticEpub({
    chapters: [{
      manifestId: "callback-crash",
      href: "Text/bad%href.xhtml",
      title: "Callback Crash",
      bodyParagraphs: ["This safe synthetic prose is replaced below."],
    }],
    extraEntries: [{
      path: "OEBPS/Text/bad%href.xhtml",
      content: `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body>
  <h1>Callback Crash</h1>
  <img src="image.png" />
  <p>This malformed URI fixture exercises an asynchronous chapter callback.</p>
</body></html>`,
      compression: "DEFLATE",
    }],
  })
  const valid = await buildSyntheticEpub({ editionLabel: "worker-recovery" })
  const tempDirectory = workerTempDirectory()

  try {
    for (const [index, malformed] of [
      malformedContainer,
      malformedChapterCallback,
    ].entries()) {
      assert.doesNotThrow(() => (
        validateEpubArchive(malformed, DEFAULT_EPUB_INGEST_POLICY)
      ))
      await assert.rejects(
        parseEpub(
          malformed,
          `doc-worker-crash-${index}`,
          DEFAULT_EPUB_PARSE_LIMITS,
          { tempDirectory },
        ),
        isInvalidEpub,
      )
      assert.deepEqual(readdirSync(tempDirectory), [])
    }

    const recovered = await parseEpub(
      valid,
      "doc-worker-recovery",
      DEFAULT_EPUB_PARSE_LIMITS,
      { tempDirectory },
    )
    assert.ok(recovered.length > 0)
    assert.deepEqual(readdirSync(tempDirectory), [])
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true })
  }
})

test("isolated parse preserves typed parser limits and cleans its temp input", async () => {
  const buffer = await buildSyntheticEpub()
  const tempDirectory = workerTempDirectory()

  try {
    const cases = [
      { limit: "spine_items", overrides: { maxSpineItems: 1 } },
      { limit: "manifest_items", overrides: { maxManifestItems: 2 } },
      { limit: "toc_items", overrides: { maxTocItems: 1 } },
      { limit: "archive_entries", overrides: { maxArchiveEntries: 5 } },
    ]
    for (const testCase of cases) {
      await assert.rejects(
        parseEpub(
          buffer,
          `doc-worker-limit-${testCase.limit}`,
          { ...DEFAULT_EPUB_PARSE_LIMITS, ...testCase.overrides },
          { tempDirectory },
        ),
        (error: unknown) => (
          error instanceof EpubParseLimitError && error.limit === testCase.limit
        ),
      )
      assert.deepEqual(readdirSync(tempDirectory), [])
    }
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true })
  }
})

test("isolated parse terminates on its worker deadline and cleans its temp input", async () => {
  const buffer = await buildSyntheticEpub()
  const tempDirectory = workerTempDirectory()

  try {
    await assert.rejects(
      parseEpub(
        buffer,
        "doc-worker-timeout",
        DEFAULT_EPUB_PARSE_LIMITS,
        { tempDirectory, timeoutMs: 0 },
      ),
      isInvalidEpub,
    )
    assert.deepEqual(readdirSync(tempDirectory), [])
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true })
  }
})

test("isolated parse rejects a malformed worker message and recovers", async () => {
  const buffer = await buildSyntheticEpub({ editionLabel: "protocol-recovery" })
  const tempDirectory = workerTempDirectory()

  try {
    await assert.rejects(
      parseEpub(
        buffer,
        "doc-worker-protocol-failure",
        DEFAULT_EPUB_PARSE_LIMITS,
        {
          tempDirectory,
          workerFactory: failingWorkerFactory("invalid-message"),
        },
      ),
      isInvalidEpub,
    )
    assert.deepEqual(readdirSync(tempDirectory), [])
    const recovered = await parseEpub(
      buffer,
      "doc-worker-protocol-recovery",
      DEFAULT_EPUB_PARSE_LIMITS,
      { tempDirectory },
    )
    assert.ok(recovered.length > 0)
    assert.deepEqual(readdirSync(tempDirectory), [])
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true })
  }
})

test("isolated parse rejects an abnormal worker exit and recovers", async () => {
  const buffer = await buildSyntheticEpub({ editionLabel: "exit-recovery" })
  const tempDirectory = workerTempDirectory()

  try {
    await assert.rejects(
      parseEpub(
        buffer,
        "doc-worker-exit-failure",
        DEFAULT_EPUB_PARSE_LIMITS,
        {
          tempDirectory,
          workerFactory: failingWorkerFactory("abnormal-exit"),
        },
      ),
      isInvalidEpub,
    )
    assert.deepEqual(readdirSync(tempDirectory), [])
    const recovered = await parseEpub(
      buffer,
      "doc-worker-exit-recovery",
      DEFAULT_EPUB_PARSE_LIMITS,
      { tempDirectory },
    )
    assert.ok(recovered.length > 0)
    assert.deepEqual(readdirSync(tempDirectory), [])
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true })
  }
})
