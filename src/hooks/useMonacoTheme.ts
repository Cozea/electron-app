import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
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

interface MonacoTokenPalette {
  keyword: string
  operator: string
  type: string
  function: string
  string: string
  number: string
  variable: string
  constant: string
  comment: string
  tag: string
  attr: string
}

function getTokenPalette(resolvedTheme: ResolvedTheme): MonacoTokenPalette {
  switch (resolvedTheme) {
    case 'navy':
      return {
        keyword: '#8fb4ff',
        operator: '#7fc6d6',
        type: '#c4d6ff',
        function: '#7cb4ff',
        string: '#8fd5a8',
        number: '#f2bf87',
        variable: '#d7deeb',
        constant: '#dca3ff',
        comment: '#7c8ba3',
        tag: '#89a9ff',
        attr: '#a8c7ff',
      }
    case 'wine':
      return {
        keyword: '#f39abc',
        operator: '#d8b2bf',
        type: '#f4cad8',
        function: '#c8b8ff',
        string: '#9ecf9f',
        number: '#f0c295',
        variable: '#eedee5',
        constant: '#ffb6d9',
        comment: '#9d8290',
        tag: '#f7a5c8',
        attr: '#ecc5d7',
      }
    case 'clay':
      return {
        keyword: '#e4b388',
        operator: '#c4bda8',
        type: '#e8d3ad',
        function: '#9cc0de',
        string: '#aac992',
        number: '#eebc7f',
        variable: '#e8dfd4',
        constant: '#d9b4a8',
        comment: '#988a7e',
        tag: '#e5bf94',
        attr: '#dbc3a3',
      }
    case 'forest':
      return {
        keyword: '#95ccb0',
        operator: '#7bc0a9',
        type: '#c8deb8',
        function: '#93bfe3',
        string: '#a9d99a',
        number: '#dcb982',
        variable: '#d7e4da',
        constant: '#9fd6b8',
        comment: '#8aa094',
        tag: '#9bcdb4',
        attr: '#b9d9c8',
      }
    case 'dark':
    default:
      return {
        keyword: '#c792ea',
        operator: '#89ddff',
        type: '#ecc48d',
        function: '#82aaff',
        string: '#c3e88d',
        number: '#f78c6c',
        variable: '#d6deeb',
        constant: '#ffcb6b',
        comment: '#7f8896',
        tag: '#f07178',
        attr: '#c3e88d',
      }
  }
}

function getTokenRules(resolvedTheme: ResolvedTheme, foreground: string): monaco.editor.ITokenThemeRule[] {
  if (resolvedTheme === 'light') {
    return []
  }

  const palette = getTokenPalette(resolvedTheme)
  return [
    { token: '', foreground: foreground.slice(1) },
    { token: 'comment', foreground: palette.comment.slice(1), fontStyle: 'italic' },
    { token: 'comment.doc', foreground: palette.comment.slice(1), fontStyle: 'italic' },
    { token: 'keyword', foreground: palette.keyword.slice(1) },
    { token: 'keyword.control', foreground: palette.keyword.slice(1) },
    { token: 'keyword.operator', foreground: palette.operator.slice(1) },
    { token: 'operator', foreground: palette.operator.slice(1) },
    { token: 'delimiter', foreground: foreground.slice(1) },
    { token: 'number', foreground: palette.number.slice(1) },
    { token: 'constant', foreground: palette.constant.slice(1) },
    { token: 'string', foreground: palette.string.slice(1) },
    { token: 'string.escape', foreground: palette.number.slice(1) },
    { token: 'regexp', foreground: palette.number.slice(1) },
    { token: 'type', foreground: palette.type.slice(1) },
    { token: 'type.identifier', foreground: palette.type.slice(1) },
    { token: 'class', foreground: palette.type.slice(1) },
    { token: 'interface', foreground: palette.type.slice(1) },
    { token: 'enum', foreground: palette.type.slice(1) },
    { token: 'namespace', foreground: palette.type.slice(1) },
    { token: 'function', foreground: palette.function.slice(1) },
    { token: 'method', foreground: palette.function.slice(1) },
    { token: 'function.call', foreground: palette.function.slice(1) },
    { token: 'variable', foreground: palette.variable.slice(1) },
    { token: 'variable.parameter', foreground: palette.variable.slice(1) },
    { token: 'variable.language', foreground: palette.constant.slice(1) },
    { token: 'property', foreground: palette.variable.slice(1) },
    { token: 'tag', foreground: palette.tag.slice(1) },
    { token: 'attribute.name', foreground: palette.attr.slice(1) },
  ]
}

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
  const tokenRules = getTokenRules(resolvedTheme, foreground)

  // Determine editor background based on variant
  let editorBackground = background
  let gutterBackground = background
  if (variant === 'muted') {
    editorBackground = withAlpha(muted, 0.2)
    gutterBackground = withAlpha(muted, 0.2)
  } else if (variant === 'sidebar') {
    // Use transparent editor surfaces; the parent container provides the workspace surface class.
    // This keeps Monaco exactly in sync with the parent surface rendering (including theme mixes).
    editorBackground = '#00000000'
    gutterBackground = '#00000000'
  }
  const minimapBackground = variant === 'sidebar' ? sidebar : editorBackground
  const stickyScrollBackground = variant === 'sidebar' ? sidebar : editorBackground
  const overviewRulerBackground = variant === 'sidebar' ? sidebar : editorBackground

  monaco.editor.defineTheme(themeName, {
    base: dark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: tokenRules,
    colors: {
      'editor.background': editorBackground,
      'editor.foreground': foreground,
      'editor.semanticHighlighting.enabled': resolvedTheme === 'light' ? 'true' : 'false',
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
      'editor.lineHighlightBorder': '#00000000',
      'editor.rangeHighlightBackground': withAlpha(accent, dark ? 0.22 : 0.3),
      'editor.rangeHighlightBorder': '#00000000',
      'editor.selectionHighlightBackground': withAlpha(primary, dark ? 0.14 : 0.16),
      'editor.selectionHighlightBorder': '#00000000',
      'editor.wordHighlightBackground': withAlpha(primary, dark ? 0.1 : 0.08),
      'editor.wordHighlightStrongBackground': withAlpha(primary, dark ? 0.14 : 0.12),
      'editor.wordHighlightBorder': '#00000000',
      'editor.wordHighlightStrongBorder': '#00000000',
      'editorBracketMatch.background': withAlpha(accent, dark ? 0.22 : 0.2),
      'editorBracketMatch.border': '#00000000',
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
  monaco.editor.setTheme(themeName)
}

interface MonacoThemeController {
  themeName: string
  applyTheme: () => void
}

export function useMonacoTheme(variant: MonacoThemeVariant = 'default'): MonacoThemeController {
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

  const applyTheme = useCallback(() => {
    if (typeof window === 'undefined') return
    ensureMonacoTheme(themeName, resolvedTheme, variant)
  }, [themeName, resolvedTheme, variant])

  useLayoutEffect(() => {
    applyTheme()
  }, [applyTheme])

  return {
    themeName,
    applyTheme,
  }
}
