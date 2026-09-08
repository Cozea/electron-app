from pathlib import Path

def replace(file, old, new):
    p = Path(file)
    text = p.read_text()
    assert text.count(old) == 1, (file, old[:100], text.count(old))
    p.write_text(text.replace(old, new))

replace('apps/desktop/electron.vite.config.ts', "'substrate-shadow-server': 'electron/substrate-shadow-server/child.ts',", "'substrate-shadow-server': 'electron/substrate-shadow-server/child.ts',\n          'desktop-state-persistence': 'electron/workers/desktopStatePersistenceWorker.ts',")
replace('apps/desktop/electron/main.ts', 'registerDesktopPersistenceHandlers(ipcMain)', '''registerDesktopPersistenceHandlers(ipcMain, {
  getMainWindow: () => win,
  isTrustedURL: (url) => {
    try {
      const parsed = new URL(url)
      if (VITE_DEV_SERVER_URL) return parsed.origin === new URL(VITE_DEV_SERVER_URL).origin
      return parsed.protocol === 'file:' && fileURLToPath(parsed) === path.join(RENDERER_DIST, 'index.html')
    } catch { return false }
  },
})''')
replace('apps/desktop/src/features/workbench/WorkbenchDockviewSession.tsx', '    ensureWorkbenchLayoutPersistenceReady()\n    setIsLayoutPersistenceReady(true)', '''    let cancelled = false
    void ensureWorkbenchLayoutPersistenceReady(workbenchScopeKey).then(() => {
      if (!cancelled) setIsLayoutPersistenceReady(true)
    }).catch((error) => {
      console.error('[Workbench] Layout restoration failed; refusing empty initialization', error)
    })
    return () => { cancelled = true }''')
replace('apps/desktop/src/features/workbench/WorkbenchDockviewSession.tsx', '  }, [legacyWorkbenchScopeKey, projectWorkbench, workbenchScopeKey])', '  }, [isLayoutPersistenceReady, legacyWorkbenchScopeKey, projectWorkbench, workbenchScopeKey])')
service = 'apps/desktop/electron/services/DesktopStatePersistenceService.ts'
replace(service, '  private failed = new Map<number, string>()', '  private failed = new Map<string, { watermark: number; error: string }>()')
replace(service, '        this.committedWatermark = watermark', '''        for (const record of records) this.failed.delete(JSON.stringify([record.namespace, record.key]))
        this.committedWatermark = watermark''')
replace(service, '        this.failed.set(watermark, message)', '        for (const record of records) this.failed.set(JSON.stringify([record.namespace, record.key]), { watermark, error: message })')
replace(service, "    const failures = [...this.failed].filter(([revision]) => revision <= targetRevision)", "    const failures = [...this.failed.values()].filter(failure => failure.watermark <= targetRevision)")
replace(service, "failures.map(([, error]) => error).join('; ')", "failures.map(failure => failure.error).join('; ')")
replace(service, '  async dispose(): Promise<void>', '  getWorkerThreadId(): number | null { return this.worker?.threadId ?? null }\n  async dispose(): Promise<void>')
core = 'apps/desktop/electron/workers/desktopStatePersistenceWorkerCore.ts'
replace(core, '    const encoded = records.map(record => {', '    let encoded: { record: DesktopStateRecord; json: string }[]\n    try { encoded = records.map(record => {')
replace(core, '    })\n    try {\n      for (const { record, json } of encoded)', "    }) } catch (error) { return { status: 'error', committedRevisions, errorMessage: errorText(error) } }\n    try {\n      for (const { record, json } of encoded)")
# Correct fixtures to the actual baseline envelope, without removing the tests.
test = 'tests/electron/navigation/desktopStatePersistence.test.ts'
replace(test, "      'p1::collab': { orientation: 'LEGACY_VERTICAL' },", "      version: 1, layouts: { 'p1::collab': { layout: { grid: {}, panels: {} }, layoutResetKey: 0 } },")
replace(test, 'expect(flushResult.flushedRevision).toBeGreaterThanOrEqual(42)', 'expect(flushResult.flushedRevision).toBe(1) // core counts completed commands, never maximum record version')
import json
p = Path('docs/perf/ACCEPTANCE_MATRIX.json')
matrix = json.loads(p.read_text())
matrix['repair_status'] = 'in_progress; earlier Electron/performance acceptance withdrawn'
for group in ['tests', 'scenarios']:
    for test in matrix.get(group, []):
        test['status'] = 'not_run_on_repaired_candidate'
p.write_text(json.dumps(matrix, indent=2) + '\n')
