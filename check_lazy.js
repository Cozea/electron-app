import fs from 'fs';

const files = [
  'src/App.tsx',
  'src/features/projects/contexts/ProjectSyncContext.tsx',
  'src/features/projects/workspaces/WorkspaceRuntimeHostsGate.tsx',
  'src/features/projects/components/assistant/chat/ChatMarkdown.tsx',
  'src/features/projects/components/CreateProjectDialogHost.tsx',
  'src/features/projects/components/ProjectSidebar.tsx',
  'src/features/projects/layouts/ProjectLayout.tsx',
  'src/features/projects/pages/ProjectWorkbenchPage.tsx',
  'src/features/projects/pages/ProjectWorkbenchSurface.tsx',
  'src/components/layouts/UnifiedHeader.tsx',
];

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const regex = /import\(['"]([^'"]+)['"]\)\.then\(\(m(?:odule)?\)\s*=>\s*\(\{\s*default:\s*(?:m|module)\.([^,\}]+)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    console.log(`Checking ${match[1]} for export ${match[2]}`);
  }
}
