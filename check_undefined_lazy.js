import * as fs from 'fs';

const files = [
  'src/features/projects/components/workbench/WorkbenchDockPanels.tsx'
];

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const regex = /import\(['"]([^'"]+)['"]\)\.then\(\(m(?:odule)?\)\s*=>\s*\(\{\s*default:\s*(?:m|module)\.([^,\}]+)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    console.log(match[1], match[2]);
  }
}
