import fs from 'node:fs'
import path from 'node:path'

export interface ProjectEvidence {
  files: string[]
  scripts: string[]
  lockfiles: string[]
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
]

export function collectProjectEvidence(projectPath: string): ProjectEvidence {
  const files: string[] = []
  const scripts: string[] = []
  const lockfiles: string[] = []

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
      for (const name of Object.keys(pkg.scripts ?? {})) {
        scripts.push(name)
      }
    } catch {
      // Ignore malformed package.json in capability scaffolding.
    }
  }

  return { files, scripts, lockfiles }
}
