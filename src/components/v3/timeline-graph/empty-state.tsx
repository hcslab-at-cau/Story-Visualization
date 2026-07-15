export function EmptyGraph({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-[320px] items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white px-6 py-10 text-center">
      <div>
        <p className="text-sm font-semibold text-zinc-800">{title}</p>
        <p className="mt-2 max-w-md text-sm leading-6 text-zinc-500">{body}</p>
      </div>
    </div>
  )
}
