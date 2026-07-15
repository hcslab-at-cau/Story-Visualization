import AppVersionSwitcher from "@/components/AppVersionSwitcher"
import { LanguageProvider, LanguageSwitcher, ThemeSwitcher } from "@/components/LanguageProvider"
import PreMentionWorkbench from "@/components/v3/PreMentionWorkbench"
import {
  firstSearchParam,
  parseV3NavigationSource,
  parseV3WorkbenchView,
} from "@/components/v3/v3-navigation"
import { redirect } from "next/navigation"

interface V3PageProps {
  searchParams: Promise<{
    docId?: string | string[]
    chapterId?: string | string[]
    source?: string | string[]
    view?: string | string[]
  }>
}

export default async function V3Page({ searchParams }: V3PageProps) {
  const params = await searchParams
  const docId = firstSearchParam(params.docId)
  if (!docId) redirect("/v3/library")
  const chapterId = firstSearchParam(params.chapterId)
  const source = parseV3NavigationSource(params.source)
  const view = parseV3WorkbenchView(params.view)

  return (
    <LanguageProvider>
      <div className="flex min-h-screen flex-col bg-zinc-50">
        <header className="flex flex-wrap items-center gap-4 border-b border-zinc-200 bg-white px-4 py-4 sm:px-6">
          <div className="flex min-w-0 flex-wrap items-center gap-6">
            <h1 className="text-lg font-semibold text-zinc-900">Story Visualization</h1>
            <AppVersionSwitcher />
          </div>
          <div className="flex w-full shrink-0 flex-wrap items-center justify-start gap-3 sm:ml-auto sm:w-auto sm:justify-end">
            <ThemeSwitcher />
            <LanguageSwitcher />
          </div>
        </header>

        <main className="flex min-h-0 flex-1">
          <PreMentionWorkbench
            initialDocId={docId}
            initialChapterId={chapterId}
            initialSeedSource={source}
            initialView={view}
          />
        </main>
      </div>
    </LanguageProvider>
  )
}
