const fs = require('fs');
let file = fs.readFileSync('src/lib/wsNativeApi.ts', 'utf8');

file = file.replace(/from "\.\/wsTransport"/g, 'from "@/stores/t3-wsTransport"');

// Bypass the weird ENV logic for WS connection strings
file = file.replace(
  'const transport = new WsTransport();',
  'const transport = new WsTransport(`ws://127.0.0.1:3020`);'
);

file = `// @ts-nocheck\n${file}`;

fs.writeFileSync('src/lib/wsNativeApi.ts', file);
