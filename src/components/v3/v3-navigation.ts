import type { DataSource } from "@/lib/client-data"
import type { V3BookReaderPosition } from "@/lib/pipeline/v3-book-qa-types"

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

export function parseV3ReaderPosition(
  chapterValue: string | string[] | undefined,
  pidValue: string | string[] | undefined,
): V3BookReaderPosition | undefined {
  const chapterId = firstSearchParam(chapterValue)?.trim()
  const rawPid = firstSearchParam(pidValue)?.trim()
  if (!chapterId || !rawPid || !/^(0|[1-9]\d*)$/.test(rawPid)) return undefined

  const pid = Number(rawPid)
  if (!Number.isSafeInteger(pid)) return undefined
  return { chapter_id: chapterId, pid }
}

export function createV3WorkbenchHref(params: {
  docId: string
  chapterId?: string
  runId?: string
  source?: DataSource
  view?: V3WorkbenchView
  qaCorpusId?: string
  readerPosition?: V3BookReaderPosition
}): string {
  const query = new URLSearchParams({ docId: params.docId })
  if (params.chapterId) query.set("chapterId", params.chapterId)
  if (params.runId) query.set("runId", params.runId)
  if (params.source) query.set("source", params.source)
  if (params.view && params.view !== "pipeline") query.set("view", params.view)
  if (params.qaCorpusId) query.set("qaCorpusId", params.qaCorpusId)
  if (params.readerPosition) {
    query.set("readerChapterId", params.readerPosition.chapter_id)
    query.set("readerPid", String(params.readerPosition.pid))
  }
  return `/v3?${query.toString()}`
}
