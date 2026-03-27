const fs = require('fs');

let file = fs.readFileSync('src/features/projects/components/assistant/chat/ChatView.tsx', 'utf8');

file = file.replace(/const ComposerPromptEditor = \(\) => null;/g, 'import ComposerPromptEditor from "./ComposerPromptEditor";');

fs.writeFileSync('src/features/projects/components/assistant/chat/ChatView.tsx', file);
