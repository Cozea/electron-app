/**
 * LRU Cache for glob pattern matching
 *
 * Caches compiled regex patterns to avoid recompilation.
 * Uses LRU (Least Recently Used) eviction strategy.
 */

export class LRUCache<K, V> {
  private cache = new Map<K, V>()
  private readonly maxSize: number

  constructor(maxSize: number = 10000) {
    this.maxSize = maxSize
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key)
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key)
      this.cache.set(key, value)
    }
    return value
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key)
    } else if (this.cache.size >= this.maxSize) {
      // Remove oldest entry (first in map)
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) {
        this.cache.delete(firstKey)
      }
    }
    this.cache.set(key, value)
  }

  has(key: K): boolean {
    return this.cache.has(key)
  }

  delete(key: K): boolean {
    return this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
  }

  get size(): number {
    return this.cache.size
  }
}

// Global cache for compiled glob patterns
const globCache = new LRUCache<string, RegExp>(10000)

/**
 * Convert a glob pattern to a regex
 */
export function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape regex special chars
    .replace(/\*\*/g, '{{GLOBSTAR}}')       // Placeholder for **
    .replace(/\*/g, '[^/]*')                // * matches anything except /
    .replace(/\?/g, '[^/]')                 // ? matches single char except /
    .replace(/{{GLOBSTAR}}/g, '.*')         // ** matches anything

  return new RegExp(`^${escaped}$`)
}

/**
 * Match a path against a glob pattern (cached)
 */
export function matchGlob(pattern: string, path: string): boolean {
  let regex = globCache.get(pattern)
  if (!regex) {
    regex = globToRegex(pattern)
    globCache.set(pattern, regex)
  }
  return regex.test(path)
}

/**
 * Check if a path matches any of the given patterns
 */
export function matchAnyGlob(patterns: string[], path: string): boolean {
  return patterns.some(pattern => matchGlob(pattern, path))
}

/**
 * Parse a gitignore-style pattern
 * Returns null if the pattern should be ignored (comment or empty)
 */
export function parseGitignorePattern(line: string): string | null {
  // Trim whitespace
  const trimmed = line.trim()

  // Skip empty lines and comments
  if (!trimmed || trimmed.startsWith('#')) {
    return null
  }

  // Handle negation (!)
  // For now, we don't support negation patterns
  if (trimmed.startsWith('!')) {
    return null
  }

  // Remove trailing spaces (unless escaped)
  let pattern = trimmed.replace(/(?<!\\)\s+$/, '')

  // Handle directory-only patterns (ending with /)
  if (pattern.endsWith('/')) {
    pattern = pattern.slice(0, -1)
  }

  // Convert to glob if it doesn't have wildcards
  if (!pattern.includes('*') && !pattern.includes('?')) {
    // If it starts with /, it's relative to root
    if (pattern.startsWith('/')) {
      pattern = pattern.slice(1)
    } else {
      // Otherwise, match anywhere
      pattern = `**/${pattern}`
    }
  }

  return pattern
}
