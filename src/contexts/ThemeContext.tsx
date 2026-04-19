import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from 'react'

import { applyThemeClass, getStoredThemePreference, THEME_STORAGE_KEY, type Theme } from '@/lib/theme'

export type { Theme } from '@/lib/theme'

interface ThemeContextType {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => getStoredThemePreference())

  const setTheme = (newTheme: Theme) => {
    applyThemeClass(newTheme)
    setThemeState(newTheme)
    localStorage.setItem(THEME_STORAGE_KEY, newTheme)
  }

  useLayoutEffect(() => {
    applyThemeClass(theme)
    if (window.electronAPI) {
      let source: 'system' | 'light' | 'dark' = 'system'
      if (theme !== 'system') {
        source = theme === 'light' ? 'light' : 'dark'
      }
      window.electronAPI.app.setNativeThemeSource(source).catch(console.error)
    }
  }, [theme])

  useEffect(() => {
    if (theme !== 'system') return

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => {
      applyThemeClass('system')
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [theme])

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
