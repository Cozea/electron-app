import { accessSync, constants, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { app, shell } from 'electron'

import type { AvailableExternalEditor, ExternalEditorId } from '../../../../shared/electronApiTypes'

interface EditorSpec {
  id: Exclude<ExternalEditorId, 'cozea'>
  name: string
  strategy: 'goto' | 'zed' | 'jetbrains' | 'path' | 'finder'
  macCommandPaths?: string[]
  macAppPaths?: string[]
  windowsPaths?: string[]
  linuxCommands?: string[]
}

interface LaunchTarget {
  kind: 'macos-app' | 'command'
  value: string
}

interface DetectionResult {
  editors: AvailableExternalEditor[]
  targets: Map<Exclude<ExternalEditorId, 'cozea'>, { target: LaunchTarget; strategy: EditorSpec['strategy'] }>
}

const JETBRAINS_APP_DIRS = [
  '/Applications',
  join(homedir(), 'Applications'),
]

const EDITOR_SPECS: EditorSpec[] = [
  {
    id: 'vscode',
    name: 'VS Code',
    strategy: 'goto',
    macCommandPaths: [
      '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
      join(homedir(), 'Applications', 'Visual Studio Code.app', 'Contents', 'Resources', 'app', 'bin', 'code'),
    ],
    macAppPaths: [
      '/Applications/Visual Studio Code.app',
      join(homedir(), 'Applications', 'Visual Studio Code.app'),
    ],
    windowsPaths: [
      '%LocalAppData%\\Programs\\Microsoft VS Code\\Code.exe',
      '%ProgramFiles%\\Microsoft VS Code\\Code.exe',
      '%ProgramFiles(x86)%\\Microsoft VS Code\\Code.exe',
    ],
    linuxCommands: ['code'],
  },
  {
    id: 'vscode-insiders',
    name: 'VS Code Insiders',
    strategy: 'goto',
    macCommandPaths: [
      '/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code-insiders',
      join(homedir(), 'Applications', 'Visual Studio Code - Insiders.app', 'Contents', 'Resources', 'app', 'bin', 'code-insiders'),
    ],
    macAppPaths: [
      '/Applications/Visual Studio Code - Insiders.app',
      join(homedir(), 'Applications', 'Visual Studio Code - Insiders.app'),
    ],
    windowsPaths: [
      '%LocalAppData%\\Programs\\Microsoft VS Code Insiders\\Code - Insiders.exe',
      '%ProgramFiles%\\Microsoft VS Code Insiders\\Code - Insiders.exe',
    ],
    linuxCommands: ['code-insiders'],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    strategy: 'goto',
    macCommandPaths: [
      '/Applications/Cursor.app/Contents/Resources/app/bin/cursor',
      join(homedir(), 'Applications', 'Cursor.app', 'Contents', 'Resources', 'app', 'bin', 'cursor'),
    ],
    macAppPaths: [
      '/Applications/Cursor.app',
      join(homedir(), 'Applications', 'Cursor.app'),
    ],
    windowsPaths: [
      '%LocalAppData%\\Programs\\Cursor\\Cursor.exe',
    ],
    linuxCommands: ['cursor'],
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    strategy: 'goto',
    macCommandPaths: [
      '/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf',
      join(homedir(), 'Applications', 'Windsurf.app', 'Contents', 'Resources', 'app', 'bin', 'windsurf'),
    ],
    macAppPaths: [
      '/Applications/Windsurf.app',
      join(homedir(), 'Applications', 'Windsurf.app'),
    ],
    windowsPaths: [
      '%LocalAppData%\\Programs\\Windsurf\\Windsurf.exe',
    ],
    linuxCommands: ['windsurf'],
  },
  {
    id: 'vscodium',
    name: 'VSCodium',
    strategy: 'goto',
    macCommandPaths: [
      '/Applications/VSCodium.app/Contents/Resources/app/bin/codium',
      join(homedir(), 'Applications', 'VSCodium.app', 'Contents', 'Resources', 'app', 'bin', 'codium'),
    ],
    macAppPaths: [
      '/Applications/VSCodium.app',
      join(homedir(), 'Applications', 'VSCodium.app'),
    ],
    windowsPaths: [
      '%LocalAppData%\\Programs\\VSCodium\\VSCodium.exe',
      '%ProgramFiles%\\VSCodium\\VSCodium.exe',
    ],
    linuxCommands: ['codium'],
  },
  {
    id: 'zed',
    name: 'Zed',
    strategy: 'zed',
    macCommandPaths: [
      '/Applications/Zed.app/Contents/MacOS/zed',
      '/Applications/Zed.app/Contents/MacOS/Zed',
      join(homedir(), 'Applications', 'Zed.app', 'Contents', 'MacOS', 'zed'),
      join(homedir(), 'Applications', 'Zed.app', 'Contents', 'MacOS', 'Zed'),
    ],
    macAppPaths: [
      '/Applications/Zed.app',
      join(homedir(), 'Applications', 'Zed.app'),
    ],
    windowsPaths: [
      '%LocalAppData%\\Programs\\Zed\\Zed.exe',
    ],
    linuxCommands: ['zed'],
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    strategy: 'path',
    macAppPaths: [
      '/Applications/Antigravity.app',
      '/Applications/Anti Gravity.app',
      join(homedir(), 'Applications', 'Antigravity.app'),
      join(homedir(), 'Applications', 'Anti Gravity.app'),
    ],
    windowsPaths: [
      '%LocalAppData%\\Programs\\Antigravity\\Antigravity.exe',
    ],
  },
  {
    id: 'webstorm',
    name: 'WebStorm',
    strategy: 'jetbrains',
  },
  {
    id: 'intellij-idea',
    name: 'IntelliJ IDEA',
    strategy: 'jetbrains',
  },
  {
    id: 'phpstorm',
    name: 'PhpStorm',
    strategy: 'jetbrains',
  },
  {
    id: 'pycharm',
    name: 'PyCharm',
    strategy: 'jetbrains',
  },
  {
    id: 'rider',
    name: 'Rider',
    strategy: 'jetbrains',
  },
  {
    id: 'goland',
    name: 'GoLand',
    strategy: 'jetbrains',
  },
  {
    id: 'rubymine',
    name: 'RubyMine',
    strategy: 'jetbrains',
  },
  {
    id: 'clion',
    name: 'CLion',
    strategy: 'jetbrains',
  },
  {
    id: 'datagrip',
    name: 'DataGrip',
    strategy: 'jetbrains',
  },
  {
    id: 'finder',
    name: 'Finder',
    strategy: 'finder',
    macAppPaths: [
      '/System/Library/CoreServices/Finder.app',
    ],
  },
]

const JETBRAINS_MAC_APP_CANDIDATES: Record<
  Extract<EditorSpec['id'], 'webstorm' | 'intellij-idea' | 'phpstorm' | 'pycharm' | 'rider' | 'goland' | 'rubymine' | 'clion' | 'datagrip'>,
  Array<{ appName: string; binaryName: string }>
> = {
  webstorm: [
    { appName: 'WebStorm.app', binaryName: 'webstorm' },
    { appName: 'WebStorm EAP.app', binaryName: 'webstorm' },
  ],
  'intellij-idea': [
    { appName: 'IntelliJ IDEA.app', binaryName: 'idea' },
    { appName: 'IntelliJ IDEA CE.app', binaryName: 'idea' },
    { appName: 'IntelliJ IDEA Ultimate.app', binaryName: 'idea' },
  ],
  phpstorm: [
    { appName: 'PhpStorm.app', binaryName: 'phpstorm' },
  ],
  pycharm: [
    { appName: 'PyCharm.app', binaryName: 'pycharm' },
    { appName: 'PyCharm CE.app', binaryName: 'pycharm' },
    { appName: 'PyCharm Professional.app', binaryName: 'pycharm' },
  ],
  rider: [
    { appName: 'Rider.app', binaryName: 'rider' },
  ],
  goland: [
    { appName: 'GoLand.app', binaryName: 'goland' },
  ],
  rubymine: [
    { appName: 'RubyMine.app', binaryName: 'rubymine' },
  ],
  clion: [
    { appName: 'CLion.app', binaryName: 'clion' },
  ],
  datagrip: [
    { appName: 'DataGrip.app', binaryName: 'datagrip' },
  ],
}

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

function commandExistsSync(command: string): boolean {
  const locator = process.platform === 'win32' ? 'where' : 'which'
  const result = spawnSync(locator, [command], {
    stdio: 'ignore',
  })
  return result.status === 0
}

function resolveJetBrainsTarget(editorId: EditorSpec['id']): LaunchTarget | null {
  if (process.platform !== 'darwin') return null
  const candidates = JETBRAINS_MAC_APP_CANDIDATES[editorId as keyof typeof JETBRAINS_MAC_APP_CANDIDATES]
  if (!candidates) return null

  for (const appDir of JETBRAINS_APP_DIRS) {
    for (const candidate of candidates) {
      const binaryPath = join(appDir, candidate.appName, 'Contents', 'MacOS', candidate.binaryName)
      if (pathExists(binaryPath)) {
        return { kind: 'command', value: binaryPath }
      }
      const appPath = join(appDir, candidate.appName)
      if (pathExists(appPath)) {
        return { kind: 'macos-app', value: appPath }
      }
    }
  }

  return null
}

function resolveLaunchTarget(spec: EditorSpec): { target: LaunchTarget; strategy: EditorSpec['strategy'] } | null {
  if (spec.strategy === 'jetbrains') {
    const target = resolveJetBrainsTarget(spec.id)
    return target ? { target, strategy: spec.strategy } : null
  }

  if (process.platform === 'darwin') {
    for (const commandPath of spec.macCommandPaths ?? []) {
      if (pathExists(commandPath)) {
        return {
          target: { kind: 'command', value: commandPath },
          strategy: spec.strategy,
        }
      }
    }
    for (const appPath of spec.macAppPaths ?? []) {
      if (pathExists(appPath)) {
        return {
          target: { kind: 'macos-app', value: appPath },
          strategy: spec.strategy,
        }
      }
    }
    return null
  }

  if (process.platform === 'win32') {
    for (const candidateTemplate of spec.windowsPaths ?? []) {
      const candidatePath = expandWindowsEnvPath(candidateTemplate)
      if (candidatePath && pathExists(candidatePath)) {
        return {
          target: { kind: 'command', value: candidatePath },
          strategy: spec.strategy,
        }
      }
    }
    return null
  }

  for (const command of spec.linuxCommands ?? []) {
    if (commandExistsSync(command)) {
      return {
        target: { kind: 'command', value: command },
        strategy: spec.strategy,
      }
    }
  }

  return null
}

function detectEditors(): DetectionResult {
  const editors: AvailableExternalEditor[] = []
  const targets = new Map<Exclude<ExternalEditorId, 'cozea'>, { target: LaunchTarget; strategy: EditorSpec['strategy'] }>()

  for (const spec of EDITOR_SPECS) {
    const resolved = resolveLaunchTarget(spec)
    if (!resolved) continue

    editors.push({
      id: spec.id,
      name: spec.name,
    })
    targets.set(spec.id, resolved)
  }

  return {
    editors,
    targets,
  }
}

function getDetectionResult(): DetectionResult {
  if (!detectionCache) {
    detectionCache = detectEditors()
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
      child.once('spawn', () => {
        child.unref()
        resolve()
      })
    } catch (error) {
      reject(error)
    }
  })
}

function buildEditorArgs(
  strategy: EditorSpec['strategy'],
  filePath: string,
  line?: number,
  column?: number
): string[] {
  if (strategy === 'goto') {
    const suffix = line
      ? `${filePath}:${line}${column ? `:${column}` : ''}`
      : filePath
    return ['--goto', suffix]
  }

  if (strategy === 'zed') {
    const suffix = line
      ? `${filePath}:${line}${column ? `:${column}` : ''}`
      : filePath
    return [suffix]
  }

  if (strategy === 'jetbrains') {
    if (line) {
      return ['--line', String(line), filePath]
    }
    return [filePath]
  }

  return [filePath]
}

async function launchWithTarget(target: LaunchTarget, args: string[]): Promise<void> {
  if (target.kind === 'macos-app') {
    await spawnDetached('open', ['-a', target.value, ...args])
    return
  }

  await spawnDetached(target.value, args)
}

export function listAvailableEditors(): AvailableExternalEditor[] {
  return getDetectionResult().editors
}

export async function getEditorAppIcon(editorId: ExternalEditorId): Promise<Electron.NativeImage | undefined> {
  const resolved = getDetectionResult().targets.get(editorId as Exclude<ExternalEditorId, 'cozea'>)
  if (!resolved) return undefined

  try {
    if (resolved.target.kind === 'macos-app') {
      const icon = await app.getFileIcon(resolved.target.value, { size: 'small' })
      if (!icon.isEmpty()) return icon
    }
  } catch {
    // ignore icon retrieval error
  }
  return undefined
}

export async function openFileInExternalEditor(options: {
  editorId: Exclude<ExternalEditorId, 'cozea'>
  filePath: string
  line?: number
  column?: number
}): Promise<void> {
  const resolved = getDetectionResult().targets.get(options.editorId)
  if (!resolved) {
    throw new Error(`Editor not available: ${options.editorId}`)
  }

  if (resolved.strategy === 'finder') {
    try {
      const stats = statSync(options.filePath)
      if (stats.isDirectory()) {
        const error = await shell.openPath(options.filePath)
        if (error) throw new Error(error)
      } else {
        shell.showItemInFolder(options.filePath)
      }
      return
    } catch {
      const error = await shell.openPath(options.filePath)
      if (error) throw new Error(error)
      return
    }
  }

  const args = buildEditorArgs(resolved.strategy, options.filePath, options.line, options.column)
  await launchWithTarget(resolved.target, args)
}
