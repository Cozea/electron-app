import { isMainThread, parentPort, workerData } from 'node:worker_threads'
import { DesktopStatePersistenceWorkerCore } from './desktopStatePersistenceWorkerCore'
import type { DesktopStateNamespace, DesktopStateRecord } from '../../../../shared/desktopPersistenceTypes'

if (isMainThread || !parentPort) throw new Error('Desktop persistence entry requires a worker thread')
const port = parentPort
const core = new DesktopStatePersistenceWorkerCore(workerData as { userDataPath: string })
interface WorkerRequest { id: number; action: 'load' | 'commit' | 'flush' | 'migrateLegacy'; payload: { namespace?: DesktopStateNamespace; keys?: string[]; records?: DesktopStateRecord[]; domain?: string; rawPayload?: string } }
// FIFO command ordering gives flush a real barrier over every earlier accepted command.
let tail: Promise<void> = Promise.resolve()
port.on('message', (message: WorkerRequest) => {
  tail = tail.catch(() => undefined).then(async () => {
    try {
      const { id, action, payload } = message
      if (!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid persistence request ID')
      let result: unknown
      switch (action) {
        case 'load': result = await core.load(payload.namespace!, payload.keys); break
        case 'commit': result = await core.commit(payload.records!); break
        case 'flush': result = await core.flush(); break
        case 'migrateLegacy': result = await core.migrateLegacyDomain(payload.domain!, payload.rawPayload!); break
        default: throw new Error('Unknown persistence action')
      }
      port.postMessage({ id, success: true, result })
    } catch (error) { port.postMessage({ id: message.id, success: false, error: error instanceof Error ? error.message : String(error) }) }
  })
})
