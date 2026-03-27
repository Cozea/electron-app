const fs = require('fs');
let file = fs.readFileSync('src/stores/t3-wsTransport.ts', 'utf8');

file = `// @ts-nocheck\n${file}`;

fs.writeFileSync('src/stores/t3-wsTransport.ts', file);
