import { describe, expect, it } from 'vitest'

import {
  buildImportTerminalCommand,
  parseImportTerminalCompletionCode,
  selectImportTerminalProfile,
  IMPORT_TERMINAL_COMPLETION_MARKER,
} from '../src/lib/importTerminalCommand'

describe('import terminal command helpers', () => {
  it('prefers a POSIX shell profile for import commands', () => {
    const profileId = selectImportTerminalProfile('posix', [
      { id: 'default', name: 'fish', path: '/opt/homebrew/bin/fish' },
      { id: 'sh', name: 'sh', path: '/bin/sh' },
      { id: 'zsh', name: 'zsh', path: '/bin/zsh' },
    ])

    expect(profileId).toBe('sh')
  })

  it('wraps POSIX commands so the shell exits after the install finishes', () => {
    const plan = buildImportTerminalCommand('npm install --no-audit --no-fund', 'posix', [
      { id: 'sh', name: 'sh', path: '/bin/sh' },
    ])

    expect(plan.profileId).toBe('sh')
    expect(plan.commandLine).toContain('npm install --no-audit --no-fund;')
    expect(plan.commandLine).toContain(`${IMPORT_TERMINAL_COMPLETION_MARKER}:%s`)
    expect(plan.commandLine).toContain('exit "$__cozea_import_exit_code"')
  })

  it('parses the inline completion marker from terminal output', () => {
    const code = parseImportTerminalCompletionCode(
      `added 565 packages\n${IMPORT_TERMINAL_COMPLETION_MARKER}:0\n`
    )

    expect(code).toBe(0)
  })
})
