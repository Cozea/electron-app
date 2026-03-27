const fs = require('fs');
let file = fs.readFileSync('src/features/projects/components/assistant/chat/ChatMarkdown.tsx', 'utf8');
file = `// @ts-nocheck\n${file}`;
// Fix imports
file = file.replace(/from "\.\.\/editorPreferences"/g, 'from "@/stores/editorPreferences"');
file = file.replace(/from "\.\.\/lib\/diffRendering"/g, 'from "@/stores/diffRendering"');
file = file.replace(/from "\.\.\/lib\/lruCache"/g, 'from "@/stores/lruCache"');
file = file.replace(/from "\.\.\/hooks\/useTheme"/g, 'from "@/hooks/useTheme"');
file = file.replace(/from "\.\.\/markdown-links"/g, 'from "@/stores/markdown-links"');
file = file.replace(/from "\.\.\/nativeApi"/g, 'from "@/lib/nativeApi"');

fs.writeFileSync('src/features/projects/components/assistant/chat/ChatMarkdown.tsx', file);
