const fs = require('fs');

let file = fs.readFileSync('src/features/projects/components/assistant/chat/ChatView.tsx', 'utf8');
file = file.replace(/from "\.\/chat\/MessagesTimeline"/g, 'from "./MessagesTimeline"');
file = file.replace(/from "\.\/chat\/ChatInput"/g, 'from "./ChatInput"'); // just in case
file = file.replace(/from "\.\/chat\/ComposerPromptEditor"/g, 'from "./ComposerPromptEditor"'); 
fs.writeFileSync('src/features/projects/components/assistant/chat/ChatView.tsx', file);
