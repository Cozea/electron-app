import type { TranslationKey } from "@/lib/i18n"
import type { Theme } from "@/lib/theme"

export type NavUserThemeMenuAction = `theme-${Theme}`

interface NavUserThemeOption {
  id: NavUserThemeMenuAction
  labelKey: TranslationKey
  theme: Theme
}

export const NAV_USER_THEME_OPTIONS = [
  { id: "theme-light", labelKey: "nav.themeLight", theme: "light" },
  { id: "theme-dark", labelKey: "nav.themeDark", theme: "dark" },
  { id: "theme-navy", labelKey: "nav.themeNavy", theme: "navy" },
  { id: "theme-wine", labelKey: "nav.themeWine", theme: "wine" },
  { id: "theme-clay", labelKey: "nav.themeClay", theme: "clay" },
  { id: "theme-forest", labelKey: "nav.themeForest", theme: "forest" },
  { id: "theme-system", labelKey: "nav.themeSystem", theme: "system" },
] as const satisfies readonly NavUserThemeOption[]

export function resolveNavUserThemeAction(action: string | null): Theme | null {
  return NAV_USER_THEME_OPTIONS.find((option) => option.id === action)?.theme ?? null
}
