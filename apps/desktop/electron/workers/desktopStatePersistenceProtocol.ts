import type {
  DesktopStateNamespace, DesktopStateRecord, LegacyDesktopDomain,
} from '@shared/desktopPersistenceTypes';

export type DesktopPersistenceWorkerOperation =
  | { action: 'load'; payload: { namespace: DesktopStateNamespace; keys?: string[] } }
  | { action: 'commit'; payload: { records: DesktopStateRecord[] } }
  | { action: 'flush'; payload: { targetRevision?: number } }
  | { action: 'migrateLegacy'; payload: { domain: LegacyDesktopDomain; rawPayload: string } }
  | { action: 'importMainRegistry'; payload?: undefined }
  | { action: 'diagnostics'; payload?: undefined };
export type DesktopPersistenceWorkerRequest = DesktopPersistenceWorkerOperation & { id: number };
export type DesktopPersistenceWorkerResponse =
  | { id: number; success: true; result: unknown }
  | { id: number; success: false; error: string };
