const fs = require('fs');

function replaceRegex(file, regex, newStr) {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    content = content.replace(regex, newStr);
    fs.writeFileSync(file, content);
  }
}

// Fix 2 arguments to setSearchParams globally
const files = ['src/features/editor/components/EditorTabs.tsx', 'src/features/projects/pages/ChangesPage.tsx', 'src/features/projects/pages/ProjectPagesPage.tsx', 'src/components/layouts/DashboardLayout.tsx'];

for (const file of files) {
  if (!fs.existsSync(file)) continue;
  let content = fs.readFileSync(file, 'utf8');
  
  // DashboardLayout
  content = content.replace(/navigate\(\{ to: "\/projects" \}, \{ replace: true \}\)/g, 'navigate({ to: "/projects", replace: true })');
  content = content.replace(/navigate\(\{ to: "\/workspaces\/select" \}, \{ replace: true \}\)/g, 'navigate({ to: "/workspaces/select", replace: true })');

  // SearchParams
  content = content.replace(/setSearchParams\((newParams|new URLSearchParams\(searchParams as any\)),\s*\{[^}]*\}\)/g, 'setSearchParams($1 as any)');

  // Unused useSearch
  content = content.replace(/useSearch,? ?/g, '');

  fs.writeFileSync(file, content);
}
