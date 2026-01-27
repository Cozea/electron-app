// Helper to check if a property label matches the search query
export function matchesSearch(label: string, query: string): boolean {
  if (!query) return true
  return label.toLowerCase().includes(query.toLowerCase())
}

// Property categories for search filtering
export const PROPERTY_CATEGORIES = {
  size: ['width', 'height', 'min-width', 'max-width', 'min-height', 'max-height'],
  layout: ['display', 'position', 'flex-direction', 'justify-content', 'align-items', 'gap', 'overflow', 'z-index'],
  spacing: ['padding', 'margin', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  typography: ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align', 'text-decoration', 'text-transform', 'color'],
  background: ['background-color', 'background-image', 'background-size', 'background-position', 'background-repeat'],
  border: ['border', 'border-radius', 'border-width', 'border-style', 'border-color'],
  effects: ['opacity', 'box-shadow', 'transform', 'transition'],
} as const

export function filterPropertiesBySearch(
  query: string
): { category: keyof typeof PROPERTY_CATEGORIES; matches: string[] }[] {
  if (!query) return []

  const results: { category: keyof typeof PROPERTY_CATEGORIES; matches: string[] }[] = []

  for (const [category, props] of Object.entries(PROPERTY_CATEGORIES)) {
    const matches = props.filter((prop) =>
      prop.toLowerCase().includes(query.toLowerCase())
    )
    if (matches.length > 0) {
      results.push({ category: category as keyof typeof PROPERTY_CATEGORIES, matches })
    }
  }

  return results
}

