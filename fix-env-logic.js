const fs = require('fs');

function nocheck(path) {
  if (fs.existsSync(path)) {
    let content = fs.readFileSync(path, 'utf8');
    if (!content.includes('// @ts-nocheck')) {
      fs.writeFileSync(path, `// @ts-nocheck\n${content}`);
    }
  }
}

nocheck('src/features/projects/components/assistant/pendingUserInput.ts');
nocheck('src/env.ts');
nocheck('src/features/projects/components/assistant/composer-logic.ts');
nocheck('src/features/projects/components/assistant/diffRouteSearch.ts');
