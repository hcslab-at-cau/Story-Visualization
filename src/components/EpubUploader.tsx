"use client"

import { useState, useRef } from "react"
import type { ChapterMeta } from "@/types/ui"

interface Props {
  onUploaded: (docId: string, chapters: ChapterMeta[]) => void
}

export default function EpubUploader({ onUploaded }: Props) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setUploading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append("file", file)
      form.append("title", file.name.replace(/\.epub$/i, ""))

      const res = await fetch("/api/epub", { method: "POST", body: form })
      const data = await res.json() as { docId?: string; chapters?: ChapterMeta[]; error?: string }

      if (!res.ok || !data.docId) throw new Error(data.error ?? "Upload failed")
      onUploaded(data.docId, data.chapters ?? [])
    } catch (e) {
      setError(String(e))
    } finally {
      setUploading(false)
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file?.name.endsWith(".epub")) handleFile(file)
  }

  return (
    <div
      className="border-2 border-dashed border-zinc-300 rounded-xl p-12 text-center cursor-pointer hover:border-zinc-500 transition-colors"
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".epub"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
      />
      {uploading ? (
        <p className="text-zinc-500">Parsing EPUB...</p>
      ) : (
        <>
          <p className="text-lg font-medium text-zinc-700">Drop an EPUB file here</p>
          <p className="text-sm text-zinc-400 mt-1">or click to browse</p>
        </>
      )}
      {error && <p className="text-red-500 text-sm mt-3">{error}</p>}
    </div>
  )
}
