import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

interface PersistedDevServerPortRecord {
  sessionKey: string
  preferredPort: number
  lastAllocatedPort: number
  workspaceId: string
  updatedAt: number
}

interface PersistedDevServerPortRegistry {
  version: 1
  sessions: Record<string, PersistedDevServerPortRecord>
}

interface ActivePortLease {
  sessionKey: string
  workspaceId: string
  port: number
}

interface AcquirePortOptions {
  sessionKey: string
  workspaceId: string
  preferredPort: number
  isPortReachable: (port: number) => Promise<boolean>
}

interface AcquirePortResult {
  port: number
  preferredPort: number
  requestedPort: number
}

const REGISTRY_FILE_NAME = 'dev-server-port-registry.json'
const MAX_PORT_SCAN_ATTEMPTS = 50

function normalizeSessionKey(input: string | null | undefined, workspaceId: string): string {
  const trimmed = input?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : workspaceId.trim()
}

function normalizePort(port: number): number {
  if (Number.isFinite(port) && port >= 1 && port <= 65535) {
    return Math.trunc(port)
  }
  return 3000
}

function getRegistryPath(): string {
  return path.join(app.getPath('userData'), REGISTRY_FILE_NAME)
}

function readRegistry(): PersistedDevServerPortRegistry {
  const registryPath = getRegistryPath()

  try {
    if (!fs.existsSync(registryPath)) {
      return { version: 1, sessions: {} }
    }

    const raw = fs.readFileSync(registryPath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<PersistedDevServerPortRegistry> | null
    const sessions =
      parsed?.sessions && typeof parsed.sessions === 'object'
        ? parsed.sessions
        : {}

    return {
      version: 1,
      sessions: sessions as Record<string, PersistedDevServerPortRecord>,
    }
  } catch {
    return { version: 1, sessions: {} }
  }
}

function writeRegistry(registry: PersistedDevServerPortRegistry): void {
  const registryPath = getRegistryPath()
  fs.mkdirSync(path.dirname(registryPath), { recursive: true })
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2))
}

export class DevServerPortBroker {
  private static instance: DevServerPortBroker | null = null

  static getInstance(): DevServerPortBroker {
    if (!DevServerPortBroker.instance) {
      DevServerPortBroker.instance = new DevServerPortBroker()
    }
    return DevServerPortBroker.instance
  }

  private readonly registry = readRegistry()
  private readonly activeLeases = new Map<string, ActivePortLease>()

  private persist(): void {
    writeRegistry(this.registry)
  }

  private isLeasedByDifferentSession(port: number, sessionKey: string): boolean {
    for (const lease of this.activeLeases.values()) {
      if (lease.port === port && lease.sessionKey !== sessionKey) {
        return true
      }
    }
    return false
  }

  private upsertRecord(input: {
    sessionKey: string
    workspaceId: string
    preferredPort: number
    allocatedPort: number
  }): void {
    this.registry.sessions[input.sessionKey] = {
      sessionKey: input.sessionKey,
      preferredPort: normalizePort(input.preferredPort),
      lastAllocatedPort: normalizePort(input.allocatedPort),
      workspaceId: input.workspaceId,
      updatedAt: Date.now(),
    }
    this.persist()
  }

  async acquirePort(options: AcquirePortOptions): Promise<AcquirePortResult> {
    const sessionKey = normalizeSessionKey(options.sessionKey, options.workspaceId)
    const persistedRecord = this.registry.sessions[sessionKey]
    const preferredPort = normalizePort(
      persistedRecord?.preferredPort ?? options.preferredPort,
    )

    const activeLease = this.activeLeases.get(sessionKey)
    if (activeLease && activeLease.workspaceId === options.workspaceId) {
      this.upsertRecord({
        sessionKey,
        workspaceId: options.workspaceId,
        preferredPort,
        allocatedPort: activeLease.port,
      })
      return {
        port: activeLease.port,
        preferredPort,
        requestedPort: preferredPort,
      }
    }

    let candidatePort = preferredPort
    for (let attempt = 0; attempt < MAX_PORT_SCAN_ATTEMPTS; attempt += 1) {
      const leasedByDifferentSession = this.isLeasedByDifferentSession(candidatePort, sessionKey)
      const portReachable = leasedByDifferentSession
        ? true
        : await options.isPortReachable(candidatePort)

      if (!leasedByDifferentSession && !portReachable) {
        this.activeLeases.set(sessionKey, {
          sessionKey,
          workspaceId: options.workspaceId,
          port: candidatePort,
        })
        this.upsertRecord({
          sessionKey,
          workspaceId: options.workspaceId,
          preferredPort: candidatePort,
          allocatedPort: candidatePort,
        })
        return {
          port: candidatePort,
          preferredPort: candidatePort,
          requestedPort: preferredPort,
        }
      }

      candidatePort += 1
    }

    throw new Error(`Unable to allocate a dev server port starting from ${preferredPort}.`)
  }

  releasePort(sessionKey: string | null | undefined, workspaceId?: string | null): void {
    const normalizedSessionKey = workspaceId
      ? normalizeSessionKey(sessionKey, workspaceId)
      : sessionKey?.trim() || null

    if (normalizedSessionKey) {
      this.activeLeases.delete(normalizedSessionKey)
    }
  }
}
