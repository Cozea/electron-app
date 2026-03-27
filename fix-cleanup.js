const fs = require('fs');
let file = fs.readFileSync('src/features/projects/components/TerminalInstance.tsx', 'utf8');

file = file.replace("      selectionDisposable.dispose()\n", "");

fs.writeFileSync('src/features/projects/components/TerminalInstance.tsx', file);
