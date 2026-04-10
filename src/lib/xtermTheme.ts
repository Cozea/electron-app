import { WebglAddon } from '@xterm/addon-webgl'
import type { ITheme, Terminal } from '@xterm/xterm'

const ROOT_THEME_SELECTOR = '.dark, .navy, .wine, .clay, .forest'

/** Primary SF Mono stack (parity with t3-style embedded terminals; falls back cross-platform). */
export const XTERM_FONT_FAMILY =
  '"SF Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace'

/** Slightly relaxed line height for readability (matches common desktop terminal drawers). */
export const XTERM_LINE_HEIGHT = 1.2

export function colorToHex(cssColor: string): string {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext('2d')
  if (!ctx) return '#000000'

  ctx.fillStyle = cssColor
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

export function compositeColorToHex(foregroundCss: string, backgroundCss: string): string {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext('2d')
  if (!ctx) return colorToHex(foregroundCss)

  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = backgroundCss
  ctx.fillRect(0, 0, 1, 1)
  ctx.fillStyle = foregroundCss
  ctx.fillRect(0, 0, 1, 1)

  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

export function resolveThemeColor(container: HTMLElement, cssVar: string, fallback: string): string {
  const localComputed = getComputedStyle(container).getPropertyValue(cssVar).trim()
  const themeRoot = container.closest(ROOT_THEME_SELECTOR) || document.documentElement
  const rootComputed = getComputedStyle(themeRoot).getPropertyValue(cssVar).trim()
  const computed = localComputed || rootComputed

  if (!computed) return fallback

  const tempDiv = document.createElement('div')
  tempDiv.style.position = 'absolute'
  tempDiv.style.visibility = 'hidden'
  tempDiv.style.backgroundColor = computed
  document.body.appendChild(tempDiv)
  const resolvedColor = getComputedStyle(tempDiv).backgroundColor
  document.body.removeChild(tempDiv)

  if (!resolvedColor || resolvedColor === 'rgba(0, 0, 0, 0)' || resolvedColor === 'transparent') {
    return fallback
  }
  return resolvedColor
}

export function getThemeColorHex(container: HTMLElement, cssVar: string, fallback: string): string {
  return colorToHex(resolveThemeColor(container, cssVar, fallback))
}

export function relativeLuminance(hex: string): number {
  const normalized = hex.replace('#', '')
  if (normalized.length !== 6) return 0
  const r = parseInt(normalized.slice(0, 2), 16) / 255
  const g = parseInt(normalized.slice(2, 4), 16) / 255
  const b = parseInt(normalized.slice(4, 6), 16) / 255
  const channel = (value: number) =>
    value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

export function buildAnsiPalette(useDarkPalette: boolean) {
  if (useDarkPalette) {
    return {
      black: '#09090b',
      red: '#f87171',
      green: '#4ade80',
      yellow: '#facc15',
      blue: '#60a5fa',
      magenta: '#c084fc',
      cyan: '#22d3ee',
      white: '#d4d4d8',
      brightBlack: '#52525b',
      brightRed: '#fca5a5',
      brightGreen: '#86efac',
      brightYellow: '#fde047',
      brightBlue: '#93c5fd',
      brightMagenta: '#d8b4fe',
      brightCyan: '#67e8f9',
      brightWhite: '#f4f4f5',
    }
  }

  return {
    black: '#2f333d',
    red: '#d73a49',
    green: '#22863a',
    yellow: '#9a6700',
    blue: '#005cc5',
    magenta: '#6f42c1',
    cyan: '#0a7ea4',
    white: '#57606a',
    brightBlack: '#6e7781',
    brightRed: '#cf222e',
    brightGreen: '#1a7f37',
    brightYellow: '#8a4600',
    brightBlue: '#0969da',
    brightMagenta: '#8250df',
    brightCyan: '#1b7c83',
    brightWhite: '#24292f',
  }
}

export function observeThemeChanges(onThemeChange: () => void): () => void {
  if (typeof MutationObserver === 'undefined') {
    return () => {}
  }

  let frameId: number | null = null
  const schedule = () => {
    if (frameId !== null) {
      window.cancelAnimationFrame(frameId)
    }
    frameId = window.requestAnimationFrame(() => {
      frameId = null
      onThemeChange()
    })
  }

  const observer = new MutationObserver(schedule)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'style', 'data-theme'],
  })

  return () => {
    observer.disconnect()
    if (frameId !== null) {
      window.cancelAnimationFrame(frameId)
    }
  }
}

export function loadXtermWebglAddon(terminal: Terminal): WebglAddon | null {
  try {
    const addon = new WebglAddon()
    terminal.loadAddon(addon)
    addon.onContextLoss(() => {
      addon.dispose()
    })
    return addon
  } catch {
    return null
  }
}

export function syncTerminalTheme(terminal: Terminal, buildTheme: () => ITheme): () => void {
  const applyTheme = () => {
    terminal.options.theme = buildTheme()
    try {
      terminal.refresh(0, Math.max(terminal.rows - 1, 0))
    } catch {
      // Ignore refresh errors after disposal or while dimensions settle.
    }
  }

  applyTheme()
  return observeThemeChanges(applyTheme)
}
