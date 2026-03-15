import { describe, expect, it } from 'vitest'

import {
  cssKebabToCamel,
  normalizeComputedStyles,
  STYLE_PROPERTIES,
} from '../shared/styleProperties'

describe('cssKebabToCamel', () => {
  it('converts kebab-case to camelCase', () => {
    expect(cssKebabToCamel('font-family')).toBe('fontFamily')
    expect(cssKebabToCamel('background-color')).toBe('backgroundColor')
    expect(cssKebabToCamel('border-top-left-radius')).toBe('borderTopLeftRadius')
  })

  it('passes through already-camelCase names', () => {
    expect(cssKebabToCamel('fontFamily')).toBe('fontFamily')
    expect(cssKebabToCamel('display')).toBe('display')
    expect(cssKebabToCamel('zIndex')).toBe('zIndex')
  })

  it('handles single-word properties', () => {
    expect(cssKebabToCamel('display')).toBe('display')
    expect(cssKebabToCamel('color')).toBe('color')
    expect(cssKebabToCamel('opacity')).toBe('opacity')
  })
})

describe('normalizeComputedStyles', () => {
  it('converts kebab-case DevTools output to camelCase', () => {
    const result = normalizeComputedStyles({
      'font-family': 'Inter, sans-serif',
      'font-size': '16px',
      'background-color': 'rgb(255, 0, 0)',
    })

    expect(result).toEqual({
      fontFamily: 'Inter, sans-serif',
      fontSize: '16px',
      backgroundColor: 'rgb(255, 0, 0)',
    })
  })

  it('passes through camelCase keys that are in the property list', () => {
    const result = normalizeComputedStyles({
      fontSize: '14px',
      fontWeight: '700',
      lineHeight: '1.5',
    })

    expect(result).toEqual({
      fontSize: '14px',
      fontWeight: '700',
      lineHeight: '1.5',
    })
  })

  it('filters out unknown CSS properties', () => {
    const result = normalizeComputedStyles({
      '-webkit-line-clamp': '2',
      'unicode-bidi': 'isolate',
      'font-family': 'Arial',
      'some-unknown-prop': 'value',
    })

    expect(result).toEqual({
      fontFamily: 'Arial',
    })
  })

  it('handles mixed kebab-case, camelCase, and unknown properties', () => {
    const result = normalizeComputedStyles({
      'font-family': 'Georgia',
      fontSize: '18px',
      '-webkit-appearance': 'none',
      display: 'flex',
      'flex-direction': 'column',
      unknownProp: 'value',
    })

    expect(result).toEqual({
      fontFamily: 'Georgia',
      fontSize: '18px',
      display: 'flex',
      flexDirection: 'column',
    })
  })

  it('returns empty object for empty input', () => {
    expect(normalizeComputedStyles({})).toEqual({})
  })

  it('preserves empty string values', () => {
    const result = normalizeComputedStyles({
      'font-family': '',
      display: '',
    })

    expect(result).toEqual({
      fontFamily: '',
      display: '',
    })
  })
})

describe('STYLE_PROPERTIES', () => {
  it('contains all expected ElementStyles properties', () => {
    const expectedSubset = [
      'fontFamily', 'fontSize', 'fontWeight', 'fontStyle',
      'color', 'backgroundColor',
      'display', 'position',
      'width', 'height',
      'borderRadius', 'boxShadow', 'opacity',
      'flexDirection', 'justifyContent', 'alignItems',
    ]

    for (const prop of expectedSubset) {
      expect(STYLE_PROPERTIES).toContain(prop)
    }
  })

  it('contains only camelCase keys (no hyphens)', () => {
    for (const prop of STYLE_PROPERTIES) {
      expect(prop).not.toContain('-')
    }
  })
})
