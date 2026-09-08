/**
 * Desktop State Persistence Node Worker Entry
 * Conforms to Section 10.2 of docs/perf/navigation-runtime-plan.md
 */

import { parentPort, workerData } from 'node:worker_threads';
import { DesktopStatePersistenceWorkerCore } from './desktopStatePersistenceWorkerCore';

if (parentPort && workerData) {
  const core = new DesktopStatePersistenceWorkerCore({
    userDataPath: workerData.userDataPath,
  });

  parentPort.on('message', async (msg: { id: number; action: string; payload: any }) => {
    try {
      let result: any;
      if (msg.action === 'load') {
        result = await core.load(msg.payload.namespace, msg.payload.keys);
      } else if (msg.action === 'commit') {
        result = await core.commit(msg.payload.records);
      } else if (msg.action === 'flush') {
        result = await core.flush(msg.payload?.targetRevision);
      } else if (msg.action === 'migrateLegacy') {
        result = await core.migrateLegacyDomain(msg.payload.domain, msg.payload.rawPayload);
      } else {
        throw new Error(`Unknown worker action: ${msg.action}`);
      }

      parentPort?.postMessage({ id: msg.id, success: true, result });
    } catch (err) {
      parentPort?.postMessage({
        id: msg.id,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
