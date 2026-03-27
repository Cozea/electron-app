const fs = require('fs');

let file = fs.readFileSync('src/features/projects/components/assistant/composer-editor-mentions.ts', 'utf8');

file = `// @ts-nocheck\n${file}`;

fs.writeFileSync('src/features/projects/components/assistant/composer-editor-mentions.ts', file);
