import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'

export type NativeProjectFramework = 'expo' | 'react-native' | 'unknown'
export type NativeProjectPackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun'

interface PackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  scripts?: Record<string, string>
}

export interface NativeProjectProfile {
  framework: NativeProjectFramework
  hasExpoDevClient: boolean
  packageManager: NativeProjectPackageManager
  scripts: Record<string, string>
}

export interface CommandInvocation {
  command: string
  args: string[]
}

function resolvePackageManagerExecutable(packageManager: NativeProjectPackageManager): string {
  if (process.platform !== 'win32') {
    return packageManager
  }

  if (packageManager === 'bun') {
    return 'bun.exe'
  }

  return `${packageManager}.cmd`
}

async function readPackageJson(projectPath: string): Promise<PackageJson | null> {
  try {
    const content = await fs.readFile(path.join(projectPath, 'package.json'), 'utf8')
    return JSON.parse(content) as PackageJson
  } catch {
    return null
  }
}

async function detectPackageManager(projectPath: string): Promise<NativeProjectPackageManager> {
  const candidates: Array<{ file: string; packageManager: NativeProjectPackageManager }> = [
    { file: 'bun.lockb', packageManager: 'bun' },
    { file: 'pnpm-lock.yaml', packageManager: 'pnpm' },
    { file: 'yarn.lock', packageManager: 'yarn' },
    { file: 'package-lock.json', packageManager: 'npm' },
  ]

  for (const candidate of candidates) {
    try {
      await fs.access(path.join(projectPath, candidate.file))
      return candidate.packageManager
    } catch {
      // Try the next candidate.
    }
  }

  return 'npm'
}

export async function loadNativeProjectProfile(projectPath: string): Promise<NativeProjectProfile> {
  const [packageJson, packageManager] = await Promise.all([
    readPackageJson(projectPath),
    detectPackageManager(projectPath),
  ])

  const dependencies = {
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {}),
  }

  let framework: NativeProjectFramework = 'unknown'
  if (dependencies.expo) {
    framework = 'expo'
  } else if (dependencies['react-native']) {
    framework = 'react-native'
  }

  return {
    framework,
    hasExpoDevClient: Boolean(dependencies['expo-dev-client']),
    packageManager,
    scripts: packageJson?.scripts ?? {},
  }
}

export function hasScript(profile: NativeProjectProfile, scriptName: string): boolean {
  return Boolean(profile.scripts[scriptName]?.trim())
}

export function buildScriptInvocation(
  packageManager: NativeProjectPackageManager,
  scriptName: string,
  extraArgs: string[] = [],
): CommandInvocation {
  const command = resolvePackageManagerExecutable(packageManager)

  if (packageManager === 'yarn') {
    return {
      command,
      args: [scriptName, ...extraArgs],
    }
  }

  if (packageManager === 'bun') {
    return {
      command,
      args: ['run', scriptName, ...extraArgs],
    }
  }

  if (scriptName === 'start') {
    return {
      command,
      args: ['start', ...(extraArgs.length > 0 ? ['--', ...extraArgs] : [])],
    }
  }

  return {
    command,
    args: ['run', scriptName, ...(extraArgs.length > 0 ? ['--', ...extraArgs] : [])],
  }
}

export async function runForegroundCommand(options: {
  cwd: string
  command: string
  args: string[]
  env?: NodeJS.ProcessEnv
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stderrTail = ''
    let stdoutTail = ''
    const appendTail = (current: string, chunk: Buffer) => {
      const next = `${current}${chunk.toString('utf8')}`
      return next.length > 8_000 ? next.slice(-8_000) : next
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutTail = appendTail(stdoutTail, chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrTail = appendTail(stderrTail, chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error((stderrTail || stdoutTail || `Command exited with code ${code}`).trim()))
    })
  })
}
