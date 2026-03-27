const fs = require('fs');

let pref = fs.readFileSync('src/stores/editorPreferences.ts', 'utf8');
pref = pref.replace(/from "\.\/hooks\/useLocalStorage"/g, 'from "@/hooks/useLocalStorage"');
fs.writeFileSync('src/stores/editorPreferences.ts', pref);

let mdLinks = fs.readFileSync('src/stores/markdown-links.ts', 'utf8');
mdLinks = mdLinks.replace(/from "\.\/terminal-links"/g, 'from "@/lib/terminalLinks"');
mdLinks = mdLinks.replace(/from "\.\/nativeApi"/g, 'from "@/lib/nativeApi"');
fs.writeFileSync('src/stores/markdown-links.ts', mdLinks);
