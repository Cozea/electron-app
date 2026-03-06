import { create } from 'zustand'

export type SettingsDrawerSection =
  | 'account'
  | 'billing'
  | 'ai'
  | 'appearance'
  | 'storage'
  | 'tooling'

const SETTINGS_SECTIONS = new Set<SettingsDrawerSection>([
  'account',
  'billing',
  'ai',
  'appearance',
  'storage',
  'tooling',
])

const SETTINGS_PATH_TO_SECTION: Record<string, SettingsDrawerSection> = {
  '/settings/account': 'account',
  '/settings/billing': 'billing',
  '/settings/ai': 'ai',
  '/settings/ai/model-selection': 'ai',
  '/settings/appearance': 'appearance',
  '/settings/storage': 'storage',
  '/settings/tooling': 'tooling',
  '/workspace/billing': 'billing',
  '/workspace/ai': 'ai',
  '/workspace/ai/model-selection': 'ai',
}

const SECTION_TO_SETTINGS_PATH: Record<SettingsDrawerSection, string> = {
  account: '/settings/account',
  billing: '/settings/billing',
  ai: '/settings/ai',
  appearance: '/settings/appearance',
  storage: '/settings/storage',
  tooling: '/settings/tooling',
}

const DEFAULT_SECTION: SettingsDrawerSection = 'account'

interface ParsedSettingsRoute {
  section: SettingsDrawerSection
  path: string
  query: string
}

function normalizePath(value: string): string {
  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`
  return withLeadingSlash.replace(/\/+$/, '') || '/'
}

function splitRoute(route?: string): { path: string; query: string } {
  if (!route) {
    return {
      path: SECTION_TO_SETTINGS_PATH[DEFAULT_SECTION],
      query: '',
    }
  }

  const normalizedRoute = route.trim()
  if (SETTINGS_SECTIONS.has(normalizedRoute as SettingsDrawerSection)) {
    return {
      path: SECTION_TO_SETTINGS_PATH[normalizedRoute as SettingsDrawerSection],
      query: '',
    }
  }

  const withSettingsPrefix = normalizedRoute.startsWith('settings/')
    ? `/${normalizedRoute}`
    : normalizedRoute

  const queryIndex = withSettingsPrefix.indexOf('?')
  if (queryIndex === -1) {
    return { path: withSettingsPrefix, query: '' }
  }

  return {
    path: withSettingsPrefix.slice(0, queryIndex),
    query: withSettingsPrefix.slice(queryIndex + 1),
  }
}

export function parseSettingsRoute(route?: string): ParsedSettingsRoute {
  const { path, query } = splitRoute(route)
  const normalizedPath = normalizePath(path)
  const section =
    SETTINGS_PATH_TO_SECTION[normalizedPath] ??
    Array.from(SETTINGS_SECTIONS).find((candidate) =>
      normalizedPath.startsWith(`${SECTION_TO_SETTINGS_PATH[candidate]}/`)
    ) ??
    DEFAULT_SECTION
  const canonicalPath = SECTION_TO_SETTINGS_PATH[section]
  const routePath = normalizedPath.startsWith(`${canonicalPath}/`)
    ? normalizedPath
    : canonicalPath

  return {
    section,
    path: routePath,
    query,
  }
}

export function getSettingsPathForSection(section: SettingsDrawerSection): string {
  return SECTION_TO_SETTINGS_PATH[section]
}

interface SettingsDrawerState {
  isOpen: boolean
  section: SettingsDrawerSection
  route: string
  open: (section?: SettingsDrawerSection) => void
  openFromRoute: (route?: string) => void
  setSection: (section: SettingsDrawerSection) => void
  close: () => void
}

export const useSettingsDrawerStore = create<SettingsDrawerState>((set) => ({
  isOpen: false,
  section: DEFAULT_SECTION,
  route: SECTION_TO_SETTINGS_PATH[DEFAULT_SECTION],

  open: (section = DEFAULT_SECTION) =>
    set({
      isOpen: true,
      section,
      route: SECTION_TO_SETTINGS_PATH[section],
    }),

  openFromRoute: (route) => {
    const parsed = parseSettingsRoute(route)
    const routeWithQuery = parsed.query ? `${parsed.path}?${parsed.query}` : parsed.path
    set({
      isOpen: true,
      section: parsed.section,
      route: routeWithQuery,
    })
  },

  setSection: (section) =>
    set({
      section,
      route: SECTION_TO_SETTINGS_PATH[section],
    }),

  close: () => set({ isOpen: false }),
}))
