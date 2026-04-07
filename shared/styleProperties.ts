/**
 * Shared style-property utilities.
 *
 * Used by preview / DevTools normalization to map kebab-case computed styles
 * into camelCase keys for the property allowlist below.
 */

/** Canonical camelCase property list for preview style normalization. */
export const STYLE_PROPERTIES = [
  // Layout
  'display', 'position', 'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  // Spacing
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  // Overflow / misc
  'overflow', 'cursor', 'zIndex',
  // Typography
  'fontSize', 'fontWeight', 'fontFamily', 'fontStyle', 'lineHeight', 'letterSpacing', 'textAlign',
  'textDecoration', 'textTransform',
  // Colors
  'color', 'backgroundColor',
  // Background
  'backgroundImage', 'backgroundSize', 'backgroundPosition', 'backgroundRepeat',
  // Border
  'border', 'borderWidth', 'borderStyle', 'borderColor', 'borderRadius',
  'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius',
  // Effects
  'boxShadow', 'opacity', 'transform', 'transition',
  // Flex / Grid
  'flexDirection', 'justifyContent', 'alignItems', 'gap', 'flexWrap', 'flexGrow', 'flexShrink',
] as const

/** Set for O(1) lookup. */
const STYLE_PROPERTIES_SET: ReadonlySet<string> = new Set(STYLE_PROPERTIES)

/**
 * Convert a kebab-case CSS property name to camelCase.
 *
 *   cssKebabToCamel('font-family')  // → 'fontFamily'
 *   cssKebabToCamel('fontSize')     // → 'fontSize' (noop)
 */
export function cssKebabToCamel(name: string): string {
  if (!name.includes('-')) return name
  return name.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase())
}

/**
 * Normalise a raw CSS computed/inline style map:
 *
 * 1. Convert every key from kebab-case to camelCase.
 * 2. Filter to only properties present in `STYLE_PROPERTIES`.
 *
 * Empty or blank values are preserved so callers can tell "property resolved
 * to empty" vs "property was never in the set."
 */
export function normalizeComputedStyles(
  raw: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {}

  for (const [key, value] of Object.entries(raw)) {
    const camelKey = cssKebabToCamel(key)
    if (STYLE_PROPERTIES_SET.has(camelKey)) {
      result[camelKey] = value
    }
  }

  return result
}
