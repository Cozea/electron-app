import fs from 'node:fs'
import path from 'node:path'

export interface ProjectEvidence {
  files: string[]
  scripts: string[]
  lockfiles: string[]
  packageScripts: Record<string, string>
  readmeCommands: string[]
}

const PROBE_FILES = [
  'package.json',
  'app.json',
  'app.config.js',
  'app.config.ts',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'pyproject.toml',
  'requirements.txt',
  'Cargo.toml',
  'go.mod',
  'index.html',
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.ts',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'astro.config.js',
  'astro.config.mjs',
  'astro.config.ts',
  'svelte.config.js',
  'svelte.config.ts',
]

const MAX_README_BYTES = 256 * 1024
const SAFE_README_COMMAND = /^(?:npm(?:\s+run)?|pnpm(?:\s+run)?|yarn(?:\s+run)?|bun(?:\s+run)?|python3?\s+-m|cargo\s+run\b|go\s+run\b)[^;&|`$<>]*$/i

function collectReadmeCommands(projectPath: string): string[] {
  let entries: string[] = []
  try {
    entries = fs.readdirSync(projectPath)
  } catch {
    return []
  }

  const readmeName = entries.find((entry) => /^readme(?:\.[a-z0-9_-]+)?$/i.test(entry))
  if (!readmeName) return []

  try {
    const readmePath = path.join(projectPath, readmeName)
    const stat = fs.statSync(readmePath)
    if (!stat.isFile() || stat.size > MAX_README_BYTES) return []

    const content = fs.readFileSync(readmePath, 'utf-8')
    const commands = new Set<string>()
    for (const line of content.split(/\r?\n/)) {
      const candidate = line
        .trim()
        .replace(/^\$\s*/, '')
        .replace(/^`|`$/g, '')
        .trim()
      if (candidate.length > 0 && candidate.length <= 240 && SAFE_README_COMMAND.test(candidate)) {
        commands.add(candidate)
      }
    }
    return Array.from(commands).slice(0, 12)
  } catch {
    return []
  }
}

export function collectProjectEvidence(projectPath: string): ProjectEvidence {
  const files: string[] = []
  const scripts: string[] = []
  const lockfiles: string[] = []
  const packageScripts: Record<string, string> = {}

  for (const candidate of PROBE_FILES) {
    const fullPath = path.join(projectPath, candidate)
    if (fs.existsSync(fullPath)) {
      files.push(candidate)
      if (candidate.includes('lock')) lockfiles.push(candidate)
    }
  }

  const packageJsonPath = path.join(projectPath, 'package.json')
  if (fs.existsSync(packageJsonPath)) {
    try {
      const raw = fs.readFileSync(packageJsonPath, 'utf-8')
      const pkg = JSON.parse(raw) as { scripts?: Record<string, string> }
      for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
        scripts.push(name)
        if (typeof command === 'string' && command.trim().length > 0) {
          packageScripts[name] = command.trim().slice(0, 512)
        }
      }
    } catch {
      // Ignore malformed package.json in capability scaffolding.
    }
  }

  return {
    files,
    scripts,
    lockfiles,
    packageScripts,
    readmeCommands: collectReadmeCommands(projectPath),
  }
}
