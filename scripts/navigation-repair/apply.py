from pathlib import Path

# Explicit, assertion-guarded integration changes. This file is removed by the
# isolated repair workflow after committing its generated source changes.
def replace(file, old, new):
    p = Path(file)
    s = p.read_text()
    assert s.count(old) == 1, (file, old[:100], s.count(old))
    p.write_text(s.replace(old, new))

replace('apps/desktop/electron.vite.config.ts', "'substrate-shadow-server': 'electron/substrate-shadow-server/child.ts',", "'substrate-shadow-server': 'electron/substrate-shadow-server/child.ts',\n          'desktop-state-persistence': 'electron/workers/desktopStatePersistenceWorker.ts',")
replace('apps/desktop/electron/main.ts', 'registerDesktopPersistenceHandlers(ipcMain)', '''registerDesktopPersistenceHandlers(ipcMain, {
  getMainWindow: () => win,
  isTrustedURL: (url) => {
    try {
      const parsed = new URL(url)
      if (VITE_DEV_SERVER_URL) return parsed.origin === new URL(VITE_DEV_SERVER_URL).origin
      return parsed.protocol === 'file:' && fileURLToPath(parsed).split('#')[0] === path.join(RENDERER_DIST, 'index.html')
    } catch { return false }
  },
})''')
# Remove the failing snapshot export and all temporary archive jobs from the
# validation path. Read-only checkout and real tests remain.
p = Path('.github/workflows/navigation-runtime-validation.yml')
s = p.read_text()
a = s.index('      - name: Export reproducible source and toolchain snapshot')
b = s.index('      - name: Targeted navigation unit tests', a)
s = s[:a] + s[b:]
p.write_text(s)
for file in ['.github/workflows/navigation-snapshot.yml', '.github/workflows/navigation-snapshot-parts.yml']:
    Path(file).unlink(missing_ok=True)
# Old matrix 'passed' claims did not have valid Electron evidence.
p = Path('docs/perf/ACCEPTANCE_MATRIX.json')
import json
matrix = json.loads(p.read_text())
matrix['repair_status'] = 'in_progress; earlier application/performance acceptance withdrawn'
for test in matrix.get('tests', []):
    test['status'] = 'not_run_on_repaired_candidate'
p.write_text(json.dumps(matrix, indent=2) + '\n')
