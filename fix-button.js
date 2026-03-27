const fs = require('fs');
let file = fs.readFileSync('src/features/projects/components/assistant/chat/MessagesTimeline.tsx', 'utf8');

file = file.replace(
  'import { ChatMarkdown } from "./ChatMarkdown";',
  'import ChatMarkdown from "./ChatMarkdown";'
);

fs.writeFileSync('src/features/projects/components/assistant/chat/MessagesTimeline.tsx', file);
