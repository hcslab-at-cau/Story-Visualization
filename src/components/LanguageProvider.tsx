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

const LOCALE_STORAGE_KEY = "story-visualization:ui-locale"
export const THEME_STORAGE_KEY = "story-visualization:ui-theme"
const THEME_MEDIA_QUERY = "(prefers-color-scheme: dark)"
const DEFAULT_THEME_PREFERENCE: UiThemePreference = "system"

export type UiThemePreference = "system" | "light" | "dark"
type EffectiveUiTheme = "light" | "dark"

const UI_THEME_OPTIONS: UiThemePreference[] = ["system", "light", "dark"]

interface LanguageContextValue {
  locale: UiLocale
  setLocale: (locale: UiLocale) => void
  themePreference: UiThemePreference
  setThemePreference: (theme: UiThemePreference) => void
  effectiveTheme: EffectiveUiTheme
  t: UiStrings
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

function resolveThemePreference(value: unknown): UiThemePreference | null {
  return value === "system" || value === "light" || value === "dark" ? value : null
}

function systemTheme(): EffectiveUiTheme {
  return window.matchMedia(THEME_MEDIA_QUERY).matches ? "dark" : "light"
}

function resolveEffectiveTheme(themePreference: UiThemePreference): EffectiveUiTheme {
  return themePreference === "system" ? systemTheme() : themePreference
}

function applyDocumentTheme(themePreference: UiThemePreference, effectiveTheme: EffectiveUiTheme) {
  document.documentElement.dataset.uiThemePreference = themePreference
  document.documentElement.dataset.uiTheme = effectiveTheme
  document.documentElement.style.setProperty("color-scheme", effectiveTheme)
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<UiLocale>(DEFAULT_UI_LOCALE)
  const [themePreference, setThemePreference] = useState<UiThemePreference>(DEFAULT_THEME_PREFERENCE)
  const [effectiveTheme, setEffectiveTheme] = useState<EffectiveUiTheme>("light")

  useEffect(() => {
    const savedOrBrowserLocale =
      resolveUiLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY)) ??
      resolveUiLocale(window.navigator.language.slice(0, 2))
    if (!savedOrBrowserLocale || savedOrBrowserLocale === DEFAULT_UI_LOCALE) return

    const timeoutId = window.setTimeout(() => setLocale(savedOrBrowserLocale), 0)
    return () => window.clearTimeout(timeoutId)
  }, [])

  useEffect(() => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
    document.documentElement.lang = locale
  }, [locale])

  useEffect(() => {
    const savedThemePreference =
      resolveThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY)) ??
      resolveThemePreference(document.documentElement.dataset.uiThemePreference)
    if (!savedThemePreference || savedThemePreference === DEFAULT_THEME_PREFERENCE) return

    const timeoutId = window.setTimeout(() => setThemePreference(savedThemePreference), 0)
    return () => window.clearTimeout(timeoutId)
  }, [])

  useEffect(() => {
    function syncTheme() {
      const nextEffectiveTheme = resolveEffectiveTheme(themePreference)
      setEffectiveTheme(nextEffectiveTheme)
      applyDocumentTheme(themePreference, nextEffectiveTheme)
    }

    syncTheme()
    window.localStorage.setItem(THEME_STORAGE_KEY, themePreference)

    if (themePreference !== "system") return

    const media = window.matchMedia(THEME_MEDIA_QUERY)
    media.addEventListener("change", syncTheme)
    return () => media.removeEventListener("change", syncTheme)
  }, [themePreference])

  const value = useMemo<LanguageContextValue>(
    () => ({
      locale,
      setLocale,
      themePreference,
      setThemePreference,
      effectiveTheme,
      t: UI_STRINGS[locale],
    }),
    [effectiveTheme, locale, themePreference],
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
      themePreference: DEFAULT_THEME_PREFERENCE,
      setThemePreference: () => undefined,
      effectiveTheme: "light",
      t: UI_STRINGS[DEFAULT_UI_LOCALE],
    }
  }
  return context
}

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useUiStrings()

  return (
    <div className="flex shrink-0 items-center gap-2">
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

export function ThemeSwitcher() {
  const { themePreference, setThemePreference, t } = useUiStrings()

  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className="text-xs font-medium text-zinc-500">{t.theme.label}</span>
      <div
        role="group"
        aria-label={t.theme.selectLabel}
        className="flex overflow-hidden rounded-full border border-zinc-200 bg-zinc-50 p-0.5"
      >
        {UI_THEME_OPTIONS.map((option) => {
          const active = option === themePreference
          return (
            <button
              key={option}
              type="button"
              onClick={() => setThemePreference(option)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                active
                  ? "bg-zinc-900 text-white shadow-sm"
                  : "text-zinc-500 hover:bg-white hover:text-zinc-800"
              }`}
              aria-pressed={active}
              title={t.theme.options[option]}
            >
              {t.theme.options[option]}
            </button>
          )
        })}
      </div>
    </div>
  )
}
