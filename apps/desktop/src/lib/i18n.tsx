/**
 * Cozea i18n – lightweight, React-native internationalisation.
 *
 * Provides:
 *  - `Language` type and `LANGUAGES` constant
 *  - `LanguageProvider` / `useLanguage()` for React context
 *  - `useTranslation()` hook returning a `t(key)` function
 *  - `getTranslation(lang, key)` for non-React code paths
 *  - localStorage persistence under `cozea-language`
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import en, { type TranslationKey } from "./i18n/en"
import es from "./i18n/es"

// ── Public types ──────────────────────────────────────────────────────

export type Language = "en" | "es"

export interface LanguageOption {
  code: Language
  label: string // native name shown in selectors
}

export const LANGUAGES: readonly LanguageOption[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
] as const

// ── Translation maps ─────────────────────────────────────────────────

const translations: Record<Language, Record<TranslationKey, string>> = {
  en,
  es,
}

// ── Storage helpers ──────────────────────────────────────────────────

const STORAGE_KEY = "cozea-language"

export function getStoredLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === "en" || stored === "es") return stored
  } catch {
    // localStorage may be unavailable (e.g. in tests)
  }
  return "en"
}

export function setStoredLanguage(lang: Language): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang)
    document.documentElement.lang = lang
  } catch {
    // best-effort
  }
}

/**
 * Call once at startup (before React mounts) to sync the `<html lang>`
 * attribute with the persisted preference.
 */
export function applyStoredLanguage(): void {
  const lang = getStoredLanguage()
  document.documentElement.lang = lang
}

// ── Standalone translation (for non-React code) ─────────────────────

/** Look up a translation key for a specific language. */
export function getTranslation(lang: Language, key: TranslationKey): string {
  return translations[lang]?.[key] ?? translations.en[key] ?? key
}

// ── React context ────────────────────────────────────────────────────

interface LanguageContextValue {
  language: Language
  setLanguage: (lang: Language) => void
}

const LanguageContext = createContext<LanguageContextValue>({
  language: "en",
  setLanguage: () => {},
})

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(getStoredLanguage)

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang)
    setStoredLanguage(lang)
  }, [])

  // Keep <html lang> in sync if another tab changes localStorage
  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  const value = useMemo(
    () => ({ language, setLanguage }),
    [language, setLanguage],
  )

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  )
}

/** Access the current language and setter. */
export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext)
}

/** Returns a `t(key)` function bound to the current language. */
export function useTranslation(): {
  t: (key: TranslationKey) => string
  language: Language
} {
  const { language } = useLanguage()

  const t = useCallback(
    (key: TranslationKey): string => getTranslation(language, key),
    [language],
  )

  return { t, language }
}

export type { TranslationKey }
