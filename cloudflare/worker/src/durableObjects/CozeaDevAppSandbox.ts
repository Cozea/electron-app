import { Sandbox } from '@cloudflare/sandbox'

import type { Env } from '../types'

interface HostedRuntimeLeases {
  releaseId: string
  expiresAtByToken: Record<string, number>
}

interface HostedRuntimeStartClaim {
  releaseId: string
  token: string
  expiresAt: number
}

const LEASES_KEY = 'cozea:hosted-runtime:leases'
const START_CLAIM_KEY = 'cozea:hosted-runtime:start-claim'
const TOKEN = /^[A-Za-z0-9_-]{32,256}$/

/** One Cloudflare VM boundary for a hosted published DevApp runtime. */
export class CozeaDevAppSandbox extends Sandbox<Env> {
  enableInternet = false
  allowedHosts = ['ghcr.io', '*.githubusercontent.com', 'r2.internal']

  private readonly durableState: DurableObjectState

  constructor(state: DurableObjectState, env: Env) {
    super(state, env)
    this.durableState = state
  }

  async claimHostedRuntimeStart(releaseId: string, token: string, expiresAt: number): Promise<boolean> {
    if (!TOKEN.test(token) || !Number.isSafeInteger(expiresAt)) return false
    return await this.durableState.storage.transaction(async (transaction) => {
      const now = Date.now()
      const existing = await transaction.get<HostedRuntimeStartClaim>(START_CLAIM_KEY)
      if (existing && existing.expiresAt > now && existing.token !== token) return false
      await transaction.put(START_CLAIM_KEY, { releaseId, token, expiresAt })
      return true
    })
  }

  async releaseHostedRuntimeStartClaim(releaseId: string, token: string): Promise<void> {
    await this.durableState.storage.transaction(async (transaction) => {
      const existing = await transaction.get<HostedRuntimeStartClaim>(START_CLAIM_KEY)
      if (existing?.releaseId === releaseId && existing.token === token) {
        await transaction.delete(START_CLAIM_KEY)
      }
    })
  }

  async acquireHostedRuntimeLease(releaseId: string, token: string, expiresAt: number): Promise<boolean> {
    if (!TOKEN.test(token) || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) {
      return false
    }
    await this.durableState.storage.transaction(async (transaction) => {
      const now = Date.now()
      const current = await transaction.get<HostedRuntimeLeases>(LEASES_KEY)
      const expiresAtByToken =
        current?.releaseId === releaseId
          ? Object.fromEntries(Object.entries(current.expiresAtByToken).filter(([, expiry]) => expiry > now))
          : {}
      expiresAtByToken[token] = expiresAt
      await transaction.put(LEASES_KEY, { releaseId, expiresAtByToken })
    })
    return true
  }

  async renewHostedRuntimeLease(releaseId: string, token: string, expiresAt: number): Promise<boolean> {
    if (!TOKEN.test(token) || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) {
      return false
    }
    return await this.durableState.storage.transaction(async (transaction) => {
      const current = await transaction.get<HostedRuntimeLeases>(LEASES_KEY)
      if (
        current?.releaseId !== releaseId ||
        !current.expiresAtByToken[token] ||
        current.expiresAtByToken[token] <= Date.now()
      ) {
        return false
      }
      current.expiresAtByToken[token] = expiresAt
      await transaction.put(LEASES_KEY, current)
      return true
    })
  }

  async releaseHostedRuntimeLease(releaseId: string, token: string): Promise<number | null> {
    if (!TOKEN.test(token)) return null
    return await this.durableState.storage.transaction(async (transaction) => {
      const now = Date.now()
      const current = await transaction.get<HostedRuntimeLeases>(LEASES_KEY)
      if (
        current?.releaseId !== releaseId ||
        !current.expiresAtByToken[token] ||
        current.expiresAtByToken[token] <= now
      ) {
        return null
      }
      delete current.expiresAtByToken[token]
      const remaining = Object.fromEntries(
        Object.entries(current.expiresAtByToken).filter(([, expiry]) => expiry > now),
      )
      if (Object.keys(remaining).length === 0) await transaction.delete(LEASES_KEY)
      else await transaction.put(LEASES_KEY, { releaseId, expiresAtByToken: remaining })
      return Object.keys(remaining).length
    })
  }

  async activeHostedRuntimeLeaseCount(releaseId: string): Promise<number> {
    return await this.durableState.storage.transaction(async (transaction) => {
      const current = await transaction.get<HostedRuntimeLeases>(LEASES_KEY)
      if (current?.releaseId !== releaseId) return 0
      const now = Date.now()
      const expiresAtByToken = Object.fromEntries(
        Object.entries(current.expiresAtByToken).filter(([, expiry]) => expiry > now),
      )
      const count = Object.keys(expiresAtByToken).length
      if (count === 0) await transaction.delete(LEASES_KEY)
      else await transaction.put(LEASES_KEY, { releaseId, expiresAtByToken })
      return count
    })
  }

  async clearHostedRuntimeLeases(releaseId: string): Promise<void> {
    await this.durableState.storage.transaction(async (transaction) => {
      const current = await transaction.get<HostedRuntimeLeases>(LEASES_KEY)
      if (current?.releaseId === releaseId) await transaction.delete(LEASES_KEY)
    })
  }
}
