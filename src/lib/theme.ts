// The theme list, storage key, legacy migration, and defaults are mirrored in
// public/theme-init.js, which applies the theme before first paint (it runs
// before this module can load). tests/theme/themeInit.test.ts keeps them in sync.
export type Theme = 'light' | 'dark' | 'navy' | 'wine' | 'clay' | 'forest' | 'system'

export type ResolvedTheme = Exclude<Theme, 'system'>

export const THEME_STORAGE_KEY = 'cozea-theme'

export const ALL_THEMES = ['light', 'dark', 'navy', 'wine', 'clay', 'forest'] as const

export function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function getStoredThemePreference(): Theme {
  if (typeof window === 'undefined') return 'system'

  const stored = localStorage.getItem(THEME_STORAGE_KEY)
  if (stored === 'sunny') {
    localStorage.setItem(THEME_STORAGE_KEY, 'clay')
    return 'clay'
  }

  if (stored && (stored === 'system' || ALL_THEMES.includes(stored as (typeof ALL_THEMES)[number]))) {
    return stored as Theme
  }

  return 'dark'
}

export function resolveAppliedTheme(theme: Theme): ResolvedTheme {
  if (theme === 'system') {
    return getSystemTheme()
  }

  return theme
}

export function applyThemeClass(theme: Theme): void {
  if (typeof document === 'undefined') return

  const root = document.documentElement
  root.classList.remove(...ALL_THEMES)
  root.classList.add(resolveAppliedTheme(theme))
  // Release the pre-paint bridge set by public/theme-init.js; from here on the
  // class-based color-scheme rules in src/index.css are the authority.
  root.style.removeProperty('color-scheme')
}
