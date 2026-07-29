import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Worker, type WorkerOptions } from "node:worker_threads"

export const DEFAULT_EPUB_PARSER_WORKER_TIMEOUT_MS = 90_000

const EPUB_PARSER_WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require("node:worker_threads")
const { EPub } = require(workerData.epubModulePath)

function itemSnapshot(item) {
  if (!item || typeof item !== "object") return {}
  return {
    id: typeof item.id === "string" ? item.id : undefined,
    title: typeof item.title === "string" ? item.title : undefined,
    href: typeof item.href === "string" ? item.href : undefined,
    mediaType: typeof item.mediaType === "string" ? item.mediaType : undefined,
    "media-type": typeof item["media-type"] === "string"
      ? item["media-type"]
      : undefined,
  }
}

function documentSnapshot(epub) {
  const manifest = Object.create(null)
  let manifestCount = 0
  for (const key in (epub.manifest || {})) {
    if (!Object.prototype.hasOwnProperty.call(epub.manifest, key)) continue
    manifestCount += 1
    if (manifestCount > workerData.limits.maxManifestItems) {
      return { limit: "manifest_items" }
    }
    const item = epub.manifest[key]
    manifest[key] = itemSnapshot(item)
  }

  const toc = Array.isArray(epub.toc) ? epub.toc : []
  if (toc.length > workerData.limits.maxTocItems) {
    return { limit: "toc_items" }
  }
  const archiveEntryNames = Array.isArray(epub.zip && epub.zip.names)
    ? epub.zip.names
    : []
  if (archiveEntryNames.length > workerData.limits.maxArchiveEntries) {
    return { limit: "archive_entries" }
  }

  return { document: {
    spine: {
      contents: Array.isArray(epub.spine && epub.spine.contents)
        ? epub.spine.contents.map(itemSnapshot)
        : [],
    },
    manifest,
    toc: toc.map(itemSnapshot),
    archiveEntryNames: archiveEntryNames.filter((name) => typeof name === "string"),
  } }
}

function fatal() {
  parentPort.postMessage({ type: "fatal" })
  parentPort.on("message", () => {})
}

EPub.createAsync(workerData.tempPath).then((epub) => {
  if (!epub.spine || !Array.isArray(epub.spine.contents)) {
    fatal()
    return
  }
  if (epub.spine.contents.length > workerData.limits.maxSpineItems) {
    parentPort.postMessage({ type: "limit", limit: "spine_items" })
    return
  }
  const snapshot = documentSnapshot(epub)
  if (snapshot.limit) {
    parentPort.postMessage({ type: "limit", limit: snapshot.limit })
    return
  }
  parentPort.postMessage({ type: "ready", document: snapshot.document })
  parentPort.on("message", (message) => {
    if (
      !message ||
      message.type !== "getChapter" ||
      !Number.isInteger(message.requestId) ||
      typeof message.chapterId !== "string"
    ) {
      fatal()
      return
    }

    try {
      epub.getChapter(message.chapterId, (error, text) => {
        if (error) {
          parentPort.postMessage({
            type: "chapter",
            requestId: message.requestId,
            ok: false,
          })
          return
        }
        parentPort.postMessage({
          type: "chapter",
          requestId: message.requestId,
          ok: true,
          text: typeof text === "string" ? text : "",
        })
      })
    } catch {
      fatal()
    }
  })
}).catch(fatal)
`

export interface EpubReaderItem {
  id?: string
  title?: string
  href?: string
  mediaType?: string
  "media-type"?: string
}

export interface EpubReaderDocument {
  spine: { contents: EpubReaderItem[] }
  manifest: Record<string, EpubReaderItem>
  toc: EpubReaderItem[]
  archiveEntryNames: string[]
}

export interface IsolatedEpubReader extends EpubReaderDocument {
  getChapter(chapterId: string): Promise<string>
  assertHealthy(): void
  close(): Promise<void>
}

export interface EpubParserWorkerOptions {
  tempDirectory?: string
  timeoutMs?: number
  /** @internal Deterministic failure injection for worker-boundary tests. */
  workerFactory?: EpubParserWorkerFactory
}

export interface EpubParserWorkerHandle {
  on(event: "message", listener: (message: unknown) => void): this
  once(event: "error" | "messageerror", listener: () => void): this
  once(event: "exit", listener: (code: number) => void): this
  postMessage(message: unknown): void
  terminate(): Promise<number>
}

export type EpubParserWorkerFactory = (
  source: string,
  options: WorkerOptions,
) => EpubParserWorkerHandle

export interface EpubParserWorkerLimits {
  maxSpineItems: number
  maxManifestItems: number
  maxTocItems: number
  maxArchiveEntries: number
}

export class EpubParserWorkerError extends Error {
  constructor() {
    super("Invalid EPUB archive")
    this.name = "EpubParserWorkerError"
  }
}

export class EpubParserWorkerInternalError extends Error {
  constructor() {
    super("EPUB parser worker failed")
    this.name = "EpubParserWorkerInternalError"
  }
}

export class EpubParserWorkerLimitError extends Error {
  constructor(public readonly limit: string) {
    super("EPUB content exceeds the configured resource budget")
    this.name = "EpubParserWorkerLimitError"
  }
}

class EpubSourceReadError extends Error {
  constructor() {
    super("Unreadable EPUB source item")
    this.name = "EpubSourceReadError"
  }
}

interface ReadyMessage {
  type: "ready"
  document: EpubReaderDocument
}

interface ChapterMessage {
  type: "chapter"
  requestId: number
  ok: boolean
  text?: string
}

interface PendingChapter {
  resolve: (text: string) => void
  reject: (error: Error) => void
}

function isReaderDocument(value: unknown): value is EpubReaderDocument {
  if (typeof value !== "object" || value === null) return false
  const document = value as Partial<EpubReaderDocument>
  return (
    typeof document.spine === "object" &&
    document.spine !== null &&
    Array.isArray(document.spine.contents) &&
    typeof document.manifest === "object" &&
    document.manifest !== null &&
    Array.isArray(document.toc) &&
    Array.isArray(document.archiveEntryNames) &&
    document.archiveEntryNames.every((name) => typeof name === "string")
  )
}

function isReadyMessage(value: unknown): value is ReadyMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "ready" &&
    isReaderDocument((value as { document?: unknown }).document)
  )
}

function isChapterMessage(value: unknown): value is ChapterMessage {
  if (typeof value !== "object" || value === null) return false
  const message = value as Partial<ChapterMessage>
  return (
    message.type === "chapter" &&
    Number.isInteger(message.requestId) &&
    typeof message.ok === "boolean" &&
    (!message.ok || typeof message.text === "string")
  )
}

function parserWorkerTimeout(options: EpubParserWorkerOptions): number {
  const timeoutMs = options.timeoutMs ?? DEFAULT_EPUB_PARSER_WORKER_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0) {
    throw new RangeError("EPUB parser worker timeout must be a non-negative safe integer")
  }
  return timeoutMs
}

export async function openIsolatedEpubReader(
  buffer: Buffer,
  limits: EpubParserWorkerLimits,
  options: EpubParserWorkerOptions = {},
): Promise<IsolatedEpubReader> {
  const timeoutMs = parserWorkerTimeout(options)
  for (const [name, limit] of Object.entries(limits)) {
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw new RangeError(`EPUB parser ${name} limit must be a non-negative safe integer`)
    }
  }
  let tempRoot: string
  try {
    tempRoot = mkdtempSync(join(
      options.tempDirectory ?? tmpdir(),
      "story-epub-worker-",
    ))
  } catch {
    throw new EpubParserWorkerInternalError()
  }
  const tempPath = join(tempRoot, "book.epub")
  try {
    writeFileSync(tempPath, buffer, { flag: "wx" })
  } catch {
    try {
      rmSync(tempRoot, { recursive: true, force: true })
    } catch {
      // The public error remains an internal parser failure.
    }
    throw new EpubParserWorkerInternalError()
  }

  let worker: EpubParserWorkerHandle
  try {
    const epubModulePath = createRequire(import.meta.url).resolve("epub2")
    const workerFactory = options.workerFactory ?? (
      (source, workerOptions) => new Worker(source, workerOptions)
    )
    worker = workerFactory(EPUB_PARSER_WORKER_SOURCE, {
      eval: true,
      workerData: { epubModulePath, limits, tempPath },
      resourceLimits: {
        maxOldGenerationSizeMb: 512,
        maxYoungGenerationSizeMb: 64,
        stackSizeMb: 8,
      },
    })
  } catch {
    try {
      rmSync(tempRoot, { recursive: true, force: true })
    } catch {
      // The public error remains an internal parser failure.
    }
    throw new EpubParserWorkerInternalError()
  }

  let closed = false
  let fatalError: EpubParserWorkerError | EpubParserWorkerInternalError | undefined
  let nextRequestId = 1
  const pendingChapters = new Map<number, PendingChapter>()

  let resolveReady!: (document: EpubReaderDocument) => void
  let rejectReady!: (error: Error) => void
  const ready = new Promise<EpubReaderDocument>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })

  const fail = (
    error: EpubParserWorkerError | EpubParserWorkerInternalError =
      new EpubParserWorkerError(),
  ): void => {
    if (fatalError) return
    fatalError = error
    rejectReady(fatalError)
    for (const pending of pendingChapters.values()) pending.reject(fatalError)
    pendingChapters.clear()
  }

  const timeout = setTimeout(() => {
    fail(new EpubParserWorkerError())
    void worker.terminate().catch(() => undefined)
  }, timeoutMs)

  worker.on("message", (message: unknown) => {
    if (
      typeof message === "object" &&
      message !== null &&
      (message as { type?: unknown }).type === "fatal"
    ) {
      fail(new EpubParserWorkerError())
      return
    }
    if (
      typeof message === "object" &&
      message !== null &&
      (message as { type?: unknown }).type === "limit" &&
      typeof (message as { limit?: unknown }).limit === "string"
    ) {
      rejectReady(new EpubParserWorkerLimitError(
        (message as { limit: string }).limit,
      ))
      return
    }
    if (isReadyMessage(message)) {
      resolveReady(message.document)
      return
    }
    if (isChapterMessage(message)) {
      const pending = pendingChapters.get(message.requestId)
      if (!pending) {
        fail()
        return
      }
      pendingChapters.delete(message.requestId)
      if (message.ok) pending.resolve(message.text ?? "")
      else pending.reject(new EpubSourceReadError())
      return
    }
    fail()
  })
  worker.once("error", () => fail())
  worker.once("messageerror", () => fail())
  worker.once("exit", () => {
    if (!closed) fail()
  })

  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    clearTimeout(timeout)
    const closeError = fatalError ?? new EpubParserWorkerInternalError()
    for (const pending of pendingChapters.values()) pending.reject(closeError)
    pendingChapters.clear()
    let closeFailed = false
    try {
      await worker.terminate()
    } catch {
      closeFailed = true
    }
    try {
      rmSync(tempRoot, { recursive: true, force: true })
    } catch {
      closeFailed = true
    }
    if (closeFailed) throw new EpubParserWorkerInternalError()
  }

  let document: EpubReaderDocument
  try {
    document = await ready
  } catch (error) {
    await close()
    throw error
  }

  return {
    ...document,
    getChapter(chapterId: string): Promise<string> {
      if (fatalError) return Promise.reject(fatalError)
      const requestId = nextRequestId
      nextRequestId += 1

      return new Promise<string>((resolve, reject) => {
        pendingChapters.set(requestId, { resolve, reject })
        try {
          worker.postMessage({ type: "getChapter", requestId, chapterId })
        } catch {
          pendingChapters.delete(requestId)
          fail()
          reject(fatalError ?? new EpubParserWorkerError())
        }
      })
    },
    assertHealthy(): void {
      if (fatalError) throw fatalError
    },
    close,
  }
}
