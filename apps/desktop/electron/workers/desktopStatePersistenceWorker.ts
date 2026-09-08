import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { DesktopStatePersistenceWorkerCore } from './desktopStatePersistenceWorkerCore';
import type { DesktopPersistenceWorkerRequest, DesktopPersistenceWorkerResponse } from './desktopStatePersistenceProtocol';

if (isMainThread || !parentPort || typeof workerData?.userDataPath !== 'string') {
  throw new Error('Desktop state persistence must run in its dedicated Node worker.');
}
const port = parentPort;
const core = new DesktopStatePersistenceWorkerCore({ userDataPath: workerData.userDataPath });
port.on('message', (message: DesktopPersistenceWorkerRequest) => {
  void (async () => {
    let result: unknown;
    switch (message.action) {
      case 'load': result = await core.load(message.payload.namespace, message.payload.keys); break;
      case 'commit': result = await core.commit(message.payload.records); break;
      case 'flush': result = await core.flush(message.payload.targetRevision); break;
      case 'migrateLegacy': result = await core.migrateLegacyDomain(message.payload.domain, message.payload.rawPayload); break;
      case 'importMainRegistry': result = await core.importMainRegistry(); break;
      case 'diagnostics': result = core.diagnostics(); break;
      default: throw new Error('Unknown desktop persistence worker operation.');
    }
    port.postMessage({ id: message.id, success: true, result } satisfies DesktopPersistenceWorkerResponse);
  })().catch((error: unknown) => {
    port.postMessage({ id: message.id, success: false, error: error instanceof Error ? error.message : String(error) } satisfies DesktopPersistenceWorkerResponse);
  });
});
