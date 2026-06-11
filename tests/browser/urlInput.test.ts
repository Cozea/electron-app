import { describe, expect, it } from 'vitest'

import { normalizeUrlInput } from '@/features/projects/browser/urlInput'

describe('normalizeUrlInput', () => {
  it('keeps explicit schemes untouched', () => {
    expect(normalizeUrlInput('https://example.com')).toBe('https://example.com')
    expect(normalizeUrlInput('http://localhost:3000/app')).toBe('http://localhost:3000/app')
    expect(normalizeUrlInput('file:///tmp/index.html')).toBe('file:///tmp/index.html')
    expect(normalizeUrlInput('mailto:dev@example.com')).toBe('mailto:dev@example.com')
  })

  it('treats host:port as an http address, not a URI scheme', () => {
    expect(normalizeUrlInput('localhost:3000')).toBe('http://localhost:3000')
    expect(normalizeUrlInput('localhost:5173/app')).toBe('http://localhost:5173/app')
    expect(normalizeUrlInput('127.0.0.1:8080')).toBe('http://127.0.0.1:8080')
    expect(normalizeUrlInput('localhost')).toBe('http://localhost')
  })

  it('upgrades bare domains to https', () => {
    expect(normalizeUrlInput('example.com')).toBe('https://example.com')
    expect(normalizeUrlInput('docs.example.com/path')).toBe('https://docs.example.com/path')
  })

  it('falls back to search for queries', () => {
    expect(normalizeUrlInput('how to center a div')).toBe(
      'https://www.google.com/search?q=how%20to%20center%20a%20div',
    )
    expect(normalizeUrlInput('react')).toBe('https://www.google.com/search?q=react')
  })

  it('handles empty input', () => {
    expect(normalizeUrlInput('')).toBe('')
    expect(normalizeUrlInput('   ')).toBe('')
  })
})
