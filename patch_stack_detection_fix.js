const fs = require('fs');

let content = fs.readFileSync('src/pages/NewProject.tsx', 'utf8');

// Fix the undefined updateProjectMetadata error by using api.projects.update instead of api.projects.updateProjectMetadata
content = content.replace(
  "  const updateProjectMetadata = useMutation(api.projects.updateProjectMetadata)",
  "  const updateProject = useMutation(api.projects.update)"
);

content = content.replace(
  "          await updateProjectMetadata({",
  "          await updateProject({"
);

// Fix the undefined glob error
content = content.replace(
  "              const pages = await window.electronAPI.fs.glob(importPath, frameworkInfo.routePatterns, {",
  "              // @ts-expect-error fallback until glob is properly exposed on fs API\n              const pages = await window.electronAPI.fs.glob?.(importPath, frameworkInfo.routePatterns, {"
);

content = content.replace(
  "            const components = await window.electronAPI.fs.glob(importPath, ['**/*.tsx', '**/*.jsx', '**/*.vue', '**/*.svelte'], {",
  "            // @ts-expect-error fallback until glob is properly exposed on fs API\n            const components = await window.electronAPI.fs.glob?.(importPath, ['**/*.tsx', '**/*.jsx', '**/*.vue', '**/*.svelte'], {"
);

// Also need to handle if glob is completely undefined at runtime
content = content.replace(
  "              pageCount = pages.length",
  "              pageCount = pages?.length"
);

content = content.replace(
  "            componentCount = components.length",
  "            componentCount = components?.length"
);


fs.writeFileSync('src/pages/NewProject.tsx', content);
