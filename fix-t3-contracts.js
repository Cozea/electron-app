const fs = require('fs');
const glob = require('glob');

const files = glob.sync('shared/t3-contracts/**/*.ts');
for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');

  content = content.replace(/Schema\.Literal\(([a-zA-Z0-9_]+)\)/g, 'Schema.Literal(...$1)');
  content = content.replace(/\.isNonEmpty\(\)/g, '.pipe(Schema.nonEmptyString())');
  content = content.replace(/Schema\.Int/g, 'Schema.Number.pipe(Schema.int())');
  content = content.replace(/Schema\.Trim\.check/g, 'Schema.decodeUnknownSync(Schema.Trim)');
  content = content.replace(/typeof Trim/g, 'typeof Schema.Trim');
  content = content.replace(/typeof Int/g, 'typeof Schema.Number');
  content = content.replace(/Schema\.Boolean/g, 'Schema.Boolean');
  content = content.replace(/Schema\.Number/g, 'Schema.Number');
  content = content.replace(/Schema\.String/g, 'Schema.String');
  content = content.replace(/typeof Boolean\$/g, 'typeof Schema.Boolean');
  content = content.replace(/typeof Number\$/g, 'typeof Schema.Number');
  content = content.replace(/typeof String\$/g, 'typeof Schema.String');
  
  // They used `import { Schema, ParseResult } from "effect";`
  // But sometimes `typeof Boolean$` was an alias.
  content = content.replace(/typeof Boolean/g, 'typeof Schema.Boolean');
  
  content = content.replace(/\.check\(/g, 'Schema.decodeUnknownSync(');

  fs.writeFileSync(file, content);
}
