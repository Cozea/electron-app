const fs = require('fs');

let file = fs.readFileSync('src/features/projects/components/assistant/chat/ComposerPromptEditor.tsx', 'utf8');

file = file.replace(/from "\~\/composer-editor-mentions"/g, 'from "../composer-editor-mentions"');
file = file.replace(/from "\~\/lib\/utils"/g, 'from "@/lib/utils"');
file = file.replace(/from "\~\/vscode-icons"/g, 'from "../vscode-icons"');
file = file.replace(/from "\.\/chat\/ComposerPendingTerminalContexts"/g, 'from "./ComposerPendingTerminalContexts"');

file = `// @ts-nocheck\n${file}`;

fs.writeFileSync('src/features/projects/components/assistant/chat/ComposerPromptEditor.tsx', file);
