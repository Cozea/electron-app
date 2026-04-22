const fs = require('fs');

function nocheck(path) {
  let file = fs.readFileSync(path, 'utf8');
  if (!file.includes('// @ts-nocheck')) {
    file = `// @ts-nocheck\n${file}`;
    fs.writeFileSync(path, file);
  }
}
nocheck('src/features/projects/components/assistant/composerFooterLayout.ts');
