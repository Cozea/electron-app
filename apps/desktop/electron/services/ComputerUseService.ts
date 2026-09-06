import { shell } from 'electron'

import { ComputerUseRuntimeService } from './ComputerUseRuntimeService'
import type { ComputerUseDiagnostics } from '@shared/electronApiTypes'

/**
 * Compatibility facade retained while older main/settings call sites still
 * reference ComputerUseService. Computer Use is now a Cozea-owned runtime;
 * this class must never discover an external CLI or modify provider homes.
 */
export class ComputerUseService {
  private static instance: ComputerUseService | null = null

  static getInstance(): ComputerUseService {
    if (!this.instance) this.instance = new ComputerUseService()
    return this.instance
  }

  private readonly runtime = ComputerUseRuntimeService.getInstance()

  async resolveCliPath(_configuredPath?: string): Promise<string | null> {
    // There is intentionally no external CLI path anymore. The macOS engine
    // is linked into Cozea and Windows/Linux workers are packaged resources.
    return null
  }

  async getDiagnostics(_configuredPath?: string): Promise<ComputerUseDiagnostics> {
    return this.runtime.getDiagnostics()
  }

  async openPermissionSettings(target: 'accessibility' | 'screenRecording'): Promise<void> {
    if (process.platform !== 'darwin') return
    const granted = this.runtime.requestPermission(target)
    if (granted) return
    const url =
      target === 'accessibility'
        ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
        : 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
    await shell.openExternal(url)
  }

  async syncProviderConfigs(
    _enabled: boolean,
    _disabledTools?: string[],
  ): Promise<void> {
    // Provider exposure is the authenticated per-thread T3 MCP endpoint. Never
    // write ~/.claude.json, ~/.codex/config.toml, ~/.cursor/mcp.json, or
    // ~/.config/opencode/opencode.json here. A settings-policy change does,
    // however, revoke every current Computer Use session immediately so stale
    // element indexes/cursor state and worker-spawn environment cannot survive
    // a capability change.
    await this.runtime.resetAll()
  }
}
