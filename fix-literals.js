const fs = require('fs');
const glob = require('glob');

const files = glob.sync('shared/t3-contracts/**/*.ts');
for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');

  // Find Schema.Literal(SomeArrayConst) where SomeArrayConst is an all-caps identifier
  content = content.replace(/Schema\.Literal\(([A-Z0-9_]+)\)/g, 'Schema.Literal(...$1)');

  fs.writeFileSync(file, content);
}
