import {
  createV3BookQACorpusStore,
  V3BookQACorpusImmutableConflictError,
  type StoredV3BookQACorpus,
} from "@/lib/server/v3-book-qa-corpus-store"
import {
  V3BookQAHistoryCorpusIntegrityError,
  V3BookQAHistoryValidationError,
  normalizeV3BookQAHistoryCreateInput,
  normalizeV3BookQAHistoryDeleteInput,
  normalizeV3BookQAHistoryScopeInput,
  type NormalizedV3BookQAHistoryCreateInput,
} from "@/lib/server/v3-book-qa-history"
import {
  createV3BookQAHistoryStore,
  V3BookQAHistoryStoreIntegrityError,
} from "@/lib/server/v3-book-qa-history-store"
import type {
  V3BookQAHistoryDeleteRequest,
  V3BookQAHistoryEntry,
  V3BookQAHistoryPage,
  V3BookQAHistoryScopeRequest,
} from "@/lib/v3-book-qa-history-types"

export interface V3BookQAHistoryRouteDependencies {
  loadCorpus(docId: string, qaCorpusId: string): Promise<StoredV3BookQACorpus | null>
  save(input: NormalizedV3BookQAHistoryCreateInput): Promise<V3BookQAHistoryEntry>
  list(input: V3BookQAHistoryScopeRequest): Promise<V3BookQAHistoryPage>
  delete(input: V3BookQAHistoryDeleteRequest): Promise<boolean>
}

export interface V3BookQAHistoryRouteHandlers {
  GET(request: Request): Promise<Response>
  POST(request: Request): Promise<Response>
  DELETE(request: Request): Promise<Response>
}

function defaultDependencies(): V3BookQAHistoryRouteDependencies {
  const corpusStore = createV3BookQACorpusStore()
  const historyStore = createV3BookQAHistoryStore()
  return {
    loadCorpus: (docId, qaCorpusId) => corpusStore.load(docId, qaCorpusId),
    save: (input) => historyStore.save(input),
    list: (input) => historyStore.list(input),
    delete: (input) => historyStore.delete(input),
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function historyErrorResponse(error: unknown): Response {
  if (error instanceof SyntaxError || error instanceof V3BookQAHistoryValidationError) {
    return Response.json({ error: errorMessage(error) }, { status: 400 })
  }
  if (error instanceof V3BookQACorpusImmutableConflictError
    || error instanceof V3BookQAHistoryCorpusIntegrityError
    || error instanceof V3BookQAHistoryStoreIntegrityError) {
    return Response.json({ error: errorMessage(error) }, { status: 409 })
  }
  return Response.json({ error: errorMessage(error) }, { status: 500 })
}

function scopeRequestFromUrl(request: Request): Record<string, string> {
  return Object.fromEntries(new URL(request.url).searchParams.entries())
}

export function createV3BookQAHistoryRouteHandlers(
  dependencies: V3BookQAHistoryRouteDependencies = defaultDependencies(),
): V3BookQAHistoryRouteHandlers {
  return {
    async GET(request: Request): Promise<Response> {
      try {
        const input = normalizeV3BookQAHistoryScopeInput(scopeRequestFromUrl(request))
        return Response.json(await dependencies.list(input))
      } catch (error) {
        return historyErrorResponse(error)
      }
    },

    async POST(request: Request): Promise<Response> {
      try {
        const body: unknown = await request.json()
        const parsed = normalizeV3BookQAHistoryCreateInput(body)
        const stored = await dependencies.loadCorpus(parsed.docId, parsed.qaCorpusId)
        if (!stored) {
          return Response.json({ error: "BOOK.1 corpus not found" }, { status: 404 })
        }
        const input = normalizeV3BookQAHistoryCreateInput(body, stored.manifest)
        return Response.json(await dependencies.save(input))
      } catch (error) {
        return historyErrorResponse(error)
      }
    },

    async DELETE(request: Request): Promise<Response> {
      try {
        const input = normalizeV3BookQAHistoryDeleteInput(await request.json())
        const deleted = await dependencies.delete(input)
        return deleted
          ? Response.json({ ok: true })
          : Response.json({ error: "Book QA history entry not found" }, { status: 404 })
      } catch (error) {
        return historyErrorResponse(error)
      }
    },
  }
}

const defaultHandlers = createV3BookQAHistoryRouteHandlers()

export async function GET(request: Request): Promise<Response> {
  return defaultHandlers.GET(request)
}

export async function POST(request: Request): Promise<Response> {
  return defaultHandlers.POST(request)
}

export async function DELETE(request: Request): Promise<Response> {
  return defaultHandlers.DELETE(request)
}
