const fs = require('fs');

let file = fs.readFileSync('src/hooks/useWorkspaceSourceControl.ts', 'utf8');
file = file.replace(/\.\.\.\(options\.metadata \?\? \{\}\),/g, '...(options.metadata ? options.metadata : {}),');
fs.writeFileSync('src/hooks/useWorkspaceSourceControl.ts', file);
