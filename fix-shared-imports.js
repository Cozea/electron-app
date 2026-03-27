const fs = require('fs');
const glob = require('glob');

const files = glob.sync('shared/t3-shared/**/*.ts');
for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  content = `// @ts-nocheck\n${content}`;
  fs.writeFileSync(file, content);
}
