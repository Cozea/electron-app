import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

import type { AppSettings } from '../../../../shared/electronApiTypes'

export type ComputerUseAppSettings = AppSettings & {
  computerUseAllowGlobalPointerFallbacks?: boolean
}

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
    return { ...defaults, ...raw }
  } catch {
    return defaults
  }
}
