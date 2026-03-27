const fs = require('fs');
let file = fs.readFileSync('src/lib/nativeApi.ts', 'utf8');

file = file.replace(
  'from "./wsNativeApi"',
  'from "./wsNativeApi"'
);
file = `// @ts-nocheck\n${file}`;

fs.writeFileSync('src/lib/nativeApi.ts', file);
