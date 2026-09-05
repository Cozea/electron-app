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
    // Light mode's surface is pure white, so this weight is how white the
    // sidebar reads; too low and the window backdrop makes it look grey.
    expect(readCustomProperty(readRule(':root'), '--left-sidebar-glass-color-weight')).toBe('52%')
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

  it('omits the inner edge inset shadow in light mode while preserving it for dark and chromatic themes', () => {
    expect(readRule('.sidebar-glass [data-slot="sidebar-inner"]')).not.toContain('box-shadow')
    expect(stylesheet).toContain('box-shadow: inset -32px 0 36px -22px rgb(0 0 0 / 0.18);')
  })

  it('tones the sprite palette down for the light theme', () => {
    // `light` is the only light theme — navy/wine/clay/forest are all
    // color-scheme: dark, so they inherit the vivid defaults from :root.
    const vividBlock = stylesheet.slice(stylesheet.indexOf('--cozea-arcade-1:'))
    const lightRule = readRule('.light')

    for (let index = 1; index <= 12; index++) {
      const token = `--cozea-arcade-${index}`
      const vivid = readCustomProperty(vividBlock, token)
      const muted = readCustomProperty(lightRule, token)

      expect(vivid, `${token} should have a default`).toMatch(/^#[0-9a-f]{6}$/)
      expect(muted, `${token} should be overridden for light`).toMatch(/^#[0-9a-f]{6}$/)
      expect(muted, `${token} should differ in light mode`).not.toBe(vivid)
    }
  })

  it('gives every sprite id its own activity animation', () => {
    // Kept in step with SPRITES_BY_SET in ProjectPixelInvaderIcon.tsx. The
    // folder fallback is deliberately absent: it never animates.
    const spriteIds = [
      'crab', 'squid', 'octopus',
      'pacman', 'ghost', 'cherry',
      'tetris-t', 'tetris-l', 'tetris-z', 'tetris-o', 'tetris-s',
      'starfighter', 'heart', 'star', 'mushroom', 'key', 'gem', 'potion', 'skull', 'sword',
    ]

    for (const id of spriteIds) {
      expect(stylesheet, `missing @keyframes for ${id}`).toContain(`@keyframes cozea-sprite-${id}`)
      expect(readRule(`.cozea-sprite-${id}`), `missing rule for ${id}`).toContain(
        `cozea-sprite-${id}`,
      )
    }
  })

  it('gives each sprite a distinct animation rather than reusing one', () => {
    const keyframeNames = [...stylesheet.matchAll(/@keyframes\s+(cozea-sprite-[\w-]+)/g)].map(
      (match) => match[1],
    )
    expect(keyframeNames.length).toBe(20)
    expect(new Set(keyframeNames).size).toBe(keyframeNames.length)
  })

  it('disables active icon animations under reduced-motion preference', () => {
    const reducedMotionMatch = [...stylesheet.matchAll(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/g,
    )].find(match => match[1]?.includes('.cozea-sprite-active'))
    expect(reducedMotionMatch).toBeDefined()
    const reducedMotionContent = reducedMotionMatch?.[1] ?? ''

    // Every sprite rule carries the base class, so one rule disables them all.
    expect(reducedMotionContent).toContain('.cozea-sprite-active')
    expect(reducedMotionContent).toContain('animation: none !important')
  })
})
