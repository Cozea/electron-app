import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { app, shell, systemPreferences } from 'electron'
import type { ComputerUseDiagnostics } from '../../../../shared/electronApiTypes'

const execFileAsync = promisify(execFile)

export class ComputerUseService {
  private static instance: ComputerUseService | null = null

  static getInstance(): ComputerUseService {
    if (!this.instance) {
      this.instance = new ComputerUseService()
    }
    return this.instance
  }

  async resolveCliPath(configuredPath?: string): Promise<string | null> {
    if (configuredPath && fs.existsSync(configuredPath)) {
      return configuredPath
    }

    // 1. Check bundled/local node_modules in Cozea
    const appPath = typeof app?.getAppPath === 'function' ? app.getAppPath() : process.cwd()
    const bundledCandidates = [
      path.join(appPath, 'node_modules', '.bin', 'open-computer-use'),
      path.join(appPath, 'node_modules', '.bin', 'ocu'),
      path.join(process.cwd(), 'node_modules', '.bin', 'open-computer-use'),
      path.join(process.cwd(), 'node_modules', '.bin', 'ocu'),
      path.join(__dirname, '..', '..', '..', '..', 'node_modules', '.bin', 'open-computer-use'),
      path.join(__dirname, '..', '..', '..', '..', 'node_modules', '.bin', 'ocu'),
    ]
    for (const p of bundledCandidates) {
      if (fs.existsSync(p)) {
        return p
      }
    }

    const whichCmd = process.platform === 'win32' ? 'where' : 'which'
    for (const bin of ['open-computer-use', 'ocu']) {
      try {
        const { stdout } = await execFileAsync(whichCmd, [bin])
        const first = stdout.split('\n')[0]?.trim()
        if (first && fs.existsSync(first)) {
          return first
        }
      } catch {
        // Not found via which
      }
    }

    const home = os.homedir()
    const searchDirs: string[] = [
      path.join(home, '.bun', 'bin'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
      path.join(home, '.local', 'bin'),
    ]

    const nvmDir = path.join(home, '.nvm', 'versions', 'node')
    if (fs.existsSync(nvmDir)) {
      try {
        const versions = fs.readdirSync(nvmDir)
        versions.sort().reverse()
        for (const v of versions) {
          searchDirs.push(path.join(nvmDir, v, 'bin'))
        }
      } catch {
        // ignore
      }
    }

    for (const dir of searchDirs) {
      for (const bin of ['open-computer-use', 'ocu']) {
        const full = path.join(dir, bin)
        if (fs.existsSync(full)) {
          return full
        }
      }
    }

    return null
  }

  async getDiagnostics(configuredPath?: string): Promise<ComputerUseDiagnostics> {
    const cliPath = await this.resolveCliPath(configuredPath)
    let version: string | undefined
    let error: string | undefined

    if (cliPath) {
      try {
        const { stdout } = await execFileAsync(cliPath, ['--version'], { timeout: 3000 })
        version = stdout.trim()
      } catch (err) {
        error = err instanceof Error ? err.message : String(err)
      }
    }

    const isMac = process.platform === 'darwin'
    const accessibility = isMac ? systemPreferences.isTrustedAccessibilityClient(false) : true
    const screenRecording = isMac ? systemPreferences.getMediaAccessStatus('screen') === 'granted' : true

    return {
      installed: Boolean(cliPath),
      version,
      path: cliPath ?? undefined,
      accessibility,
      screenRecording,
      error,
    }
  }

  async openPermissionSettings(target: 'accessibility' | 'screenRecording'): Promise<void> {
    if (process.platform !== 'darwin') return

    if (target === 'accessibility') {
      systemPreferences.isTrustedAccessibilityClient(true)
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')
    } else if (target === 'screenRecording') {
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
    }
  }

  async syncProviderConfigs(enabled: boolean, disabledTools?: string[]): Promise<void> {
    const cliPath = await this.resolveCliPath()
    if (enabled && !cliPath) {
      console.warn('[ComputerUse] Cannot sync provider configs: open-computer-use CLI not found.')
      return
    }
    const bin = cliPath ?? 'open-computer-use'
    const home = os.homedir()
    const disabledSet = new Set(disabledTools ?? [])

    // 1. Claude (~/.claude.json)
    try {
      const claudePath = path.join(home, '.claude.json')
      if (fs.existsSync(claudePath)) {
        const raw = fs.readFileSync(claudePath, 'utf8')
        const data = JSON.parse(raw)
        if (enabled) {
          data.mcpServers = data.mcpServers || {}
          data.mcpServers['open-computer-use'] = {
            type: 'stdio',
            command: bin,
            args: ['mcp'],
          }
        } else {
          if (data.mcpServers && data.mcpServers['open-computer-use']) {
            delete data.mcpServers['open-computer-use']
          }
        }
        fs.writeFileSync(claudePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
      }
    } catch (err) {
      console.warn('[ComputerUse] Failed to sync Claude config:', err)
    }

    // 2. OpenCode (~/.config/opencode/opencode.json)
    try {
      const openCodePath = path.join(home, '.config', 'opencode', 'opencode.json')
      let data: Record<string, any> = {}
      if (fs.existsSync(openCodePath)) {
        try {
          data = JSON.parse(fs.readFileSync(openCodePath, 'utf8'))
        } catch {}
      }
      if (enabled) {
        data.mcp = data.mcp || {}
        data.mcp['open-computer-use'] = {
          type: 'local',
          command: [bin, 'mcp'],
        }
        fs.mkdirSync(path.dirname(openCodePath), { recursive: true })
        fs.writeFileSync(openCodePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
      } else {
        if (data.mcp && data.mcp['open-computer-use']) {
          delete data.mcp['open-computer-use']
          fs.writeFileSync(openCodePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
        }
      }
    } catch (err) {
      console.warn('[ComputerUse] Failed to sync OpenCode config:', err)
    }

    // 3. Codex (~/.codex/config.toml)
    try {
      const codexPath = path.join(home, '.codex', 'config.toml')
      if (fs.existsSync(codexPath)) {
        let toml = fs.readFileSync(codexPath, 'utf8')
        const sectionHeader = '[mcp_servers."open-computer-use"]'
        const regex = /\[mcp_servers\.(?:"open-computer-use"|open_computer_use)\][\s\S]*?(?=\n\[|$)/g
        toml = toml.replace(regex, '').trimEnd()
        if (enabled) {
          toml = toml + `\n\n${sectionHeader}\ncommand = "${bin}"\nargs = ["mcp"]\n`
        } else {
          toml = toml + '\n'
        }
        fs.writeFileSync(codexPath, toml, 'utf8')
      }
    } catch (err) {
      console.warn('[ComputerUse] Failed to sync Codex config:', err)
    }

    // 4. Cursor (~/.cursor/mcp.json)
    try {
      const cursorPath = path.join(home, '.cursor', 'mcp.json')
      let data: Record<string, any> = {}
      if (fs.existsSync(cursorPath)) {
        try {
          data = JSON.parse(fs.readFileSync(cursorPath, 'utf8'))
        } catch {}
      }
      if (enabled) {
        data.mcpServers = data.mcpServers || {}
        data.mcpServers['open-computer-use'] = {
          command: bin,
          args: ['mcp'],
        }
        fs.mkdirSync(path.dirname(cursorPath), { recursive: true })
        fs.writeFileSync(cursorPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
      } else {
        if (data.mcpServers && data.mcpServers['open-computer-use']) {
          delete data.mcpServers['open-computer-use']
          fs.writeFileSync(cursorPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
        }
      }
    } catch (err) {
      console.warn('[ComputerUse] Failed to sync Cursor config:', err)
    }

    // 5. Sync Skill Instructions (~/.claude/skills, ~/.codex/skills, ~/.config/opencode/skills)
    const skillPaths = [
      path.join(home, '.claude', 'skills', 'open-computer-use'),
      path.join(home, '.codex', 'skills', 'open-computer-use'),
      path.join(home, '.config', 'opencode', 'skills', 'open-computer-use'),
    ]

    const activeRules: string[] = []
    if (!disabledSet.has('get_app_state')) {
      activeRules.push('Call `get_app_state` before taking action to inspect the window hierarchy, accessibility tree, and screenshot.')
    }
    if (!disabledSet.has('click') || !disabledSet.has('set_value')) {
      activeRules.push('Prefer element-targeted interactions using `element_index` from the latest `get_app_state` response.')
    }
    if (!disabledSet.has('set_value') || !disabledSet.has('type_text')) {
      activeRules.push('Use `set_value` or `type_text` for editable form controls and text inputs.')
    }
    if (!disabledSet.has('click') || !disabledSet.has('scroll') || !disabledSet.has('drag')) {
      activeRules.push('Use `click`, `scroll`, and `drag` when element indexing is not available.')
    }
    if (!disabledSet.has('list_apps')) {
      activeRules.push('Inspect running apps using `list_apps`.')
    }

    const rulesSection = activeRules.length > 0
      ? activeRules.map((r, i) => `${i + 1}. ${r}`).join('\n')
      : 'No tools currently enabled.'

    const skillContent = `---
name: open-computer-use
description: Platform-neutral guidance for using Open Computer Use, the open-source Computer Use MCP server and CLI for macOS, Linux, and Windows. Use when an agent needs to inspect or interact with the desktop via open-computer-use.
---

# Open Computer Use

The \`open-computer-use\` MCP server enables non-intrusive GUI automation through macOS Accessibility and Screen Recording APIs.

## Core Rules
${rulesSection}
`

    for (const dir of skillPaths) {
      try {
        if (enabled) {
          fs.mkdirSync(dir, { recursive: true })
          fs.writeFileSync(path.join(dir, 'SKILL.md'), skillContent, 'utf8')
        } else {
          if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true })
          }
        }
      } catch (err) {
        console.warn(`[ComputerUse] Failed to sync skill in ${dir}:`, err)
      }
    }
  }
}
