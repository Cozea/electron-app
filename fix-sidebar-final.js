const fs = require('fs');
let file = fs.readFileSync('src/components/terminal/AITerminalSidebar.tsx', 'utf8');

file = file.replace(
  /const api = ensureNativeApi\(\);\n\s*const thread = await api\.server\.createThread\(\{[\s\S]*?\}\);\n\s*terminalId = thread\.id;/g,
  'terminalId = crypto.randomUUID();'
);
file = file.replace(
  /          createdAt,\n        \}\)/g,
  '        })'
);

fs.writeFileSync('src/components/terminal/AITerminalSidebar.tsx', file);
