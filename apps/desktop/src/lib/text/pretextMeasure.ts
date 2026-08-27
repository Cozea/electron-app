import { measureLineStats, measureNaturalWidth, prepareWithSegments } from "@chenglou/pretext"

interface PretextOptions {
  whiteSpace?: "normal" | "pre-wrap"
  wordBreak?: "normal" | "keep-all"
  letterSpacing?: number
}

interface TruncateTextToWidthOptions {
  suffix?: string
  pretextOptions?: PretextOptions
}

const preparedCache = new Map<string, ReturnType<typeof prepareWithSegments>>()
const widthCache = new Map<string, number>()

function buildKey(text: string, font: string, options?: PretextOptions): string {
  return `${font}\u0000${options?.whiteSpace ?? "normal"}\u0000${options?.wordBreak ?? "normal"}\u0000${options?.letterSpacing ?? 0}\u0000${text}`
}

function getPrepared(text: string, font: string, options?: PretextOptions) {
  const key = buildKey(text, font, options)
  const cached = preparedCache.get(key)
  if (cached) return cached
  const prepared = prepareWithSegments(text, font, options)
  preparedCache.set(key, prepared)
  return prepared
}

export function measureTextNaturalWidth(text: string, font: string, options?: PretextOptions): number {
  if (!text) return 0
  const key = buildKey(text, font, options)
  const cachedWidth = widthCache.get(key)
  if (cachedWidth !== undefined) return cachedWidth
  const prepared = getPrepared(text, font, options)
  const width = measureNaturalWidth(prepared)
  widthCache.set(key, width)
  return width
}

export function measureTextLineCountAtWidth(
  text: string,
  font: string,
  maxWidth: number,
  options?: PretextOptions,
): number {
  if (!text || maxWidth <= 0) return 0
  const prepared = getPrepared(text, font, options)
  const stats = measureLineStats(prepared, maxWidth)
  return stats.lineCount
}

export function measureTextLineCountAtWidthAtLeastOne(
  text: string,
  font: string,
  maxWidth: number,
  options?: PretextOptions,
): number {
  return Math.max(1, measureTextLineCountAtWidth(text, font, maxWidth, options))
}

export function exceedsTextLineCountAtWidth(
  text: string,
  font: string,
  maxWidth: number,
  lineThreshold: number,
  options?: PretextOptions,
): boolean {
  if (lineThreshold < 1) return true
  return measureTextLineCountAtWidth(text, font, maxWidth, options) > lineThreshold
}

export function truncateTextToWidth(
  text: string,
  font: string,
  maxWidth: number,
  options?: TruncateTextToWidthOptions,
): string {
  if (!text || maxWidth <= 0) return ""
  const suffix = options?.suffix ?? "…"
  const pretextOptions = options?.pretextOptions
  if (measureTextNaturalWidth(text, font, pretextOptions) <= maxWidth) {
    return text
  }

  const suffixWidth = suffix.length > 0 ? measureTextNaturalWidth(suffix, font, pretextOptions) : 0
  if (suffixWidth >= maxWidth) {
    return suffixWidth <= maxWidth ? suffix : ""
  }

  const allowedWidth = Math.max(0, maxWidth - suffixWidth)
  let low = 0
  let high = text.length
  let best = ""

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const candidate = text.slice(0, mid).trimEnd()
    const candidateWidth = measureTextNaturalWidth(candidate, font, pretextOptions)
    if (candidateWidth <= allowedWidth) {
      best = candidate
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return `${best}${suffix}`
}

export function clearPretextMeasureCache(): void {
  preparedCache.clear()
  widthCache.clear()
}
