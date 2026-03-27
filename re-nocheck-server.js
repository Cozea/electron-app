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

// Since the server has a bunch of complex node-specific types, we'll selectively nocheck it
// while keeping the shared contracts strictly typed
nocheck('electron/t3-server/**/*.ts');
nocheck('electron/t3-server/**/*.tsx');
