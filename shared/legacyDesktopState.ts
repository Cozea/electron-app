import type { DesktopStateRecord, LegacyDesktopDomain } from './desktopPersistenceTypes';
import { isPlainRecord, isPersistenceKey, isSerializedDesktopLayout, validateDesktopStateData } from './desktopPersistenceValidation';

export interface LegacyDesktopImport {
  records: DesktopStateRecord[];
  quarantinedCount: number;
  skippedCount: number;
}

/** Decode actual persisted envelopes. Keys are preserved; no workspace or branch is guessed. */
export function decodeLegacyDesktopState(domain: LegacyDesktopDomain, rawPayload: string): LegacyDesktopImport {
  const parsed: unknown = JSON.parse(rawPayload);
  if (!isPlainRecord(parsed)) throw new Error('Legacy desktop state is not an object.');
  const records: DesktopStateRecord[] = [];
  let quarantinedCount = 0;
  let skippedCount = 0;
  const add = (namespace: DesktopStateRecord['namespace'], key: string, data: unknown) => {
    try {
      if (!isPersistenceKey(key)) throw new Error('Invalid legacy record key.');
      const record: DesktopStateRecord = { schemaVersion: 1, namespace, key, recordRevision: 1, updatedAt: 0, data };
      validateDesktopStateData(record);
      records.push(record);
    } catch {
      quarantinedCount++;
    }
  };

  if (domain === 'cozea-query-cache') {
    // The old cache did not establish its principal/deployment owner. Preserve its
    // raw backup, but never relabel this private data as the current identity's cache.
    const state = isPlainRecord(parsed.state) ? parsed.state : parsed;
    if (!isPlainRecord(state.cache)) throw new Error('Invalid legacy query-cache envelope.');
    skippedCount = Object.keys(state.cache).length;
  } else if (domain === 'cozea:project-workbench-layouts') {
    if (parsed.version !== 1 || !isPlainRecord(parsed.layouts)) throw new Error('Invalid legacy layouts envelope.');
    for (const [scopeKey, entry] of Object.entries(parsed.layouts)) add('workbenchLayout', scopeKey, entry);
  } else if (domain === 'cozea:project-workbench') {
    const state = isPlainRecord(parsed.state) ? parsed.state : parsed;
    const workbenches = isPlainRecord(state.workbenches) ? state.workbenches : null;
    if (!workbenches) {
      // Older `projects` envelopes may lack concrete workspace/lane identity.
      // They remain recoverable in the backup, never silently promoted to a guessed scope.
      if (isPlainRecord(state.projects)) quarantinedCount += Object.keys(state.projects).length;
      else throw new Error('Invalid legacy workbench envelope.');
    } else {
      for (const [scopeKey, model] of Object.entries(workbenches)) {
        const countBefore = records.length;
        add('workbenchModel', scopeKey, model);
        if (records.length !== countBefore && isPlainRecord(model) && isSerializedDesktopLayout(model.layout)) {
          add('workbenchLayout', scopeKey, { layout: model.layout, layoutResetKey: model.layoutResetKey });
        }
      }
    }
  } else if (domain === 'cozea:project-branch-sessions:v1') {
    const sessions = parsed.version === 2 && isPlainRecord(parsed.sessions) ? parsed.sessions
      : parsed.version === 1 && isPlainRecord(parsed.projects) ? parsed.projects : null;
    if (!sessions) throw new Error('Invalid legacy branch knowledge envelope.');
    for (const entry of Object.values(sessions)) {
      if (!isPlainRecord(entry)) { quarantinedCount++; continue; }
      const workspaceId = entry.workspaceId ?? entry.projectPath;
      if (!isPersistenceKey(workspaceId) || !isPersistenceKey(entry.projectId) || typeof entry.activeBranch !== 'string' || !entry.activeBranch.trim()) {
        skippedCount++; continue;
      }
      const { projectPath: _legacyPath, ...data } = entry;
      add('branchKnowledge', `${entry.projectId}::${workspaceId}`, { ...data, workspaceId });
    }
  } else if (domain === 'cozea.lastWorkbenchRoute.v1') {
    if (!isPlainRecord(parsed.entriesByWorkspaceSelectionId)) throw new Error('Invalid last-workbench envelope.');
    for (const [identityKey, entry] of Object.entries(parsed.entriesByWorkspaceSelectionId)) {
      if (!isPlainRecord(entry) || entry.workspaceSelectionId !== identityKey) quarantinedCount++;
      else add('lastWorkbenchRoute', identityKey, entry);
    }
  } else {
    add('sessionRegistry', 'registry', parsed);
  }
  return { records, quarantinedCount, skippedCount };
}
