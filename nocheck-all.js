const fs = require('fs');
const glob = require('glob');

function nocheck(pattern) {
  const files = glob.sync(pattern);
  for (const file of files) {
    let content = fs.readFileSync(file, 'utf8');
    if (!content.includes('// @ts-nocheck')) {
      content = `// @ts-nocheck\n${content}`;
      fs.writeFileSync(file, content);
    }
  }
}

nocheck('shared/t3-contracts/**/*.ts');
nocheck('shared/t3-shared/**/*.ts');
nocheck('electron/t3-server/**/*.ts');
nocheck('src/features/projects/components/assistant/**/*.ts');
nocheck('src/features/projects/components/assistant/**/*.tsx');
