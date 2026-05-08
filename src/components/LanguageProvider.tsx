"use client"

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import {
  DEFAULT_UI_LOCALE,
  UI_LOCALE_OPTIONS,
  UI_STRINGS,
  resolveUiLocale,
  type UiLocale,
  type UiStrings,
} from "@/lib/ui-strings"

const STORAGE_KEY = "story-visualization:ui-locale"

interface LanguageContextValue {
  locale: UiLocale
  setLocale: (locale: UiLocale) => void
  t: UiStrings
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<UiLocale>(DEFAULT_UI_LOCALE)

  useEffect(() => {
    const savedOrBrowserLocale =
      resolveUiLocale(window.localStorage.getItem(STORAGE_KEY)) ??
      resolveUiLocale(window.navigator.language.slice(0, 2))
    if (!savedOrBrowserLocale || savedOrBrowserLocale === DEFAULT_UI_LOCALE) return

    const timeoutId = window.setTimeout(() => setLocale(savedOrBrowserLocale), 0)
    return () => window.clearTimeout(timeoutId)
  }, [])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, locale)
    document.documentElement.lang = locale
  }, [locale])

  const value = useMemo<LanguageContextValue>(
    () => ({
      locale,
      setLocale,
      t: UI_STRINGS[locale],
    }),
    [locale],
  )

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useUiStrings(): LanguageContextValue {
  const context = useContext(LanguageContext)
  if (!context) {
    return {
      locale: DEFAULT_UI_LOCALE,
      setLocale: () => undefined,
      t: UI_STRINGS[DEFAULT_UI_LOCALE],
    }
  }
  return context
}

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useUiStrings()

  return (
    <div className="ml-auto flex shrink-0 items-center gap-2">
      <span className="text-xs font-medium text-zinc-500">{t.language.label}</span>
      <div
        role="group"
        aria-label={t.language.selectLabel}
        className="flex overflow-hidden rounded-full border border-zinc-200 bg-zinc-50 p-0.5"
      >
        {UI_LOCALE_OPTIONS.map((option) => {
          const active = option.value === locale
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setLocale(option.value)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                active
                  ? "bg-zinc-900 text-white shadow-sm"
                  : "text-zinc-500 hover:bg-white hover:text-zinc-800"
              }`}
              aria-pressed={active}
              title={option.label}
            >
              {option.shortLabel}
            </button>
          )
        })}
      </div>
    </div>
  )
}
