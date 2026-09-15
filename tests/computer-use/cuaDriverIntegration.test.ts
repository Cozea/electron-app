import { describe, expect, it } from 'vitest'
import {
  isApplicationExcluded,
  filterVisibleApplications,
  resolveApplication,
  EXCLUDED_APP_ERROR,
  EXCLUDED_BUNDLE_IDS,
  EXCLUDED_APP_NAMES,
} from '../../apps/desktop/electron/services/ApplicationExclusions'
import { EmbeddedCuaDaemon } from '../../apps/desktop/electron/services/EmbeddedCuaDaemon'
import { CuaSocketClient } from '../../apps/desktop/electron/services/CuaSocketClient'

describe('Cua Driver daemon and application exclusions', () => {
  describe('ApplicationExclusions', () => {
    it('strictly excludes all known password managers by bundle ID and app name', () => {
      for (const bundleId of EXCLUDED_BUNDLE_IDS) {
        expect(isApplicationExcluded(bundleId), `Failed for bundleId: ${bundleId}`).toBe(true)
        expect(isApplicationExcluded(bundleId.toUpperCase())).toBe(true)
      }

      for (const name of EXCLUDED_APP_NAMES) {
        expect(isApplicationExcluded(name), `Failed for name: ${name}`).toBe(true)
        expect(isApplicationExcluded(`  ${name.toUpperCase()}  `)).toBe(true)
      }

      // Normal applications must not be excluded
      for (const safe of ['Finder', 'Safari', 'Google Chrome', 'Ghostty', 'Slack', 'Notes', 'Visual Studio Code']) {
        expect(isApplicationExcluded(safe)).toBe(false)
        expect(isApplicationExcluded(`com.apple.${safe.toLowerCase()}`)).toBe(false)
      }
    })

    it('filters out password managers from app lists', () => {
      const candidates = [
        { pid: 100, name: 'Finder', bundleId: 'com.apple.finder' },
        { pid: 200, name: '1Password', bundleId: 'com.1password.1password' },
        { pid: 300, name: 'Bitwarden', bundleId: 'com.bitwarden.desktop' },
        { pid: 400, name: 'Safari', bundleId: 'com.apple.Safari' },
        { pid: 500, name: 'Passwords', bundleId: 'com.apple.passwords' },
      ]

      const visible = filterVisibleApplications(candidates)
      expect(visible.map((a) => a.name)).toEqual(['Finder', 'Safari'])
    })

    it('rejects resolution of password managers with an explicit error', () => {
      const candidates = [
        { pid: 100, name: 'Finder', bundleId: 'com.apple.finder' },
        { pid: 200, name: '1Password', bundleId: 'com.1password.1password' },
      ]

      const excludedByName = resolveApplication('1Password', candidates)
      expect(excludedByName).toEqual({ error: EXCLUDED_APP_ERROR })

      const excludedByPid = resolveApplication('200', candidates)
      expect(excludedByPid).toEqual({ error: EXCLUDED_APP_ERROR })

      const excludedByBundle = resolveApplication('com.1password.1password', candidates)
      expect(excludedByBundle).toEqual({ error: EXCLUDED_APP_ERROR })

      const safeResult = resolveApplication('Finder', candidates)
      expect(safeResult).toEqual({ app: candidates[0] })
    })
  })

  describe('Embedded Cua Driver daemon and socket lifecycle', () => {
    // Live daemon tests need a macOS GUI session; they skip elsewhere.
    it.skipIf(process.platform !== 'darwin')('resolves the packaged or build directory executable', () => {
      const daemon = new EmbeddedCuaDaemon()
      const binPath = daemon.resolveExecutablePath()
      expect(binPath).not.toBeNull()
      expect(binPath).toContain('cua-driver')
      expect(daemon.isInstalled()).toBe(true)
    })

    it.skipIf(process.platform !== 'darwin')('supervises the embedded daemon, queries metadata, and terminates cleanly', async ({ skip }) => {
      const daemon = new EmbeddedCuaDaemon()
      let socketPath: string
      try {
        socketPath = await daemon.ensureDaemon()
      } catch {
        return skip('Embedded Cua Driver cannot start without a GUI session.')
      }
      expect(socketPath).toMatch(/^\/tmp\/cz-cua-/)
      expect(daemon.isReady()).toBe(true)

      // Query metadata over line-delimited socket
      const meta = await CuaSocketClient.getMetadata(socketPath)
      expect(meta.driver_version).toBe('0.28.1')
      expect(meta.embedded).toBe(true)
      expect(meta.host_bundle_id).toBe('com.cozea.desktop')

      // Permission status round-trip the diagnostics and settings flows rely on
      const perms = await CuaSocketClient.callTool(
        socketPath,
        'check_permissions',
        { prompt: false },
        'test-perms',
        { timeoutMs: 5000 },
      )
      expect(perms.isError).toBe(false)
      expect(perms.content.length).toBeGreaterThan(0)

      // List apps and verify structured output
      const apps = await CuaSocketClient.listApps(socketPath)
      expect(Array.isArray(apps)).toBe(true)
      expect(apps.length).toBeGreaterThan(0)
      const running = apps.filter((a) => a.running)
      expect(running.length).toBeGreaterThan(0)

      // List windows and verify structured output
      const windows = await CuaSocketClient.listWindows(socketPath)
      expect(Array.isArray(windows)).toBe(true)
      expect(windows.length).toBeGreaterThan(0)

      // Session end notification
      await CuaSocketClient.endSession(socketPath, 'test-sess-cleanup')

      // Clean daemon shutdown
      await daemon.stop()
      expect(daemon.isReady()).toBe(false)
      expect(daemon.getSocketPath()).toBeNull()
    })
  })
})
