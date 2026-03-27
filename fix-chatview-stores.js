const fs = require('fs');

let file = fs.readFileSync('src/features/projects/components/assistant/chat/ChatView.tsx', 'utf8');

file = file.replace(/from "\.\.\/store"/g, 'from "@/stores/t3-store"');
file = file.replace(/from "\.\.\/composerDraftStore"/g, 'from "@/stores/t3-composerDraftStore"');
file = file.replace(/from "\.\.\/terminalStateStore"/g, 'from "@/stores/t3-terminalStateStore"');
file = file.replace(/from "\.\.\/env"/g, 'from "@/env"');
file = file.replace(/from "\.\.\/pendingUserInput"/g, 'from "../pendingUserInput"'); // wait, do I have pendingUserInput?

fs.writeFileSync('src/features/projects/components/assistant/chat/ChatView.tsx', file);
