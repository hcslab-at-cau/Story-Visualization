import {
  buildAndSaveV3BookQACorpus,
  loadStoredV3BookQACorpus,
  V3BookQACorpusRequestError,
} from "@/lib/server/v3-book-qa-corpus-service"
import { V3BookQACorpusImmutableConflictError } from "@/lib/server/v3-book-qa-corpus-store"

export const maxDuration = 300

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function serviceErrorResponse(error: unknown): Response {
  if (error instanceof V3BookQACorpusRequestError || error instanceof SyntaxError) {
    return Response.json({ error: errorMessage(error) }, { status: 400 })
  }
  if (error instanceof V3BookQACorpusImmutableConflictError) {
    return Response.json({ error: error.message }, { status: 409 })
  }
  if (
    error &&
    typeof error === "object" &&
    (error as { status?: unknown }).status === 409
  ) {
    return Response.json({ error: errorMessage(error) }, { status: 409 })
  }
  return Response.json({ error: errorMessage(error) }, { status: 500 })
}

export async function GET(request: Request): Promise<Response> {
  try {
    const searchParams = new URL(request.url).searchParams
    const corpus = await loadStoredV3BookQACorpus(
      searchParams.get("docId"),
      searchParams.get("qaCorpusId"),
    )
    if (!corpus) {
      return Response.json({ error: "BOOK.1 corpus not found" }, { status: 404 })
    }
    return Response.json(corpus)
  } catch (error) {
    return serviceErrorResponse(error)
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const corpus = await buildAndSaveV3BookQACorpus(await request.json())
    return Response.json(corpus)
  } catch (error) {
    return serviceErrorResponse(error)
  }
}
