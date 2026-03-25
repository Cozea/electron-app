import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { app } from 'electron'

function getFallbackCacheRoot(): string {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Caches', 'Cozea')
  }

  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Cozea')
  }

  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'cozea')
}

export function getManagedIosDeviceSetPath(): string {
  let cacheRoot = getFallbackCacheRoot()

  try {
    if (app.isReady()) {
      cacheRoot = app.getPath('cache')
    }
  } catch {
    // Fall back to a deterministic cache location before Electron is ready.
  }

  const deviceSetPath = path.join(cacheRoot, 'Devices', 'iOS')
  fs.mkdirSync(deviceSetPath, { recursive: true })
  return deviceSetPath
}
