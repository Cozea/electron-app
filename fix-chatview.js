const fs = require('fs');
let file = fs.readFileSync('src/features/projects/components/assistant/chat/ChatView.tsx', 'utf8');

// Fix paths in ChatView
file = file.replace(/~\/lib\/gitReactQuery/g, '@/features/projects/components/assistant/lib/gitReactQuery');
file = file.replace(/~\/lib\/projectReactQuery/g, '@/features/projects/components/assistant/lib/projectReactQuery');
file = file.replace(/~\/lib\/serverReactQuery/g, '@/features/projects/components/assistant/lib/serverReactQuery');
file = file.replace(/\.\.\/env/g, '@/env'); // Not sure where env is, maybe stub
file = file.replace(/\.\.\/diffRouteSearch/g, '@/features/projects/components/assistant/diffRouteSearch'); // Not sure where diffRouteSearch is
file = file.replace(/\.\.\/composer-logic/g, '@/features/projects/components/assistant/composer-logic'); 
file = file.replace(/\.\.\/session-logic/g, './session-logic');
file = file.replace(/\.\.\/chat-scroll/g, './chat-scroll');
file = file.replace(/\.\.\/pendingUserInput/g, '@/features/projects/components/assistant/pendingUserInput');
file = file.replace(/\.\.\/store/g, '@/stores/t3-store');
file = file.replace(/\.\.\/terminalStateStore/g, '@/stores/t3-terminalStateStore');
file = file.replace(/\.\.\/composerDraftStore/g, '@/stores/t3-composerDraftStore');
file = file.replace(/\.\.\/lib\/lruCache/g, '../lib/lruCache');

fs.writeFileSync('src/features/projects/components/assistant/chat/ChatView.tsx', file);
