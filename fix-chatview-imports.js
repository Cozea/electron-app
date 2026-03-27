const fs = require('fs');

let file = fs.readFileSync('src/features/projects/components/assistant/chat/ChatView.tsx', 'utf8');

file = file.replace(/import \{ gitBranchesQueryOptions, gitCreateWorktreeMutationOptions \} from "@\/features\/projects\/components\/assistant\/lib\/gitReactQuery";/g, '');
file = file.replace(/import \{ projectSearchEntriesQueryOptions \} from "@\/features\/projects\/components\/assistant\/lib\/projectReactQuery";/g, '');
file = file.replace(/import \{ serverConfigQueryOptions, serverQueryKeys \} from "@\/features\/projects\/components\/assistant\/lib\/serverReactQuery";/g, '');
file = file.replace(/import \{ parseDiffRouteSearch, stripDiffSearchParams \} from "@\/features\/projects\/components\/assistant\/diffRouteSearch";/g, 'const parseDiffRouteSearch = () => ({}); const stripDiffSearchParams = () => {};');

// Replace settings store to not fail
file = file.replace(/const settings = useSettings\(\);/g, 'const settings = { timestampFormat: "locale" };');
file = file.replace(/import \{ useSettings \} from "[^"]+";/g, '');

fs.writeFileSync('src/features/projects/components/assistant/chat/ChatView.tsx', file);
