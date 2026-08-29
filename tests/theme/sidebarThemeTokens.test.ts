import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const stylesheet = fs.readFileSync(
  path.join(REPO_ROOT, 'apps', 'desktop', 'src', 'index.css'),
  'utf-8',
)

const CUSTOM_THEMES = ['navy', 'wine', 'clay', 'forest'] as const

function readRule(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = stylesheet.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))

  expect(match, `Missing CSS rule for ${selector}`).not.toBeNull()
  return match?.[1] ?? ''
}

function readCustomProperty(rule: string, property: string): string {
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = rule.match(new RegExp(`${escapedProperty}:\\s*([^;]+);`))

  expect(match, `Missing ${property}`).not.toBeNull()
  return match?.[1].trim() ?? ''
}

describe('left sidebar theme tokens', () => {
  it('keeps every chromatic theme on its own sidebar palette', () => {
    for (const theme of CUSTOM_THEMES) {
      const rule = readRule(`.${theme}`)

      expect(readCustomProperty(rule, '--main-nav-sidebar-surface')).toBe('var(--sidebar)')
      expect(readCustomProperty(rule, '--left-sidebar-surface')).toBe(
        'var(--main-nav-sidebar-surface)',
      )
    }
  })

  it('uses a stronger but still translucent glass tint for chromatic themes', () => {
    expect(readCustomProperty(readRule(':root'), '--left-sidebar-glass-color-weight')).toBe('18%')
    expect(readCustomProperty(readRule('.dark'), '--left-sidebar-glass-color-weight')).toBe('30%')

    for (const theme of CUSTOM_THEMES) {
      expect(
        readCustomProperty(readRule(`.${theme}`), '--left-sidebar-glass-color-weight'),
      ).toBe('62%')
    }

    expect(readRule('.sidebar-glass [data-slot="sidebar-inner"]')).toContain(
      'var(--left-sidebar-glass-color-weight)',
    )
    expect(stylesheet).not.toContain(
      'background-color: color-mix(in oklch, var(--left-sidebar-surface) 30%, transparent)',
    )
  })
})
