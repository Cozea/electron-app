import type { NativePreviewSessionRecord } from './types'

export class NativePreviewSessionStore {
  private readonly sessions = new Map<string, NativePreviewSessionRecord>()

  list(): NativePreviewSessionRecord[] {
    return Array.from(this.sessions.values()).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  get(sessionId: string): NativePreviewSessionRecord | null {
    return this.sessions.get(sessionId) ?? null
  }

  set(session: NativePreviewSessionRecord): NativePreviewSessionRecord {
    this.sessions.set(session.id, session)
    return session
  }

  update(sessionId: string, patch: Partial<NativePreviewSessionRecord>): NativePreviewSessionRecord | null {
    const current = this.sessions.get(sessionId)
    if (!current) return null
    const next = {
      ...current,
      ...patch,
      updatedAt: Date.now(),
    }
    this.sessions.set(sessionId, next)
    return next
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  findByProjectAndPlatform(projectPath: string, platform: NativePreviewSessionRecord['platform']): NativePreviewSessionRecord | null {
    for (const session of this.sessions.values()) {
      if (session.projectPath === projectPath && session.platform === platform) {
        return session
      }
    }
    return null
  }
}
