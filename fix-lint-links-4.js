const fs = require('fs');
let file = fs.readFileSync('src/lib/terminalLinks.ts', 'utf8');

file = file.replace(
  'return `${resolvedPath}:${line}${column ? \\`:${column}\\` : ""}`',
  'return `${resolvedPath}:${line}${column ? `:${column}` : ""}`'
);

fs.writeFileSync('src/lib/terminalLinks.ts', file);
