/**
 * POST /api/epub - import an EPUB into canonical corpus storage and ensure a
 * source-specific workspace points at the completed revision.
 */

import { randomUUID } from "node:crypto"
import {
  CorpusImportError,
  importCorpusEpub,
  type CorpusImportDependencies,
} from "@/lib/corpus-import"
import { validateBookId } from "@/lib/corpus-identity"
import { parseFirestoreDataSource } from "@/lib/data-source"
import { EpubParseLimitError, parseEpub } from "@/lib/epub"
import { chapterMetaFromRawChapters } from "@/lib/firestore"
import {
  authorizeEpubIngestRequest,
  DEFAULT_EPUB_INGEST_POLICY,
  EpubIngestGuardError,
  IngestConcurrencyGate,
  readBoundedRequestBody,
  validateDeclaredRequestSize,
  validateEpubArchive,
  type EpubIngestPolicy,
} from "@/lib/server/epub-ingest-guard"
import { FirestoreCorpusImportRepository } from "@/lib/server/firestore-corpus-import-store"
import { FirebaseCorpusBlobStore } from "@/lib/storage"

export const runtime = "nodejs"
export const maxDuration = 120

interface RuntimeConfig {
  production: boolean
  adminToken?: string
}

interface IngestGate {
  tryAcquire(): (() => void) | undefined
}

interface EpubPostHandlerDependencies {
  runtimeConfig: () => RuntimeConfig
  policy: EpubIngestPolicy
  gate: IngestGate
  parseMultipart: (body: Uint8Array, request: Request) => Promise<FormData>
  readFileBytes: (file: File) => Promise<Buffer>
  validateArchive: typeof validateEpubArchive
  importCorpus: typeof importCorpusEpub
  importDependencies: () => CorpusImportDependencies
}

function productionImportDependencies(): CorpusImportDependencies {
  return {
    repository: new FirestoreCorpusImportRepository(),
    blobStore: new FirebaseCorpusBlobStore(),
    parseEpub,
    now: () => new Date(),
    createClaimToken: () => randomUUID(),
  }
}

async function parseBoundedMultipart(
  body: Uint8Array,
  request: Request,
): Promise<FormData> {
  const contentType = request.headers.get("content-type")
  const boundedRequest = new Request(request.url, {
    method: request.method,
    headers: { "content-type": contentType ?? "" },
    body: body as BodyInit,
  })
  return boundedRequest.formData()
}

function formString(formData: FormData, name: string): string | undefined {
  const value = formData.get(name)
  return typeof value === "string" ? value : undefined
}

function guardError(
  statusCode: number,
  code: string,
  message: string,
  headers: HeadersInit = {},
): EpubIngestGuardError {
  return new EpubIngestGuardError(statusCode, code, message, headers)
}

function validateMultipartEssence(request: Request): void {
  const contentType = request.headers.get("content-type")
  const essence = contentType?.split(";", 1)[0]?.trim().toLowerCase()
  if (essence !== "multipart/form-data") {
    throw guardError(
      415,
      "invalid_content_type",
      "Request is not multipart form data",
    )
  }
}

function validatedBookId(formData: FormData): string | undefined {
  const bookId = formString(formData, "bookId")
  if (bookId === undefined) return undefined

  try {
    return validateBookId(bookId)
  } catch (error) {
    throw new CorpusImportError(
      error instanceof Error ? error.message : "invalid bookId",
      400,
      "invalid_book_id",
    )
  }
}

function guardErrorResponse(error: EpubIngestGuardError): Response {
  return Response.json(
    { error: error.message, code: error.code },
    { status: error.statusCode, headers: error.headers },
  )
}

export function createEpubPostHandler(
  overrides: Partial<EpubPostHandlerDependencies> = {},
): (request: Request) => Promise<Response> {
  const dependencies: EpubPostHandlerDependencies = {
    runtimeConfig: () => ({
      production: process.env.NODE_ENV === "production",
      adminToken: process.env.EPUB_INGEST_ADMIN_TOKEN,
    }),
    policy: DEFAULT_EPUB_INGEST_POLICY,
    gate: new IngestConcurrencyGate(),
    parseMultipart: parseBoundedMultipart,
    readFileBytes: async (file) => Buffer.from(await file.arrayBuffer()),
    validateArchive: validateEpubArchive,
    importCorpus: importCorpusEpub,
    importDependencies: productionImportDependencies,
    ...overrides,
  }

  return async (request: Request): Promise<Response> => {
    let release: (() => void) | undefined

    try {
      authorizeEpubIngestRequest(request, dependencies.runtimeConfig())
      validateMultipartEssence(request)
      validateDeclaredRequestSize(request, dependencies.policy.maxRequestBytes)

      release = dependencies.gate.tryAcquire()
      if (release === undefined) {
        throw guardError(
          429,
          "ingest_busy",
          "EPUB import is already in progress",
          { "Retry-After": "5" },
        )
      }

      const body = await readBoundedRequestBody(
        request,
        dependencies.policy.maxRequestBytes,
      )

      let formData: FormData
      try {
        formData = await dependencies.parseMultipart(body, request)
      } catch (error) {
        if (error instanceof EpubIngestGuardError) throw error
        throw guardError(
          400,
          "malformed_multipart",
          "Malformed multipart form data",
        )
      }

      const fileValue = formData.get("file")
      if (!(fileValue instanceof File)) {
        throw guardError(400, "missing_file", "No file provided")
      }
      if (fileValue.size > dependencies.policy.maxEpubBytes) {
        throw guardError(
          413,
          "epub_too_large",
          "Uploaded EPUB exceeds the configured resource limit",
        )
      }

      const bookId = validatedBookId(formData)
      const buffer = await dependencies.readFileBytes(fileValue)
      dependencies.validateArchive(buffer, dependencies.policy)

      const result = await dependencies.importCorpus(
        {
          buffer,
          fileName: fileValue.name,
          contentType: "application/epub+zip",
          title: formString(formData, "title") ?? "Untitled",
          bookId,
          source: parseFirestoreDataSource(formString(formData, "source")),
        },
        dependencies.importDependencies(),
      )

      return Response.json({
        docId: result.docId,
        chapters: chapterMetaFromRawChapters(result.chapters),
        sourceFile: result.sourceFile,
        bookId: result.bookId,
        corpusRevisionId: result.corpusRevisionId,
        reused: result.reused,
      })
    } catch (error) {
      if (error instanceof EpubIngestGuardError) {
        return guardErrorResponse(error)
      }
      if (error instanceof EpubParseLimitError) {
        return Response.json(
          {
            error: "EPUB content exceeds the configured resource budget",
            code: "epub_resource_limit",
          },
          { status: 413 },
        )
      }
      if (error instanceof CorpusImportError) {
        return Response.json(
          { error: error.message, code: error.code },
          { status: error.statusCode },
        )
      }
      return Response.json({ error: "Failed to import EPUB" }, { status: 500 })
    } finally {
      release?.()
    }
  }
}

export const POST = createEpubPostHandler({
  runtimeConfig: () => ({
    production: process.env.NODE_ENV === "production",
    adminToken: process.env.EPUB_INGEST_ADMIN_TOKEN,
  }),
})
