const fs = require('fs');

let file = fs.readFileSync('src/features/projects/components/assistant/vscode-icons.ts', 'utf8');

file = file.replace(/from "\.\/vscode-icons-manifest.json"/g, 'from "./vscode-icons-manifest.json"');

file = `// @ts-nocheck\n${file}`;

fs.writeFileSync('src/features/projects/components/assistant/vscode-icons.ts', file);
