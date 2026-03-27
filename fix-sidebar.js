const fs = require('fs');

let file = fs.readFileSync('src/components/terminal/AITerminalSidebar.tsx', 'utf8');
file = file.replace(
  "import { NativeChatView } from '@/features/projects/components/assistant/chat/NativeChatView'",
  "import ChatView from '@/features/projects/components/assistant/chat/ChatView'"
);
file = file.replace(
  "<NativeChatView threadId={activeSession.terminalId} />",
  "<ChatView threadId={activeSession.terminalId} />"
);

fs.writeFileSync('src/components/terminal/AITerminalSidebar.tsx', file);
