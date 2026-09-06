import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

describe('Computer Use Provider Sync Logic', () => {
  it('updates and removes open-computer-use in Claude JSON config', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cu-test-claude-'))
    const claudePath = path.join(tempDir, '.claude.json')

    const initialConfig = {
      mcpServers: {
        filesystem: { command: 'npx', args: ['-y', 'mcp-filesystem'] },
      },
    }
    fs.writeFileSync(claudePath, JSON.stringify(initialConfig, null, 2))

    // Enable
    const data = JSON.parse(fs.readFileSync(claudePath, 'utf8'))
    data.mcpServers = data.mcpServers || {}
    data.mcpServers['open-computer-use'] = {
      type: 'stdio',
      command: 'open-computer-use',
      args: ['mcp'],
    }
    fs.writeFileSync(claudePath, JSON.stringify(data, null, 2))

    let updated = JSON.parse(fs.readFileSync(claudePath, 'utf8'))
    expect(updated.mcpServers['open-computer-use']).toEqual({
      type: 'stdio',
      command: 'open-computer-use',
      args: ['mcp'],
    })
    expect(updated.mcpServers.filesystem).toBeDefined()

    // Disable
    delete updated.mcpServers['open-computer-use']
    fs.writeFileSync(claudePath, JSON.stringify(updated, null, 2))

    const disabled = JSON.parse(fs.readFileSync(claudePath, 'utf8'))
    expect(disabled.mcpServers['open-computer-use']).toBeUndefined()
    expect(disabled.mcpServers.filesystem).toBeDefined()

    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('updates and removes open-computer-use in OpenCode JSON config', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cu-test-opencode-'))
    const openCodePath = path.join(tempDir, 'opencode.json')

    // Enable on fresh file
    const data: Record<string, any> = {}
    data.mcp = data.mcp || {}
    data.mcp['open-computer-use'] = {
      type: 'local',
      command: ['open-computer-use', 'mcp'],
    }
    fs.writeFileSync(openCodePath, JSON.stringify(data, null, 2))

    let updated = JSON.parse(fs.readFileSync(openCodePath, 'utf8'))
    expect(updated.mcp['open-computer-use']).toEqual({
      type: 'local',
      command: ['open-computer-use', 'mcp'],
    })

    // Disable
    delete updated.mcp['open-computer-use']
    fs.writeFileSync(openCodePath, JSON.stringify(updated, null, 2))

    const disabled = JSON.parse(fs.readFileSync(openCodePath, 'utf8'))
    expect(disabled.mcp['open-computer-use']).toBeUndefined()

    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('updates and removes open-computer-use in Codex TOML config', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cu-test-codex-'))
    const codexPath = path.join(tempDir, 'config.toml')

    const initialToml = `model = "gpt-5"\n\n[marketplaces.openai]\nsource_type = "local"\n`
    fs.writeFileSync(codexPath, initialToml)

    // Enable
    let toml = fs.readFileSync(codexPath, 'utf8')
    const sectionHeader = '[mcp_servers."open-computer-use"]'
    toml = toml.trimEnd() + `\n\n${sectionHeader}\ncommand = "open-computer-use"\nargs = ["mcp"]\n`
    fs.writeFileSync(codexPath, toml)

    let updated = fs.readFileSync(codexPath, 'utf8')
    expect(updated).toContain('[mcp_servers."open-computer-use"]')
    expect(updated).toContain('command = "open-computer-use"')

    // Disable
    const regex = new RegExp(`\\[mcp_servers\\.(?:"open-computer-use"|open_computer_use)\\][\\s\\S]*?(?=\\n\\[|$)`, 'g')
    toml = toml.replace(regex, '').trimEnd() + '\n'
    fs.writeFileSync(codexPath, toml)

    const disabled = fs.readFileSync(codexPath, 'utf8')
    expect(disabled).not.toContain('open-computer-use')
    expect(disabled).toContain('model = "gpt-5"')

    fs.rmSync(tempDir, { recursive: true, force: true })
  })
})
