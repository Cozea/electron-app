import { featureFlags } from '@/lib/featureFlags'

export type SchedulerPriority = 'user-blocking' | 'user-visible' | 'background'

interface SchedulerTaskOptions {
  priority?: SchedulerPriority
  delay?: number
}

interface SchedulerLike {
  postTask?: <T>(callback: () => T | Promise<T>, options?: SchedulerTaskOptions) => Promise<T>
  yield?: () => Promise<void>
}

function getScheduler(): SchedulerLike | null {
  if (!featureFlags.prioritizedScheduling) return null
  const maybeScheduler = (globalThis as { scheduler?: SchedulerLike }).scheduler
  if (!maybeScheduler?.postTask) return null
  return maybeScheduler
}

function timeoutFallback<T>(callback: () => T | Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      Promise.resolve()
        .then(callback)
        .then(resolve)
        .catch(reject)
    }, 0)
  })
}

export function scheduleTask<T>(
  callback: () => T | Promise<T>,
  priority: SchedulerPriority = 'background'
): Promise<T> {
  const scheduler = getScheduler()
  if (!scheduler?.postTask) {
    return timeoutFallback(callback)
  }
  return scheduler.postTask(callback, { priority })
}

export async function yieldToMainThread(): Promise<void> {
  const scheduler = getScheduler()
  if (scheduler?.yield) {
    await scheduler.yield()
    return
  }
  await timeoutFallback(() => undefined)
}

export async function processInChunks<T>(
  items: T[],
  processItem: (item: T, index: number) => void,
  chunkSize = 50
): Promise<void> {
  for (let index = 0; index < items.length; index += 1) {
    processItem(items[index], index)
    if ((index + 1) % chunkSize === 0) {
      await yieldToMainThread()
    }
  }
}

