import { WebglAddon } from '@xterm/addon-webgl'
import type { Terminal } from '@xterm/xterm'

const ROOT_THEME_SELECTOR = '.dark, .navy, .wine, .clay, .forest'

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }

  const userAgentDataPlatform = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData?.platform
  const platform = userAgentDataPlatform ?? navigator.platform ?? ''
  return /mac/i.test(platform)
}

/** Primary SF Mono stack (parity with t3-style embedded terminals; falls back cross-platform). */
export const XTERM_FONT_FAMILY =
  `"SF Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace${
    isMacPlatform() ? ', AppleBraille' : ''
  }`

/** Slightly relaxed line height for readability (matches common desktop terminal drawers). */
export const XTERM_LINE_HEIGHT = 1.18
export const XTERM_CUSTOM_GLYPHS = true
export const XTERM_RESCALE_OVERLAPPING_GLYPHS = true
export const XTERM_UNICODE_VERSION = '11'

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
      black: '#181e26',
      red: '#ff7a8e',
      green: '#86e795',
      yellow: '#f4cd72',
      blue: '#89beff',
      magenta: '#d0b0ff',
      cyan: '#7ce8ed',
      white: '#d2dae6',
      brightBlack: '#6e7888',
      brightRed: '#ffa8b4',
      brightGreen: '#b0f5ba',
      brightYellow: '#ffe095',
      brightBlue: '#aed2ff',
      brightMagenta: '#e5cbff',
      brightCyan: '#a7f4f7',
      brightWhite: '#f4f7fc',
    }
  }

  return {
    black: '#2c3542',
    red: '#bf4657',
    green: '#3c7e56',
    yellow: '#927023',
    blue: '#4866a3',
    magenta: '#845695',
    cyan: '#357f8d',
    white: '#d2d7df',
    brightBlack: '#707b8c',
    brightRed: '#d45f70',
    brightGreen: '#55946f',
    brightYellow: '#ad852d',
    brightBlue: '#5b7cc2',
    brightMagenta: '#996bac',
    brightCyan: '#4695a4',
    brightWhite: '#ecf0f6',
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
