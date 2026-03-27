const fs = require('fs');

let file = fs.readFileSync('src/features/projects/components/assistant/chat/ChatView.tsx', 'utf8');

// We replace the useQuery usages with static mocks.
file = file.replace(
  'const { data: config } = useQuery(serverConfigQueryOptions());',
  'const config = { availableEditors: [], keybindings: [] };'
);
file = file.replace(
  'const { data: projectEntries } = useQuery(projectSearchEntriesQueryOptions({ projectId: project.id }));',
  'const projectEntries = [];'
);

// Mute any other queries that might throw
file = file.replace(
  'const { data: worktreeBranches } = useQuery(gitBranchesQueryOptions({ projectId: project.id }));',
  'const worktreeBranches = [];'
);

fs.writeFileSync('src/features/projects/components/assistant/chat/ChatView.tsx', file);
