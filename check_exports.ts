import fs from 'fs';

function checkExport(filePath: string, exportName: string) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content.includes(`export function ${exportName}`) && !content.includes(`export const ${exportName}`) && !content.includes(`export default`)) {
      console.log(`ERROR: ${exportName} NOT FOUND in ${filePath}`);
    } else {
      console.log(`OK: ${exportName} found in ${filePath}`);
    }
  } catch (e) {
    console.log(`ERROR reading ${filePath}`);
  }
}

checkExport('src/features/projects/components/workbench/WorkbenchAssistantChatTile.tsx', 'WorkbenchAssistantChatTile');
checkExport('src/features/projects/components/workbench/WorkbenchBrowserTile.tsx', 'WorkbenchBrowserTile');
checkExport('src/features/projects/components/workbench/WorkbenchDevServerTile.tsx', 'WorkbenchDevServerTile');
checkExport('src/features/projects/components/workbench/WorkbenchDevServerTile.tsx', 'WorkbenchMobileSimulatorTile');
checkExport('src/features/projects/components/workbench/WorkbenchSelectionTile.tsx', 'WorkbenchSelectionTile');
checkExport('src/features/projects/components/workbench/WorkbenchTerminalTile.tsx', 'WorkbenchTerminalTile');
checkExport('src/features/projects/pages/ProjectWorkbenchSurface.tsx', 'ProjectWorkbenchSurface');
checkExport('src/features/projects/pages/ChangesPage.tsx', 'ChangesPage');
checkExport('src/features/projects/pages/ProjectSettingsPage.tsx', 'ProjectSettingsPage');
checkExport('src/features/projects/components/TaskFocusOverlay.tsx', 'TaskFocusOverlay');
checkExport('src/features/projects/components/workbench/WorkbenchDockviewCanvas.tsx', 'WorkbenchDockviewCanvas');
checkExport('src/pages/NewProject.tsx', 'default');
checkExport('src/features/projects/components/assistant/chat/ChatCodeHighlighter.tsx', 'ChatCodeHighlighter');

