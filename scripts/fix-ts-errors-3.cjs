const fs = require('fs');

function replaceRegex(file, regex, newStr) {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    content = content.replace(regex, newStr);
    fs.writeFileSync(file, content);
  }
}

// Fix 2 arguments to setSearchParams
replaceRegex('src/features/editor/components/EditorTabs.tsx', /setSearchParams\(([^,]+) as any,\s*\{[^}]*\}\)/g, 'setSearchParams($1)');
replaceRegex('src/features/projects/pages/ChangesPage.tsx', /setSearchParams\(([^,]+) as any,\s*\{[^}]*\}\)/g, 'setSearchParams($1)');
replaceRegex('src/features/projects/pages/ProjectPagesPage.tsx', /setSearchParams\(([^,]+) as any,\s*\{[^}]*\}\)/g, 'setSearchParams($1)');

// Fix DashboardLayout.tsx navigate second arg
replaceRegex('src/components/layouts/DashboardLayout.tsx', /navigate\(\{ to: "\/projects" \}, \{ replace: true \}\)/g, 'navigate({ to: "/projects", replace: true })');
replaceRegex('src/components/layouts/DashboardLayout.tsx', /navigate\(\{ to: "\/workspaces\/select" \}, \{ replace: true \}\)/g, 'navigate({ to: "/workspaces/select", replace: true })');

// Unused imports
replaceRegex('src/features/editor/components/EditorTabs.tsx', /useSearch, /g, '');
replaceRegex('src/features/projects/components/FileTree.tsx', /useSearch, /g, '');
replaceRegex('src/features/projects/pages/ChangesPage.tsx', /useSearch, /g, '');
replaceRegex('src/features/projects/pages/ProjectPagesPage.tsx', /useSearch, /g, '');

replaceRegex('src/router/routes.tsx', /Outlet,/g, '');
