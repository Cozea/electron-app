const fs = require('fs');

let file = fs.readFileSync('src/features/projects/components/assistant/chat/ChatView.tsx', 'utf8');
file = file.replace(/import \{ PullRequestThreadDialog \} from "\.\/PullRequestThreadDialog";/g, 'const PullRequestThreadDialog = () => null;');
fs.writeFileSync('src/features/projects/components/assistant/chat/ChatView.tsx', file);
