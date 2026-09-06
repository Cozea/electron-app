import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

import type { AppSettings } from '@shared/electronApiTypes'

export interface ComputerUseAppSettings extends AppSettings {
  computerUseAllowGlobalPointerFallbacks?: boolean
}

/**
 * Reads Computer Use app settings from the Electron user data directory.
 * Merges saved settings with defaults, ensuring type safety for all Computer Use
 * configuration fields.
 *
 * @returns Computer Use app settings with defaults applied
 */
export function readComputerUseAppSettings(): ComputerUseAppSettings {
  const defaults = {
    projectsDirectory: path.join(app.getPath('home'), 'Developer', 'Cozea'),
    previewHeaderCompatibilityEnabled: true,
    computerUseEnabled: false,
    disabledComputerUseTools: [],
    computerUseAllowGlobalPointerFallbacks: false,
  } satisfies ComputerUseAppSettings
  try {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json')
    if (!fs.existsSync(settingsPath)) return defaults
    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Partial<ComputerUseAppSettings>
    const merged = { ...defaults, ...raw }
    return {
      ...merged,
      computerUseEnabled: raw.computerUseEnabled === true,
      disabledComputerUseTools: Array.isArray(raw.disabledComputerUseTools)
        ? raw.disabledComputerUseTools.filter((tool): tool is string => typeof tool === 'string')
        : [],
      computerUseAllowGlobalPointerFallbacks:
        raw.computerUseAllowGlobalPointerFallbacks === true,
    }
  } catch {
    return defaults
  }
}
