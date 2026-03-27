const fs = require('fs');
const glob = require('glob');

function removeNocheck(pattern) {
  const files = glob.sync(pattern);
  for (const file of files) {
    let content = fs.readFileSync(file, 'utf8');
    if (content.startsWith('// @ts-nocheck\n')) {
      content = content.substring('// @ts-nocheck\n'.length);
      fs.writeFileSync(file, content);
    }
  }
}

removeNocheck('shared/t3-contracts/**/*.ts');
removeNocheck('shared/t3-shared/**/*.ts');
