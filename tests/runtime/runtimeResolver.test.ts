import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  resolveCommandWithRuntime,
  resolveRuntimeHealth,
} from '../../apps/desktop/electron/runtime/runtimeResolver'

const originalPath = process.env.PATH
const temporaryDirectories: string[] = []

afterEach(() => {
  process.env.PATH = originalPath
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function installFakeExecutable(name: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cozea-runtime-resolver-'))
  temporaryDirectories.push(directory)
  const executablePath = path.join(directory, name)
  fs.writeFileSync(executablePath, '#!/bin/sh\nexit 0\n')
  fs.chmodSync(executablePath, 0o755)
  process.env.PATH = directory
  return executablePath
}

describe('runtimeResolver', () => {
  it('recognizes python3 as the executable for a python3 command', () => {
    const executablePath = installFakeExecutable('python3')

    expect(resolveRuntimeHealth('python').executablePath).toBe(executablePath)
    expect(resolveCommandWithRuntime('python3 -m http.server 4173')).toMatchObject({
      success: true,
      status: 'completed',
      runtime: 'python',
      executablePath,
    })
  })

  it('does not claim a python command is runnable when only python3 exists', () => {
    installFakeExecutable('python3')

    expect(resolveCommandWithRuntime('python -m http.server 4173')).toMatchObject({
      success: false,
      status: 'failed',
      runtime: 'python',
    })
  })
})
