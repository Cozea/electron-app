const fs = require('fs');

let file = fs.readFileSync('src/features/projects/components/assistant/chat/ChatView.tsx', 'utf8');
file = file.replace(/from "\.\.\/modelSelection"/g, 'from "@/stores/t3-modelSelection"');
fs.writeFileSync('src/features/projects/components/assistant/chat/ChatView.tsx', file);
