export function TimelineLegend({
  hasSelection,
  onClearFocus,
}: {
  hasSelection: boolean
  onClearFocus: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-xs text-zinc-600">
      <span className="inline-flex items-center gap-2">
        <span className="h-1 w-10 rounded-full bg-zinc-600" />
        Same element
      </span>
      <span className="inline-flex items-center gap-2">
        <span className="flex w-12 gap-0.5 rounded-full bg-white px-1 py-1 ring-1 ring-zinc-200">
          <span className="h-1.5 flex-1 rounded-full bg-sky-500" />
          <span className="h-1.5 flex-1 rounded-full bg-emerald-500" />
          <span className="h-1.5 flex-1 rounded-full bg-amber-500" />
          <span className="h-1.5 flex-1 rounded-full bg-zinc-300" />
        </span>
        Event footprint
      </span>
      <span className="inline-flex items-center gap-2">
        <span className="h-4 w-9 rounded bg-fuchsia-100 ring-1 ring-fuchsia-200" />
        Scene span
      </span>
      {hasSelection && (
        <button
          type="button"
          onClick={onClearFocus}
          className="ml-auto rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
        >
          Clear focus
        </button>
      )}
    </div>
  )
}
