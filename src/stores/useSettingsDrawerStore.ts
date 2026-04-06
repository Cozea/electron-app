// @ts-nocheck
import { create } from 'zustand'
import {
  getSettingsSurfaceRoute,
  resolveSettingsSurfaceFromRoute,
  SETTINGS_SURFACE_IDS,
} from '@/lib/settings/settingsRegistry'
import type { SettingsSurfaceId } from '@/lib/settings/settingsSurfaceTypes'

export type SettingsDrawerSection = SettingsSurfaceId

const DEFAULT_SECTION: SettingsDrawerSection = 'account'
const DEFAULT_ROUTE = getSettingsSurfaceRoute(DEFAULT_SECTION, 'personal') ?? '/settings/account'

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
      path: DEFAULT_ROUTE,
      query: '',
    }
  }

  const normalizedRoute = route.trim()
  if (SETTINGS_SURFACE_IDS.has(normalizedRoute as SettingsDrawerSection)) {
    return {
      path: getSettingsSurfaceRoute(normalizedRoute as SettingsDrawerSection, 'personal') ?? DEFAULT_ROUTE,
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
  const resolvedSurface = resolveSettingsSurfaceFromRoute(normalizedPath, {
    placement: 'drawer',
  })
  const section = resolvedSurface?.surface.id ?? DEFAULT_SECTION

  return {
    section,
    path: resolvedSurface ? normalizedPath : DEFAULT_ROUTE,
    query,
  }
}

export function getSettingsPathForSection(section: SettingsDrawerSection): string {
  return getSettingsSurfaceRoute(section, 'personal') ?? DEFAULT_ROUTE
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
  route: DEFAULT_ROUTE,

  open: (section = DEFAULT_SECTION) =>
    set({
      isOpen: true,
      section,
      route: getSettingsSurfaceRoute(section, 'personal') ?? DEFAULT_ROUTE,
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
      route: getSettingsSurfaceRoute(section, 'personal') ?? DEFAULT_ROUTE,
    }),

  close: () => set({ isOpen: false }),
}))
