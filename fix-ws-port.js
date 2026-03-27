const fs = require('fs');
let file = fs.readFileSync('src/lib/wsNativeApi.ts', 'utf8');

file = file.replace(/3020/g, '3773');

fs.writeFileSync('src/lib/wsNativeApi.ts', file);
