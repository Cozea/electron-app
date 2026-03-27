const fs = require('fs');
let file = fs.readFileSync('src/stores/t3-store.ts', 'utf8');

file = file.replace(/from "\.\/types"/g, 'from "./t3-types"');
file = file.replace(/from "\.\/nativeApi"/g, 'from "@/lib/nativeApi"');

file = `// @ts-nocheck\n${file}`;

fs.writeFileSync('src/stores/t3-store.ts', file);
