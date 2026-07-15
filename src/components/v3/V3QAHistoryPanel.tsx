"use client"

import type { V3QAHistoryEntry } from "@/lib/v3-qa-history-types"

interface Props {
  entries: V3QAHistoryEntry[]
  selectedEntryId: string | null
  loading: boolean
  loadingMore: boolean
  saving: boolean
  deletingEntryId: string | null
  hasMore: boolean
  loadError: string | null
  saveError: string | null
  deleteError: string | null
  onSelect: (entry: V3QAHistoryEntry) => void
  onDelete: (entry: V3QAHistoryEntry) => void
  onLoadMore: () => void
}

const dateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Seoul",
})

function createdTime(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? dateFormatter.format(date) : "Unknown time"
}

export default function V3QAHistoryPanel({
  entries,
  selectedEntryId,
  loading,
  loadingMore,
  saving,
  deletingEntryId,
  hasMore,
  loadError,
  saveError,
  deleteError,
  onSelect,
  onDelete,
  onLoadMore,
}: Props) {
  return (
    <aside
      aria-label="Question history"
      className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:self-start"
    >
      <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Question history</p>
          <h2 className="mt-1 text-sm font-semibold text-zinc-950">Recent conversations</h2>
        </div>
        <span className="shrink-0 rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600">
          {entries.length} loaded
        </span>
      </div>

      {(saveError || loadError || deleteError) && (
        <div className="space-y-1 border-b border-zinc-200 bg-red-50 px-4 py-3 text-xs leading-5 text-red-700">
          {saveError ? <p>Save: {saveError}</p> : null}
          {loadError ? <p>Load: {loadError}</p> : null}
          {deleteError ? <p>Delete: {deleteError}</p> : null}
        </div>
      )}

      {saving ? (
        <p className="border-b border-zinc-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-700">Saving the latest answer...</p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <p className="px-4 py-10 text-center text-sm text-zinc-500">Loading question history...</p>
        ) : entries.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-medium text-zinc-700">No saved questions yet</p>
            <p className="mt-1 text-xs leading-5 text-zinc-500">Completed answers will appear here.</p>
          </div>
        ) : (
          <ul className="divide-y divide-zinc-200">
            {entries.map((entry) => {
              const selected = entry.entry_id === selectedEntryId
              const grounded = entry.answer_snapshot.answer.status === "answered"
              return (
                <li key={entry.entry_id} className={selected ? "bg-zinc-100" : "bg-white"}>
                  <button
                    type="button"
                    onClick={() => onSelect(entry)}
                    aria-pressed={selected}
                    className={`w-full px-4 pb-2 pt-3 text-left outline-none transition-colors hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-500 ${
                      selected ? "border-l-4 border-zinc-900 pl-3" : "border-l-4 border-transparent pl-3"
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className={`rounded-md px-2 py-1 text-[11px] font-semibold ${
                        grounded ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                      }`}>
                        {grounded ? "Grounded" : "Insufficient"}
                      </span>
                      <span className="font-mono text-[11px] text-zinc-500">P{entry.progress_end_pid}</span>
                    </span>
                    <span className="mt-2 line-clamp-2 block text-sm font-medium leading-5 text-zinc-900">
                      {entry.question}
                    </span>
                    <span className="mt-2 block text-xs text-zinc-500">{createdTime(entry.created_at)}</span>
                  </button>
                  <div className="flex justify-end px-3 pb-2">
                    <button
                      type="button"
                      onClick={() => onDelete(entry)}
                      disabled={deletingEntryId === entry.entry_id}
                      className="rounded-md px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label={`Delete saved question: ${entry.question}`}
                    >
                      {deletingEntryId === entry.entry_id ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {hasMore ? (
        <div className="border-t border-zinc-200 p-3">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="h-9 w-full rounded-lg border border-zinc-300 bg-white text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loadingMore ? "Loading..." : "Load more"}
          </button>
        </div>
      ) : null}
    </aside>
  )
}
