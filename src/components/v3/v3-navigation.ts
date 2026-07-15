import type { DataSource } from "@/lib/client-data"

export type V3WorkbenchView = "pipeline" | "timeline" | "qa"

export function firstSearchParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

export function parseV3NavigationSource(value: string | string[] | undefined): DataSource {
  const source = firstSearchParam(value)
  if (source === "legacy" || source === "v3") return source
  return "current"
}

export function parseV3WorkbenchView(value: string | string[] | undefined): V3WorkbenchView {
  const view = firstSearchParam(value)
  if (view === "timeline" || view === "qa") return view
  return "pipeline"
}

export function createV3WorkbenchHref(params: {
  docId: string
  chapterId?: string
  source?: DataSource
  view?: V3WorkbenchView
}): string {
  const query = new URLSearchParams({ docId: params.docId })
  if (params.chapterId) query.set("chapterId", params.chapterId)
  if (params.source) query.set("source", params.source)
  if (params.view && params.view !== "pipeline") query.set("view", params.view)
  return `/v3?${query.toString()}`
}
