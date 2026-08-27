/**
 * Pre-paint theme bootstrap.
 *
 * Loaded as a parser-blocking script from index.html so the theme class is
 * on <html> before the first paint. Without it, the page renders with the
 * light :root variables until React mounts and ThemeProvider applies the
 * stored theme — a visible flash for every dark-theme user.
 *
 * This intentionally duplicates the resolution logic in src/lib/theme.ts
 * (it cannot import it: it must run before the app bundle is even fetched).
 * Keep the two in sync — tests/theme/themeInit.test.ts enforces it.
 *
 * Must stay dependency-free and exception-safe: a broken theme guess is
 * cosmetic, a thrown exception here would still be cosmetic, but never
 * risk it blocking startup.
 */
;(function () {
  try {
    var THEMES = ['light', 'dark', 'navy', 'wine', 'clay', 'forest']
    var STORAGE_KEY = 'cozea-theme'

    var stored = null
    try {
      stored = window.localStorage.getItem(STORAGE_KEY)
    } catch (e) {
      // Storage access can be denied; fall through to the default.
    }

    // Legacy theme id — mapped here for paint, persisted by getStoredThemePreference().
    if (stored === 'sunny') stored = 'clay'

    var theme = stored === 'system' || THEMES.indexOf(stored) !== -1 ? stored : 'dark'
    if (theme === 'system') {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }

    document.documentElement.classList.add(theme)

    // Inline color-scheme bridges the window until the stylesheet loads: it
    // keeps Chromium's default canvas dark for dark themes even while the
    // document is completely unstyled (dev mode injects CSS via JS, so there
    // is a paint before any rule exists). applyThemeClass() removes it once
    // the class-based rules in src/index.css own the value. Every theme
    // except light is dark-background.
    document.documentElement.style.colorScheme = theme === 'light' ? 'light' : 'dark'
  } catch (e) {
    // Never block startup on theming.
  }
})()
