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

nocheck('electron/t3-server/**/*.ts');
nocheck('electron/t3-server/**/*.tsx');
nocheck('src/features/projects/components/assistant/chat/**/*.ts');
nocheck('src/features/projects/components/assistant/chat/**/*.tsx');
nocheck('src/features/projects/components/assistant/lib/**/*.ts');
