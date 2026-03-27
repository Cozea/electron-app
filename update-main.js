const fs = require('fs');
let main = fs.readFileSync('electron/main.ts', 'utf8');

main = main.replace(
  "import { syncShellEnvironment } from './syncShellEnvironment'",
  "import { syncShellEnvironment } from './syncShellEnvironment'\nimport { agentProviderService } from './services/AgentProviderService'\nimport { agentChatService } from './services/AgentChatService'"
);

main = main.replace(
  "  if (isDev) {",
  "  agentChatService.init();\n  agentProviderService.setWindow(mainWindow);\n  agentProviderService.registerIpcHandlers();\n\n  if (isDev) {"
);

fs.writeFileSync('electron/main.ts', main);
