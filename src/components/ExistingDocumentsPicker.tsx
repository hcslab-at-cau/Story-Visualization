"use client"

import { useEffect, useState } from "react"
import type { ChapterMeta, DocumentMeta } from "@/types/ui"

interface Props {
  onSelected: (docId: string, chapters: ChapterMeta[]) => void
}

export default function ExistingDocumentsPicker({ onSelected }: Props) {
  const [documents, setDocuments] = useState<DocumentMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [selectingDocId, setSelectingDocId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function loadDocuments() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/documents")
      const data = await res.json() as { documents?: DocumentMeta[]; error?: string }
      if (!res.ok) throw new Error(data.error ?? "Failed to load documents")
      setDocuments(data.documents ?? [])
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadDocuments()
  }, [])

  async function handleSelect(docId: string) {
    setSelectingDocId(docId)
    setError(null)
    try {
      const res = await fetch(`/api/chapters?docId=${encodeURIComponent(docId)}`)
      const data = await res.json() as { chapters?: ChapterMeta[]; error?: string }
      if (!res.ok) throw new Error(data.error ?? "Failed to load chapters")
      onSelected(docId, data.chapters ?? [])
    } catch (e) {
      setError(String(e))
    } finally {
      setSelectingDocId(null)
    }
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-800">Existing Files</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Pick a previously uploaded document and continue from its saved chapters.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadDocuments()}
          disabled={loading || selectingDocId !== null}
          className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-zinc-500">Loading saved documents...</p>
      ) : documents.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-400">No uploaded documents found yet.</p>
      ) : (
        <div className="mt-4 space-y-2">
          {documents.map((document) => (
            <div
              key={document.docId}
              className="flex items-center gap-3 rounded-lg border border-zinc-200 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-800">
                  {document.title || document.sourceFile?.fileName || document.docId}
                </p>
                <p className="truncate text-xs text-zinc-500">
                  {document.sourceFile?.fileName ?? document.docId}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleSelect(document.docId)}
                disabled={selectingDocId !== null}
                className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
              >
                {selectingDocId === document.docId ? "Loading..." : "Open"}
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
    </div>
  )
}
