from pathlib import Path


def replace(path, old, new):
    target = Path(path)
    source = target.read_text()
    assert source.count(old) == 1, f"Expected exactly one anchor in {path}"
    target.write_text(source.replace(old, new, 1))

replace(
    'apps/desktop/src/app/model/persistence/desktopPersistenceClient.ts',
    '''  constructor(
    private readonly getAPI: () => DesktopPersistenceAPI | null = () => typeof window === 'undefined' ? null : window.electronAPI?.desktopPersistence ?? null,
    private readonly migrate: () => Promise<void> = migrateLegacyDesktopState,
  ) {}''',
    '''  private readonly getAPI: () => DesktopPersistenceAPI | null
  private readonly migrate: () => Promise<void>
  constructor(
    getAPI: () => DesktopPersistenceAPI | null = () => typeof window === 'undefined' ? null : window.electronAPI?.desktopPersistence ?? null,
    migrate: () => Promise<void> = migrateLegacyDesktopState,
  ) {
    this.getAPI = getAPI
    this.migrate = migrate
  }''',
)
replace(
    'apps/desktop/src/app/model/persistence/desktopPersistenceClient.ts',
    'if (old?.data === data && !old.deleted) return',
    'if (old && old.data === data && !old.deleted) return',
)
replace(
    'apps/desktop/electron/services/DesktopStatePersistenceService.ts',
    "  constructor(private readonly userDataPath = app.getPath('userData'), private readonly workerPath = path.join(__dirname, 'desktop-state-persistence.js')) {}",
    """  private readonly userDataPath: string
  private readonly workerPath: string
  constructor(userDataPath = app.getPath('userData'), workerPath = path.join(__dirname, 'desktop-state-persistence.js')) {
    this.userDataPath = userDataPath
    this.workerPath = workerPath
  }""",
)
replace(
    'apps/desktop/src/lib/workbenchStore.ts',
    '''  void import("@/app/model/persistence/desktopPersistenceClient").then(({ desktopPersistenceClient }) => {
    void desktopPersistenceClient.flush()
  })''',
    '''  if (typeof window !== "undefined" && window.electronAPI?.desktopPersistence) {
    void import("@/app/model/persistence/desktopPersistenceClient")
      .then(({ desktopPersistenceClient }) => desktopPersistenceClient.flush())
      .catch(error => console.error("[Workbench] Persistence flush failed", error))
  }''',
)
print('Applied strict erasable-syntax constructors, safe optional record guard, and handled flush rejection.')
