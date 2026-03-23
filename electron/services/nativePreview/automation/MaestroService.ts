import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type { NativePreviewRunAutomationInput, NativePreviewRunAutomationResult } from '../../../../shared/electronApiTypes'
import type { NativePreviewSessionRecord } from '../types'
import { buildDefaultLaunchVerificationFlow } from './flowBuilder'

const execFileAsync = promisify(execFile)

interface NativePreviewAutomationConfigEntry {
  appId?: string
  selectorId?: string
}

interface NativePreviewAutomationConfigFile {
  ios?: NativePreviewAutomationConfigEntry
  android?: NativePreviewAutomationConfigEntry
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync(process.platform === 'win32' ? 'where' : 'which', [command])
    return true
  } catch {
    return false
  }
}

export class MaestroService {
  async isAvailable(): Promise<boolean> {
    return commandExists('maestro')
  }

  async tapPoint(session: NativePreviewSessionRecord, x: number, y: number): Promise<void> {
    const flow = [
      '---',
      '- tapOn:',
      `    point: "${Math.round(x)}, ${Math.round(y)}"`,
    ].join('\n')

    const result = await this.executeFlow(session, { flow })
    if (!result.success) {
      throw new Error(result.error ?? 'Failed to forward input through Maestro.')
    }
  }

  async run(session: NativePreviewSessionRecord, input: NativePreviewRunAutomationInput): Promise<NativePreviewRunAutomationResult> {
    const available = await this.isAvailable()
    if (!available) {
      return {
        success: false,
        status: 'unavailable',
        error: 'Maestro CLI is not installed on this machine.',
      }
    }

    const config = await this.loadProjectConfig(session)
    const appId = input.appId?.trim() || config?.appId
    const selectorId = input.selectorId?.trim() || config?.selectorId
    const flow = input.flow?.trim()
      || (input.flowPath ? null : (appId || selectorId
        ? buildDefaultLaunchVerificationFlow({ appId, selectorId })
        : null))

    if (!input.flowPath && !flow) {
      return {
        success: false,
        status: 'unavailable',
        error: 'No Maestro flow or native preview automation config was found.',
      }
    }

    return this.executeFlow(session, {
      flow: flow ?? undefined,
      flowPath: input.flowPath,
    })
  }

  private async executeFlow(
    session: NativePreviewSessionRecord,
    input: { flow?: string; flowPath?: string },
  ): Promise<NativePreviewRunAutomationResult> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cozea-maestro-'))
    const flowPath = input.flowPath ?? path.join(tempDir, `flow-${session.platform}.yaml`)

    try {
      if (!input.flowPath && input.flow) {
        await fs.writeFile(flowPath, input.flow, 'utf8')
      }

      const deviceId = session.platform === 'android'
        ? session.device?.runtimeId
        : session.device?.id
      const commandArgs = deviceId
        ? ['test', '--device', deviceId, flowPath]
        : ['test', flowPath]

      const { stdout, stderr } = await execFileAsync('maestro', commandArgs, {
        cwd: session.projectPath,
        maxBuffer: 1024 * 1024 * 8,
      })

      return {
        success: true,
        status: 'passed',
        stdout,
        stderr,
      }
    } catch (error) {
      const stdout = error && typeof error === 'object' && 'stdout' in error ? String((error as { stdout?: string }).stdout ?? '') : ''
      const stderr = error && typeof error === 'object' && 'stderr' in error ? String((error as { stderr?: string }).stderr ?? '') : ''
      return {
        success: false,
        status: 'failed',
        stdout,
        stderr,
        error: error instanceof Error ? error.message : String(error),
      }
    } finally {
      if (!input.flowPath) {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
      }
    }
  }

  private async loadProjectConfig(session: NativePreviewSessionRecord): Promise<NativePreviewAutomationConfigEntry | null> {
    const configPath = path.join(session.projectPath, 'cozea.native-preview.json')

    try {
      const content = await fs.readFile(configPath, 'utf8')
      const parsed = JSON.parse(content) as NativePreviewAutomationConfigFile
      return parsed[session.platform] ?? null
    } catch {
      return null
    }
  }
}
