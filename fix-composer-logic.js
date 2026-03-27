const fs = require('fs');

let file = fs.readFileSync('src/features/projects/components/assistant/chat/ComposerPromptEditor.tsx', 'utf8');
file = file.replace(/from "\~\/composer-logic"/g, 'from "../composer-logic"');
fs.writeFileSync('src/features/projects/components/assistant/chat/ComposerPromptEditor.tsx', file);
