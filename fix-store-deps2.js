const fs = require('fs');

let file = fs.readFileSync('src/stores/editorPreferences.ts', 'utf8');
file = file.replace('import { EDITORS, EditorId, NativeApi } from "@t3tools/contracts";', 'import { EDITORS, EditorId } from "@t3tools/contracts";\nimport type { NativeApi } from "@t3tools/contracts";');
fs.writeFileSync('src/stores/editorPreferences.ts', file);
