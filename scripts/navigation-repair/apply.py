from pathlib import Path
import subprocess

# Replay the exact reviewed staging payload; the preceding job failed only the
# whitespace gate before committing, so none of its generated sources exist yet.
source = subprocess.check_output(['git', 'show', '5c447eb6a4630310724265346d660d5a07461c6a:scripts/navigation-repair/apply.py'], text=True)
exec(compile(source, 'resource-repair-stage', 'exec'))
p = Path('apps/desktop/src/app/resources/workspaceResources.ts')
s = p.read_text()
old = 'workspaceCatalogResource.observe((next, previous) => {\n  const projectIds'
assert s.count(old) == 1
s = s.replace(old, '''workspaceCatalogResource.observe((next, previous) => {
  // Initial resolution requests may be waiting for this first snapshot. There
  // is no previous binding to revoke, so do not supersede those very requests.
  if (!previous) return;
  const projectIds''', 1)
old = '  const idle = maps.flatMap(map => Array.from(map.values()).filter(resource => resource.idle));'
assert s.count(old) == 1
s = s.replace(old, '''  const candidates = [...resolutionResources.values(), ...gitStatusResources.values(), ...laneResources.values()];
  const idle = candidates.filter(resource => resource.idle);''', 1)
p.write_text(s.rstrip() + '\n')
print('Initial catalog demand remains current; generated resource file passes EOF whitespace policy.')
