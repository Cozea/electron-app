import type { DesktopPersistenceApi, DesktopStateNamespace, LegacyDesktopDomain } from '@shared/desktopPersistenceTypes';

const dependencies: Record<Exclude<DesktopStateNamespace, 'sessionRegistry'>, readonly LegacyDesktopDomain[]> = {
  workbenchLayout: ['cozea:project-workbench-layouts', 'cozea:project-workbench'],
  workbenchModel: ['cozea:project-workbench-layouts', 'cozea:project-workbench'],
  queryCache: ['cozea-query-cache'],
  lastWorkbenchRoute: ['cozea.lastWorkbenchRoute.v1'],
  branchKnowledge: ['cozea:project-branch-sessions:v1'],
};
const completed = new Set<LegacyDesktopDomain>();
const pending = new Map<LegacyDesktopDomain, Promise<void>>();
const legacyBytes = new Map<LegacyDesktopDomain, string | null>();

function migrateDomain(domain: LegacyDesktopDomain): Promise<void> {
  if (completed.has(domain)) return Promise.resolve();
  const existing = pending.get(domain);
  if (existing) return existing;
  const operation = Promise.resolve().then(async () => {
    if (typeof window === 'undefined') return;
    const api = window.electronAPI?.desktopPersistence as DesktopPersistenceApi | undefined;
    if (!api) throw new Error('The desktop persistence bridge is unavailable.');
    // One intentional legacy read per domain; original bytes remain untouched.
    if (!legacyBytes.has(domain)) legacyBytes.set(domain, window.localStorage.getItem(domain));
    const rawPayload = legacyBytes.get(domain);
    if (rawPayload?.trim()) await api.migrateLegacy({ domain, rawPayload });
    completed.add(domain);
  });
  pending.set(domain, operation);
  void operation.finally(() => { if (pending.get(domain) === operation) pending.delete(domain); }).catch(() => undefined);
  return operation;
}

export async function ensureLegacyDesktopNamespace(namespace: DesktopStateNamespace): Promise<void> {
  if (namespace === 'sessionRegistry') throw new Error('The session registry is main-process owned.');
  // Dedicated layouts win over the older layout embedded in a workbench model.
  for (const domain of dependencies[namespace]) await migrateDomain(domain);
}

export async function migrateLegacyDesktopState(): Promise<void> {
  for (const namespace of ['workbenchLayout', 'workbenchModel', 'queryCache', 'lastWorkbenchRoute'] as const) {
    await ensureLegacyDesktopNamespace(namespace);
  }
}
