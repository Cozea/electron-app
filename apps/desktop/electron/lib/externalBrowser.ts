import { accessSync, constants } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { shell } from 'electron'

import type {
  AvailableExternalBrowser,
  AvailableExternalBrowserResult,
  ExternalBrowserId,
} from '../../shared/electronApiTypes'

interface BrowserSpec {
  id: Exclude<ExternalBrowserId, 'system'>
  name: string
  macAppPaths?: string[]
  windowsPaths?: string[]
  linuxCommands?: string[]
}

interface LaunchTarget {
  kind: 'macos-app' | 'command'
  value: string
}

interface DetectionResult {
  browsers: AvailableExternalBrowser[]
  defaultBrowserId: ExternalBrowserId
  targets: Map<Exclude<ExternalBrowserId, 'system'>, LaunchTarget>
}

const BROWSER_SPECS: BrowserSpec[] = [
  {
    id: 'safari',
    name: 'Safari',
    macAppPaths: [
      '/Applications/Safari.app',
      join(homedir(), 'Applications', 'Safari.app'),
    ],
  },
  {
    id: 'chrome',
    name: 'Google Chrome',
    macAppPaths: [
      '/Applications/Google Chrome.app',
      join(homedir(), 'Applications', 'Google Chrome.app'),
    ],
    windowsPaths: [
      '%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe',
      '%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe',
      '%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe',
    ],
    linuxCommands: ['google-chrome-stable', 'google-chrome', 'chromium-browser', 'chromium'],
  },
  {
    id: 'arc',
    name: 'Arc',
    macAppPaths: [
      '/Applications/Arc.app',
      join(homedir(), 'Applications', 'Arc.app'),
    ],
    windowsPaths: [
      '%LocalAppData%\\Programs\\Arc\\Arc.exe',
    ],
  },
  {
    id: 'firefox',
    name: 'Firefox',
    macAppPaths: [
      '/Applications/Firefox.app',
      join(homedir(), 'Applications', 'Firefox.app'),
    ],
    windowsPaths: [
      '%ProgramFiles%\\Mozilla Firefox\\firefox.exe',
      '%ProgramFiles(x86)%\\Mozilla Firefox\\firefox.exe',
      '%LocalAppData%\\Mozilla Firefox\\firefox.exe',
    ],
    linuxCommands: ['firefox'],
  },
  {
    id: 'edge',
    name: 'Microsoft Edge',
    macAppPaths: [
      '/Applications/Microsoft Edge.app',
      join(homedir(), 'Applications', 'Microsoft Edge.app'),
    ],
    windowsPaths: [
      '%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe',
      '%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe',
      '%LocalAppData%\\Microsoft\\Edge\\Application\\msedge.exe',
    ],
    linuxCommands: ['microsoft-edge', 'microsoft-edge-stable'],
  },
  {
    id: 'brave',
    name: 'Brave',
    macAppPaths: [
      '/Applications/Brave Browser.app',
      join(homedir(), 'Applications', 'Brave Browser.app'),
    ],
    windowsPaths: [
      '%ProgramFiles%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      '%ProgramFiles(x86)%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      '%LocalAppData%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    ],
    linuxCommands: ['brave-browser', 'brave'],
  },
]

let detectionCache: DetectionResult | null = null

function pathExists(filePath: string): boolean {
  try {
    accessSync(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function expandWindowsEnvPath(template: string): string {
  return template.replace(/%([^%]+)%/g, (_match, envName: string) => process.env[envName] ?? '')
}

function commandExists(command: string): boolean {
  const locator = process.platform === 'win32' ? 'where' : 'which'
  const result = spawnSync(locator, [command], {
    stdio: 'ignore',
  })
  return result.status === 0
}

function mapKnownBrowserTokenToId(rawValue: string | null | undefined): ExternalBrowserId {
  const normalized = rawValue?.toLowerCase() ?? ''
  if (!normalized) return 'system'

  if (normalized.includes('arc')) return 'arc'
  if (normalized.includes('brave')) return 'brave'
  if (normalized.includes('chrome') || normalized.includes('chromium')) return 'chrome'
  if (normalized.includes('firefox')) return 'firefox'
  if (normalized.includes('edge')) return 'edge'
  if (normalized.includes('safari')) return 'safari'
  return 'system'
}

function detectDefaultBrowserId(): ExternalBrowserId {
  if (process.platform === 'darwin') {
    const result = spawnSync(
      'plutil',
      [
        '-extract',
        'LSHandlers',
        'json',
        '-o',
        '-',
        join(homedir(), 'Library', 'Preferences', 'com.apple.LaunchServices', 'com.apple.launchservices.secure.plist'),
      ],
      { encoding: 'utf8' }
    )
    if (result.status === 0 && result.stdout) {
      try {
        const handlers = JSON.parse(result.stdout) as Array<Record<string, unknown>>
        const httpsHandler = handlers.find((handler) => handler.LSHandlerURLScheme === 'https')
        const bundleId = typeof httpsHandler?.LSHandlerRoleAll === 'string'
          ? httpsHandler.LSHandlerRoleAll
          : typeof httpsHandler?.LSHandlerRoleViewer === 'string'
            ? httpsHandler.LSHandlerRoleViewer
            : null
        return mapKnownBrowserTokenToId(bundleId)
      } catch {
        return 'system'
      }
    }
    return 'system'
  }

  if (process.platform === 'win32') {
    const result = spawnSync(
      'reg',
      [
        'query',
        'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice',
        '/v',
        'ProgId',
      ],
      { encoding: 'utf8' }
    )
    if (result.status === 0) {
      return mapKnownBrowserTokenToId(result.stdout)
    }
    return 'system'
  }

  const result = spawnSync('xdg-settings', ['get', 'default-web-browser'], {
    encoding: 'utf8',
  })
  if (result.status === 0) {
    return mapKnownBrowserTokenToId(result.stdout.trim())
  }
  return 'system'
}

function resolveLaunchTarget(spec: BrowserSpec): LaunchTarget | null {
  if (process.platform === 'darwin') {
    for (const appPath of spec.macAppPaths ?? []) {
      if (pathExists(appPath)) {
        return { kind: 'macos-app', value: appPath }
      }
    }
    return null
  }

  if (process.platform === 'win32') {
    for (const candidateTemplate of spec.windowsPaths ?? []) {
      const candidatePath = expandWindowsEnvPath(candidateTemplate)
      if (candidatePath && pathExists(candidatePath)) {
        return { kind: 'command', value: candidatePath }
      }
    }
    return null
  }

  for (const command of spec.linuxCommands ?? []) {
    if (commandExists(command)) {
      return { kind: 'command', value: command }
    }
  }

  return null
}

function detectBrowsers(): DetectionResult {
  const browsers: AvailableExternalBrowser[] = [
    { id: 'system', name: 'System Default' },
  ]
  const targets = new Map<Exclude<ExternalBrowserId, 'system'>, LaunchTarget>()
  const detectedDefaultBrowserId = detectDefaultBrowserId()

  for (const spec of BROWSER_SPECS) {
    const launchTarget = resolveLaunchTarget(spec)
    if (!launchTarget) continue

    browsers.push({
      id: spec.id,
      name: spec.name,
    })
    targets.set(spec.id, launchTarget)
  }

  return {
    browsers,
    defaultBrowserId: targets.has(detectedDefaultBrowserId as Exclude<ExternalBrowserId, 'system'>)
      ? detectedDefaultBrowserId
      : 'system',
    targets,
  }
}

function getDetectionResult(): DetectionResult {
  if (!detectionCache) {
    detectionCache = detectBrowsers()
  }
  return detectionCache
}

function spawnDetached(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const child = spawn(command, args, {
        detached: true,
        stdio: 'ignore',
      })
      child.once('error', reject)
      child.unref()
      resolve()
    } catch (error) {
      reject(error)
    }
  })
}

async function launchWithTarget(target: LaunchTarget, url: string): Promise<void> {
  if (target.kind === 'macos-app') {
    await spawnDetached('open', ['-a', target.value, url])
    return
  }

  await spawnDetached(target.value, [url])
}

export function listAvailableBrowsers(): AvailableExternalBrowserResult {
  const detection = getDetectionResult()
  return {
    browsers: detection.browsers,
    defaultBrowserId: detection.defaultBrowserId,
  }
}

export async function openUrlInBrowser(url: string, browserId: ExternalBrowserId = 'system'): Promise<void> {
  if (browserId === 'system') {
    await shell.openExternal(url)
    return
  }

  const target = getDetectionResult().targets.get(browserId)
  if (!target) {
    await shell.openExternal(url)
    return
  }

  await launchWithTarget(target, url)
}
