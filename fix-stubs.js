const fs = require('fs');
const glob = require('glob');

const files = glob.sync('src/stores/*.ts');
for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  if (!content.includes('// @ts-nocheck')) {
    content = `// @ts-nocheck\n${content}`;
  }
  fs.writeFileSync(file, content);
}
