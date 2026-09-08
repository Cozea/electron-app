/**
 * Client Migration Orchestrator for Legacy Desktop State
 * Conforms to Section 10.9 of docs/perf/navigation-runtime-plan.md
 */

const LEGACY_DOMAINS = [
  'cozea-query-cache',
  'cozea:project-workbench',
  'cozea:project-workbench-layouts',
] as const;

let migrationStarted = false;

export async function migrateLegacyDesktopState(): Promise<void> {
  if (migrationStarted || typeof window === 'undefined') return;
  migrationStarted = true;

  const api = window.electronAPI?.desktopPersistence;
  if (!api) return;

  for (const domain of LEGACY_DOMAINS) {
    try {
      const rawPayload = window.localStorage.getItem(domain);
      if (rawPayload && rawPayload.trim().length > 0) {
        await api.migrateLegacy({ domain, rawPayload });
      }
    } catch (err) {
      console.warn(`[LegacyMigration] Failed migrating domain ${domain}:`, err);
    }
  }
}
