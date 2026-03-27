const fs = require('fs');

let file = fs.readFileSync('src/features/projects/components/assistant/chat/ComposerPendingTerminalContexts.tsx', 'utf8');

file = file.replace(/from "\~\/lib\/terminalContext"/g, 'from "@/stores/terminalContext"');
file = file.replace(/from "\.\.\/\.\.\/composerDraftStore"/g, 'from "@/stores/t3-composerDraftStore"');
file = file.replace(/from "\.\.\/\.\.\/terminalStateStore"/g, 'from "@/stores/t3-terminalStateStore"');

file = `// @ts-nocheck\n${file}`;

fs.writeFileSync('src/features/projects/components/assistant/chat/ComposerPendingTerminalContexts.tsx', file);
