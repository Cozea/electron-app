import fs from 'node:fs'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { ALL_THEMES, applyThemeClass, THEME_STORAGE_KEY } from '../../apps/desktop/src/lib/theme'

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const scriptSource = fs.readFileSync(
  path.join(REPO_ROOT, 'apps', 'desktop', 'public', 'theme-init.js'),
  'utf-8',
)

interface RunOptions {
  stored?: string | null
  systemPrefersDark?: boolean
  storageThrows?: boolean
}

interface RunResult {
  addedClasses: string[]
  requestedKeys: string[]
  inlineColorScheme: string | undefined
}

/**
 * Executes the pre-paint script against stubbed globals. The script must only
 * touch what is stubbed here — anything else is a startup-blocking hazard.
 */
function runThemeInit(options: RunOptions): RunResult {
  const addedClasses: string[] = []
  const requestedKeys: string[] = []

  const fakeWindow = {
    localStorage: {
      getItem(key: string) {
        requestedKeys.push(key)
        if (options.storageThrows) throw new Error('storage denied')
        return options.stored ?? null
      },
    },
    matchMedia(_query: string) {
      return { matches: options.systemPrefersDark ?? false }
    },
  }
  const fakeDocument = {
    documentElement: {
      classList: {
        add(...classNames: string[]) {
          addedClasses.push(...classNames)
        },
      },
      style: {} as { colorScheme?: string },
    },
  }

  new Function('window', 'document', scriptSource)(fakeWindow, fakeDocument)
  return {
    addedClasses,
    requestedKeys,
    inlineColorScheme: fakeDocument.documentElement.style.colorScheme,
  }
}

describe('public/theme-init.js', () => {
  it('is loaded by index.html before the app bundle', () => {
    const indexHtml = fs.readFileSync(
      path.join(REPO_ROOT, 'apps', 'desktop', 'index.html'),
      'utf-8',
    )
    const initScriptAt = indexHtml.indexOf('src="/theme-init.js"')
    const appBundleAt = indexHtml.indexOf('src="/src/main.tsx"')

    expect(initScriptAt).toBeGreaterThan(-1)
    expect(appBundleAt).toBeGreaterThan(-1)
    expect(initScriptAt).toBeLessThan(appBundleAt)
  })

  it('reads the same storage key as src/lib/theme.ts', () => {
    const { requestedKeys } = runThemeInit({ stored: 'dark' })
    expect(requestedKeys).toEqual([THEME_STORAGE_KEY])
  })

  it('applies every theme that src/lib/theme.ts defines', () => {
    for (const theme of ALL_THEMES) {
      expect(runThemeInit({ stored: theme }).addedClasses).toEqual([theme])
    }
  })

  it('resolves the system theme via prefers-color-scheme', () => {
    expect(runThemeInit({ stored: 'system', systemPrefersDark: true }).addedClasses).toEqual(['dark'])
    expect(runThemeInit({ stored: 'system', systemPrefersDark: false }).addedClasses).toEqual(['light'])
  })

  it('migrates the legacy sunny theme to clay', () => {
    // getStoredThemePreference() persists the migration; the script only paints with it.
    expect(runThemeInit({ stored: 'sunny' }).addedClasses).toEqual(['clay'])
  })

  it('falls back to dark like getStoredThemePreference()', () => {
    expect(runThemeInit({ stored: null }).addedClasses).toEqual(['dark'])
    expect(runThemeInit({ stored: 'not-a-theme' }).addedClasses).toEqual(['dark'])
  })

  it('falls back to dark when storage access throws', () => {
    expect(runThemeInit({ storageThrows: true }).addedClasses).toEqual(['dark'])
  })

  it('bridges color-scheme inline until the stylesheet loads', () => {
    for (const theme of ALL_THEMES) {
      const expected = theme === 'light' ? 'light' : 'dark'
      expect(runThemeInit({ stored: theme }).inlineColorScheme).toBe(expected)
    }
  })
})

describe('applyThemeClass', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('releases the inline color-scheme bridge set by theme-init', () => {
    const classes = new Set<string>(['platform-darwin', 'dark'])
    const removedProperties: string[] = []
    vi.stubGlobal('document', {
      documentElement: {
        classList: {
          add: (...names: string[]) => names.forEach((n) => classes.add(n)),
          remove: (...names: string[]) => names.forEach((n) => classes.delete(n)),
        },
        style: {
          removeProperty: (property: string) => removedProperties.push(property),
        },
      },
    })

    applyThemeClass('navy')

    expect([...classes]).toEqual(['platform-darwin', 'navy'])
    expect(removedProperties).toContain('color-scheme')
  })
})
