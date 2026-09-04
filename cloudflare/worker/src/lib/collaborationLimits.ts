export const COLLAB_MAX_FRAME_BYTES = 128 * 1024
export const COLLAB_MAX_UPDATE_BYTES = 96 * 1024
export const COLLAB_MAX_RETAINED_BYTES = 64 * 1024 * 1024
export const COLLAB_MAX_RETAINED_UPDATES = 25_000
export const COLLAB_RATE_WINDOW_MS = 10_000
export const COLLAB_MAX_WINDOW_UPDATES = 600
export const COLLAB_MAX_WINDOW_BYTES = 8 * 1024 * 1024

export interface RetainedUsage { bytes: number; count: number }
export interface UpdateRate { startedAt: number; bytes: number; count: number }

export function validateUpdateInput(update: {
  idempotencyKey: string
  updateBinary: string
  timestamp: number
}): number {
  if (typeof update.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(update.idempotencyKey)) {
    throw new Error('Invalid update idempotency key')
  }
  if (typeof update.updateBinary !== 'string' || !update.updateBinary.length ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(update.updateBinary) ||
      update.updateBinary.length > COLLAB_MAX_UPDATE_BYTES) {
    throw new Error('Encrypted update exceeds the supported frame limit or is invalid')
  }
  if (!Number.isFinite(update.timestamp) || update.timestamp < 0) throw new Error('Invalid update timestamp')
  // Includes record, index key and fixed metadata overhead; conservative by design.
  return update.updateBinary.length + update.idempotencyKey.length * 2 + 1024
}

export function reserveUpdateBudget(usage: RetainedUsage, rate: UpdateRate | undefined, bytes: number, now: number) {
  const window = rate && now >= rate.startedAt && now - rate.startedAt < COLLAB_RATE_WINDOW_MS
    ? rate : { startedAt: now, bytes: 0, count: 0 }
  if (usage.count + 1 > COLLAB_MAX_RETAINED_UPDATES || usage.bytes + bytes > COLLAB_MAX_RETAINED_BYTES) {
    throw new Error('Collaboration retention quota reached; publish or preserve local work before continuing')
  }
  if (window.count + 1 > COLLAB_MAX_WINDOW_UPDATES || window.bytes + bytes > COLLAB_MAX_WINDOW_BYTES) {
    throw new Error('Collaboration update rate limit reached; retry after the rate window')
  }
  return {
    usage: { bytes: usage.bytes + bytes, count: usage.count + 1 },
    rate: { ...window, bytes: window.bytes + bytes, count: window.count + 1 },
  }
}
