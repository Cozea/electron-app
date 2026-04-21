import path from 'node:path'

import type { FileChangeAttribution, TerminalCreateOptions, TerminalKind } from '../../shared/electronApiTypes'

const COMMAND_PROVENANCE_WINDOW_MS = 30_000
const SUBPROCESS_PROVENANCE_WINDOW_MS = 2 * 60_000

interface TerminalProvenanceRecord {
  terminalId: string
  projectPath: string
  gitCwd: string
  title: string
  terminalKind: TerminalKind | string
  runId?: string
  sessionKey?: string
  laneId?: string
  workspaceId?: string
  hasRunningSubprocess: boolean
  lastActivityAt: number
  lastCommandId?: string
  lastCommandText?: string
  lastCommandAt?: number
}

function pathIsWithinRoot(filePath: string, rootPath: string): boolean {
  try {
    const normalizedFilePath = path.resolve(filePath)
    const normalizedRootPath = path.resolve(rootPath)
    if (normalizedFilePath === normalizedRootPath) return true
    const relative = path.relative(normalizedRootPath, normalizedFilePath)
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
  } catch {
    return false
  }
}

export class TerminalProvenanceService {
  private static instance: TerminalProvenanceService | null = null

  private readonly records = new Map<string, TerminalProvenanceRecord>()

  static getInstance(): TerminalProvenanceService {
    if (!TerminalProvenanceService.instance) {
      TerminalProvenanceService.instance = new TerminalProvenanceService()
    }
    return TerminalProvenanceService.instance
  }

  registerTerminal(
    terminalId: string,
    options: TerminalCreateOptions,
    title: string,
  ): void {
    const now = Date.now()
    this.records.set(terminalId, {
      terminalId,
      projectPath: path.resolve(options.projectPath),
      gitCwd: path.resolve(options.gitCwd ?? options.projectPath),
      title,
      terminalKind: options.terminalKind ?? 'shell',
      runId: options.runId,
      sessionKey: options.sessionKey?.trim() || undefined,
      laneId: options.laneId?.trim() || undefined,
      workspaceId: options.workspaceId?.trim() || undefined,
      hasRunningSubprocess: false,
      lastActivityAt: now,
    })
  }

  recordCommand(payload: {
    terminalId: string
    title?: string
    commandId?: string
    commandText?: string
    runId?: string
    timestamp?: number
  }): void {
    const record = this.records.get(payload.terminalId)
    if (!record) {
      return
    }

    const timestamp = payload.timestamp ?? Date.now()
    record.lastActivityAt = timestamp
    record.runId = payload.runId ?? record.runId
    if (payload.title?.trim()) {
      record.title = payload.title.trim()
    }
    if (payload.commandId?.trim()) {
      record.lastCommandId = payload.commandId.trim()
    }
    if (payload.commandText?.trim()) {
      record.lastCommandText = payload.commandText.trim()
      record.lastCommandAt = timestamp
    }
  }

  updateActivity(payload: {
    terminalId: string
    hasRunningSubprocess: boolean
    runId?: string
  }): void {
    const record = this.records.get(payload.terminalId)
    if (!record) {
      return
    }

    record.hasRunningSubprocess = payload.hasRunningSubprocess
    record.runId = payload.runId ?? record.runId
    record.lastActivityAt = Date.now()
  }

  closeTerminal(terminalId: string): void {
    this.records.delete(terminalId)
  }

  resolveForFilePath(filePath: string): FileChangeAttribution | null {
    const now = Date.now()
    let bestRecord: TerminalProvenanceRecord | null = null
    let bestTimestamp = -1

    for (const record of this.records.values()) {
      if (!pathIsWithinRoot(filePath, record.gitCwd)) {
        continue
      }

      const commandAgeMs =
        typeof record.lastCommandAt === 'number' ? now - record.lastCommandAt : Number.POSITIVE_INFINITY
      const isRecentCommand = commandAgeMs <= COMMAND_PROVENANCE_WINDOW_MS
      const isActiveSubprocess =
        record.hasRunningSubprocess && now - record.lastActivityAt <= SUBPROCESS_PROVENANCE_WINDOW_MS

      if (!isRecentCommand && !isActiveSubprocess) {
        continue
      }

      const candidateTimestamp = Math.max(record.lastCommandAt ?? 0, record.lastActivityAt)
      if (candidateTimestamp <= bestTimestamp) {
        continue
      }

      bestRecord = record
      bestTimestamp = candidateTimestamp
    }

    if (!bestRecord) {
      return null
    }

    return {
      origin: bestRecord.terminalKind === 'agent' ? 'agent' : 'user',
      sourceOrigin: 'terminal',
      actorType: bestRecord.terminalKind === 'agent' ? 'agent' : 'user',
      actorId: bestRecord.runId ?? bestRecord.terminalId,
      terminalId: bestRecord.terminalId,
      terminalTitle: bestRecord.title,
      terminalKind: bestRecord.terminalKind,
      commandId: bestRecord.lastCommandId,
      commandText: bestRecord.lastCommandText,
      runId: bestRecord.runId,
      sessionKey: bestRecord.sessionKey,
      laneId: bestRecord.laneId,
      workspaceId: bestRecord.workspaceId,
      gitCwd: bestRecord.gitCwd,
      timestamp: bestTimestamp,
    }
  }
}
