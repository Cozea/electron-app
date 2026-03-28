const fs = require('fs');

let file = fs.readFileSync('src/features/projects/components/assistant/chat/ChatView.tsx', 'utf8');
file = file.replace(/import \{ ContextWindowMeter \} from "\.\/chat\/ContextWindowMeter";/g, 'const ContextWindowMeter = () => null;');
file = file.replace(/import \{ ContextWindowMeter \} from "\.\/ContextWindowMeter";/g, 'const ContextWindowMeter = () => null;');
fs.writeFileSync('src/features/projects/components/assistant/chat/ChatView.tsx', file);
