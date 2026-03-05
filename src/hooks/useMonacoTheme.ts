import { useEffect, useMemo, useState } from 'react'
import * as monaco from 'monaco-editor'
import { useTheme, type Theme } from '@/contexts/ThemeContext'

type ResolvedTheme = Exclude<Theme, 'system'>

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function isDarkTheme(theme: ResolvedTheme): boolean {
  return theme === 'dark' || theme === 'navy' || theme === 'wine' || theme === 'forest' || theme === 'clay'
}

function rgbToHex(rgb: string, fallback: string): string {
  const match = rgb.match(
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+)\s*)?\)/
  )
  if (!match) return fallback
  const r = Math.max(0, Math.min(255, Number(match[1])))
  const g = Math.max(0, Math.min(255, Number(match[2])))
  const b = Math.max(0, Math.min(255, Number(match[3])))
  const toHex = (n: number) => n.toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function withAlpha(hex: string, alpha: number): string {
  const normalized = hex.startsWith('#') ? hex.slice(1) : hex
  if (normalized.length !== 6) return hex
  const clamped = Math.max(0, Math.min(1, alpha))
  const a = Math.round(clamped * 255)
    .toString(16)
    .padStart(2, '0')
  return `#${normalized}${a}`
}

function resolveThemeColor(cssVar: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const raw = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim()
  if (!raw) return fallback

  const temp = document.createElement('div')
  temp.style.position = 'absolute'
  temp.style.visibility = 'hidden'
  temp.style.backgroundColor = raw
  document.body.appendChild(temp)
  const resolved = getComputedStyle(temp).backgroundColor
  document.body.removeChild(temp)
  return rgbToHex(resolved, fallback)
}

export type MonacoThemeVariant = 'default' | 'muted' | 'sidebar'

function ensureMonacoTheme(themeName: string, resolvedTheme: ResolvedTheme, variant: MonacoThemeVariant = 'default'): void {
  const dark = isDarkTheme(resolvedTheme)

  const background = resolveThemeColor('--background', dark ? '#0f0f10' : '#ffffff')
  const foreground = resolveThemeColor('--foreground', dark ? '#ffffff' : '#111111')
  const muted = resolveThemeColor('--muted', dark ? '#2a2a2a' : '#f4f4f5')
  const mutedForeground = resolveThemeColor('--muted-foreground', dark ? '#a1a1aa' : '#52525b')
  const border = resolveThemeColor('--border', dark ? '#2a2a2a' : '#e4e4e7')
  const accent = resolveThemeColor('--accent', dark ? '#2a2a2a' : '#f4f4f5')
  const primary = resolveThemeColor('--primary', dark ? '#d4d4d8' : '#111111')
  const sidebar = resolveThemeColor('--sidebar', dark ? '#1a1a1a' : '#fafafa')

  // Determine editor background based on variant
  let editorBackground = background
  let gutterBackground = background
  if (variant === 'muted') {
    editorBackground = withAlpha(muted, 0.2)
    gutterBackground = withAlpha(muted, 0.2)
  } else if (variant === 'sidebar') {
    // Use transparent editor surfaces; the parent container provides `.bg-sidebar`.
    // This keeps Monaco exactly in sync with sidebar class rendering (including theme mixes).
    editorBackground = '#00000000'
    gutterBackground = '#00000000'
  }
  const minimapBackground = variant === 'sidebar' ? sidebar : editorBackground
  const stickyScrollBackground = variant === 'sidebar' ? sidebar : editorBackground
  const overviewRulerBackground = variant === 'sidebar' ? sidebar : editorBackground

  monaco.editor.defineTheme(themeName, {
    base: dark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': editorBackground,
      'editor.foreground': foreground,
      'editorGutter.background': gutterBackground,
      'minimap.background': minimapBackground,
      'minimapGutter.background': overviewRulerBackground,
      'editorOverviewRuler.background': overviewRulerBackground,
      'editorOverviewRuler.border': '#00000000',
      'scrollbar.shadow': '#00000000',
      'scrollbarSlider.background': withAlpha(border, dark ? 0.45 : 0.35),
      'scrollbarSlider.hoverBackground': withAlpha(border, dark ? 0.65 : 0.55),
      'scrollbarSlider.activeBackground': withAlpha(border, dark ? 0.8 : 0.7),
      'minimapSlider.background': withAlpha(border, dark ? 0.45 : 0.35),
      'minimapSlider.hoverBackground': withAlpha(border, dark ? 0.65 : 0.55),
      'minimapSlider.activeBackground': withAlpha(border, dark ? 0.8 : 0.7),
      'editorStickyScroll.background': stickyScrollBackground,
      'editorStickyScrollGutter.background': stickyScrollBackground,
      'editorStickyScrollHover.background': stickyScrollBackground,
      'editorStickyScroll.border': withAlpha(border, dark ? 0.55 : 0.8),
      'editorStickyScroll.shadow': withAlpha(border, dark ? 0.45 : 0.25),
      'diffEditor.insertedTextBackground': withAlpha('#22c55e', 0.15),
      'diffEditor.removedTextBackground': withAlpha('#ef4444', 0.15),
      'diffEditor.insertedLineBackground': withAlpha('#22c55e', 0.1),
      'diffEditor.removedLineBackground': withAlpha('#ef4444', 0.1),
      'editorLineNumber.foreground': withAlpha(mutedForeground, 0.7),
      'editorLineNumber.activeForeground': foreground,
      'editorCursor.foreground': foreground,
      'editor.selectionBackground': withAlpha(accent, dark ? 0.45 : 0.6),
      'editor.inactiveSelectionBackground': withAlpha(accent, dark ? 0.25 : 0.35),
      'editor.lineHighlightBackground': withAlpha(muted, dark ? 0.35 : 0.6),
      'editorIndentGuide.background': withAlpha(border, dark ? 0.45 : 0.8),
      'editorIndentGuide.activeBackground': withAlpha(border, 1),
      'editorWidget.background': muted,
      'editorWidget.border': border,
      'editorSuggestWidget.background': muted,
      'editorSuggestWidget.border': border,
      'editorSuggestWidget.foreground': foreground,
      'editorSuggestWidget.highlightForeground': primary,
      'editorSuggestWidget.selectedBackground': withAlpha(accent, dark ? 0.45 : 0.6),
      'editorHoverWidget.background': muted,
      'editorHoverWidget.border': border,
    },
  })
}

export function useMonacoTheme(variant: MonacoThemeVariant = 'default'): string {
  const { theme } = useTheme()
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(() => getSystemTheme())

  useEffect(() => {
    if (theme !== 'system') return

    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => setSystemTheme(getSystemTheme())
    query.addEventListener('change', handler)
    return () => query.removeEventListener('change', handler)
  }, [theme])

  const resolvedTheme = useMemo<ResolvedTheme>(() => {
    if (theme === 'system') return systemTheme
    return theme
  }, [theme, systemTheme])

  const themeName = useMemo(() => {
    const suffix = variant !== 'default' ? `-${variant}` : ''
    return `cozea-${resolvedTheme}${suffix}`
  }, [resolvedTheme, variant])

  useEffect(() => {
    if (typeof window === 'undefined') return
    ensureMonacoTheme(themeName, resolvedTheme, variant)
  }, [themeName, resolvedTheme, variant])

  return themeName
}
