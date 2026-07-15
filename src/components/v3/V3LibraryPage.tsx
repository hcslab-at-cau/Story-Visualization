"use client"

import EpubUploader from "@/components/EpubUploader"
import ExistingDocumentsPicker from "@/components/ExistingDocumentsPicker"
import { createV3WorkbenchHref } from "@/components/v3/v3-navigation"
import type { DataSource } from "@/lib/client-data"
import type { ChapterMeta } from "@/types/ui"

const V3_SOURCE: DataSource = "v3"
const CURRENT_SOURCE: DataSource = "current"

function openWorkbench(docId: string, chapters: ChapterMeta[], source: DataSource) {
  window.location.assign(createV3WorkbenchHref({
    docId,
    chapterId: chapters[0]?.chapterId,
    source,
  }))
}

export default function V3LibraryPage() {
  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-5 p-4 sm:p-6">
      <section className="rounded-xl border border-zinc-200 bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">V3 library</p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-zinc-950">Choose a document</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
              Open a source EPUB before entering the V3 event and scene workspace.
            </p>
          </div>
        </div>
      </section>

      <div className="grid min-h-0 gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="rounded-xl border border-zinc-200 bg-white p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Upload</p>
          <EpubUploader
            source={V3_SOURCE}
            onUploaded={(docId, chapters) => openWorkbench(docId, chapters, V3_SOURCE)}
          />
        </section>

        <div className="space-y-4">
          <ExistingDocumentsPicker
            source={CURRENT_SOURCE}
            title="Existing EPUB files"
            description="Open a previously uploaded source document."
            onSelected={(docId, chapters) => openWorkbench(docId, chapters, CURRENT_SOURCE)}
          />
          <ExistingDocumentsPicker
            source={V3_SOURCE}
            title="V3 uploads"
            description="Open EPUB files uploaded directly into the V3 workspace."
            emptyMessage="No V3 uploads yet."
            onSelected={(docId, chapters) => openWorkbench(docId, chapters, V3_SOURCE)}
          />
        </div>
      </div>
    </div>
  )
}
