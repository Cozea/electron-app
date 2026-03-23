const fs = require('fs');

let content = fs.readFileSync('src/pages/NewProject.tsx', 'utf8');

// I need to cleanly remove the stack detection code I injected because the Convex api.projects.update mutation 
// DOES NOT actually accept `repoSource` as an argument right now (it accepts name, description, etc, but not repoSource).
// I will revert the previous patch cleanly so we don't leave broken code behind.

const startMarker = "// Stack Detection for Remote Repos";
const endMarker = "console.warn('[Import] Failed to detect stack for cloned repository', detectError)\n        }";

if (content.includes(startMarker)) {
  const startIndex = content.indexOf(startMarker);
  const endIndex = content.indexOf(endMarker) + endMarker.length;
  
  const before = content.substring(0, startIndex);
  const after = content.substring(endIndex);
  
  fs.writeFileSync('src/pages/NewProject.tsx', before + after);
}
