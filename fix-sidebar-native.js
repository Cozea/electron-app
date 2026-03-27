const fs = require('fs');
let file = fs.readFileSync('src/components/terminal/AITerminalSidebar.tsx', 'utf8');

file = file.replace(
  "import { MessagesTimeline } from '@/features/projects/components/assistant/chat/MessagesTimeline'",
  "import { NativeChatView } from '@/features/projects/components/assistant/chat/NativeChatView'"
);

file = file.replace(
  "<MessagesTimeline threadId={activeSession.terminalId} />",
  "<NativeChatView threadId={activeSession.terminalId} />"
);

fs.writeFileSync('src/components/terminal/AITerminalSidebar.tsx', file);
