from pathlib import Path
import subprocess

p = Path('tests/navigation/workbenchModelPersistence.test.ts')
s = p.read_text()
old = "vi.spyOn(persistence, 'queueDirtyRecord').mockImplementation(() => {})"
assert s.count(old) == 3
p.write_text(s.replace(old, "vi.spyOn(persistence, 'queueDirtyRecord').mockReturnValue(1)"))

# Read-only merge analysis. The returned tree is NOT checked out or committed.
main = '8e65b729e47c0c1bdfdd8555f55f0338cc95223f'
result = subprocess.run(['git', 'merge-tree', '--write-tree', 'HEAD', main], text=True, capture_output=True)
assert result.returncode in (0, 1), result.stderr
print('MAIN INTEGRATION ANALYSIS')
print(result.stdout)
lines = result.stdout.splitlines()
if result.returncode == 1 and lines:
    tree = lines[0]
    conflicts = set()
    for line in lines[1:]:
        if '\t' in line and line.split('\t', 1)[0].split()[-1:] == ['1']:
            conflicts.add(line.split('\t', 1)[1])
    for filename in sorted(conflicts):
        print('CONFLICT DETAILS', filename)
        data = subprocess.run(['git', 'show', f'{tree}:{filename}'], text=True, capture_output=True)
        filelines = data.stdout.splitlines()
        ranges = set()
        for i, line in enumerate(filelines):
            if line.startswith(('<<<<<<<', '=======', '>>>>>>>')):
                ranges.update(range(max(0, i - 8), min(len(filelines), i + 14)))
        for i in sorted(ranges):
            print(f'{i + 1}: {filelines[i]}')
print('Typed revision mocks repaired. No main merge performed.')
