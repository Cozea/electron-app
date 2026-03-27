const fs = require('fs');
let file = fs.readFileSync('src/stores/useAgentChatStore.ts', 'utf8');

file = file.replace(
  "import { AgentChatMessage, AgentChatToolCall, AgentChatThread } from '../../shared/agentChatTypes';",
  "import type { AgentChatMessage, AgentChatToolCall, AgentChatThread } from '../../shared/agentChatTypes';"
);

file = file.replace(
  "loadThread: async (projectId, threadId) => {",
  "loadThread: async (_projectId, threadId) => {"
);

fs.writeFileSync('src/stores/useAgentChatStore.ts', file);
