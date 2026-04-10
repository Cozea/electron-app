import type { WebContents } from 'electron'

interface SenderQueue<T> {
  sender: WebContents
  items: Map<string, T>
  flushTimer: NodeJS.Timeout | null
}

interface IpcOutputBatcherOptions<T> {
  channel: string
  keyOf: (payload: T) => string
  merge: (current: T, next: T) => T
  flushDelayMs?: number
}

const DEFAULT_FLUSH_DELAY_MS = 20

export function createIpcOutputBatcher<T>({
  channel,
  keyOf,
  merge,
  flushDelayMs = DEFAULT_FLUSH_DELAY_MS,
}: IpcOutputBatcherOptions<T>) {
  const queues = new Map<number, SenderQueue<T>>()

  const flushSenderId = (senderId: number) => {
    const queue = queues.get(senderId)
    if (!queue) return

    if (queue.flushTimer) {
      clearTimeout(queue.flushTimer)
      queue.flushTimer = null
    }

    if (queue.sender.isDestroyed()) {
      queues.delete(senderId)
      return
    }

    const payloads = Array.from(queue.items.values())
    queue.items.clear()
    if (payloads.length === 0) {
      return
    }

    for (const payload of payloads) {
      queue.sender.send(channel, payload)
    }
  }

  return {
    enqueue(sender: WebContents, payload: T) {
      const senderId = sender.id
      const existing = queues.get(senderId)
      const queue =
        existing && !existing.sender.isDestroyed()
          ? existing
          : {
              sender,
              items: new Map<string, T>(),
              flushTimer: null,
            }

      queue.sender = sender

      const payloadKey = keyOf(payload)
      const current = queue.items.get(payloadKey)
      queue.items.set(payloadKey, current ? merge(current, payload) : payload)
      queues.set(senderId, queue)

      if (queue.flushTimer) {
        return
      }

      queue.flushTimer = setTimeout(() => {
        flushSenderId(senderId)
      }, flushDelayMs)
    },

    flush(sender: WebContents) {
      flushSenderId(sender.id)
    },

    flushAll() {
      for (const senderId of queues.keys()) {
        flushSenderId(senderId)
      }
    },
  }
}
