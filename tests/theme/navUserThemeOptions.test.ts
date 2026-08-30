import { describe, expect, it } from 'vitest'

import {
  NAV_USER_THEME_OPTIONS,
  resolveNavUserThemeAction,
} from '../../apps/desktop/src/components/navUserThemeOptions'
import { getTranslation } from '../../apps/desktop/src/lib/i18n'
import { ALL_THEMES } from '../../apps/desktop/src/lib/theme'

describe('quick theme menu options', () => {
  it('offers every app theme followed by the system preference', () => {
    expect(NAV_USER_THEME_OPTIONS.map((option) => option.theme)).toEqual([
      ...ALL_THEMES,
      'system',
    ])
  })

  it('routes every menu action to its theme', () => {
    for (const option of NAV_USER_THEME_OPTIONS) {
      expect(resolveNavUserThemeAction(option.id)).toBe(option.theme)
    }

    expect(resolveNavUserThemeAction('account-settings')).toBeNull()
    expect(resolveNavUserThemeAction(null)).toBeNull()
  })

  it('provides localized labels for every option', () => {
    for (const option of NAV_USER_THEME_OPTIONS) {
      expect(getTranslation('en', option.labelKey)).not.toBe(option.labelKey)
      expect(getTranslation('es', option.labelKey)).not.toBe(option.labelKey)
    }
  })
})
