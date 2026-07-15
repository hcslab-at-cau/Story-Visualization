import AppVersionSwitcher from "@/components/AppVersionSwitcher"
import { LanguageProvider, LanguageSwitcher, ThemeSwitcher } from "@/components/LanguageProvider"
import V3LibraryPage from "@/components/v3/V3LibraryPage"

export default function V3LibraryRoute() {
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
          <V3LibraryPage />
        </main>
      </div>
    </LanguageProvider>
  )
}
