const fs = require('fs');
let file = fs.readFileSync('src/features/projects/components/assistant/chat/ChatView.tsx', 'utf8');

file = file.replace(
  /import \{ buildProjectScriptSequenceId, resolveProjectScriptSequence \} from "\~\/lib\/projectScriptKeybindings";/g,
  'const buildProjectScriptSequenceId = () => ""; const resolveProjectScriptSequence = () => null;'
);

fs.writeFileSync('src/features/projects/components/assistant/chat/ChatView.tsx', file);
