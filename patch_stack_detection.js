const fs = require('fs');

let content = fs.readFileSync('src/pages/NewProject.tsx', 'utf8');

if (!content.includes('detectFramework')) {
  content = content.replace(
    "import { buildProjectPath, isRepoIntegrationProvider } from '@/features/projects/lib/projectPaths'",
    "import { buildProjectPath, isRepoIntegrationProvider } from '@/features/projects/lib/projectPaths'\nimport { detectFramework } from '@/utils/projectDetector'"
  );
}

if (!content.includes('updateProjectMetadata')) {
  content = content.replace(
    "import { api } from '@convex/_generated/api'",
    "import { api } from '@convex/_generated/api'\nimport { useMutation } from 'convex/react'"
  );
  content = content.replace(
    "  const createProject = useMutation(api.projects.create)",
    "  const createProject = useMutation(api.projects.create)\n  const updateProjectMetadata = useMutation(api.projects.updateProjectMetadata)"
  );
}

// Find the clone success block and insert the stack detection
content = content.replace(
  "        createdWorkspacePath = cloneResult.localPath\n        importPath = cloneResult.localPath\n        await updateMemberLocalPath({\n          projectId: result.projectId,\n          userId: convexUserId,\n          localPath: importPath,\n        })",
  `        createdWorkspacePath = cloneResult.localPath
        importPath = cloneResult.localPath
        await updateMemberLocalPath({
          projectId: result.projectId,
          userId: convexUserId,
          localPath: importPath,
        })
        
        // Stack Detection for Remote Repos
        try {
          setImportSyncMessage('Detecting framework...')
          const frameworkInfo = await detectFramework(importPath)
          
          let pageCount: number | undefined
          let componentCount: number | undefined
          
          try {
            if (frameworkInfo.routeConvention === 'file-based' && frameworkInfo.routePatterns.length > 0) {
              const pages = await window.electronAPI.fs.glob(importPath, frameworkInfo.routePatterns, {
                ignore: ['**/node_modules/**', '**/dist/**', '**/.next/**']
              })
              pageCount = pages.length
            }
            
            const components = await window.electronAPI.fs.glob(importPath, ['**/*.tsx', '**/*.jsx', '**/*.vue', '**/*.svelte'], {
              ignore: ['**/node_modules/**', '**/dist/**', '**/.next/**', ...(frameworkInfo.routePatterns || [])]
            })
            componentCount = components.length
          } catch (globError) {
            console.warn('[Import] Failed to count files during remote stack detection', globError)
          }

          const remoteDetectedStack = {
            framework: frameworkInfo.displayName,
            styling: 'Unknown',
            database: 'Unknown',
            testingFramework: 'Unknown',
            pageCount,
            componentCount
          }

          await updateProjectMetadata({
            projectId: result.projectId,
            repoSource: {
              ...repoSource,
              detectedStack: remoteDetectedStack,
            }
          })
          
          console.log('[Import] Remote stack detection completed', remoteDetectedStack)
        } catch (detectError) {
          console.warn('[Import] Failed to detect stack for cloned repository', detectError)
        }`
);

fs.writeFileSync('src/pages/NewProject.tsx', content);
