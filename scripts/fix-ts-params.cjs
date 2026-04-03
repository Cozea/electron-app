const fs = require('fs');

function replaceStr(file, oldStr, newStr) {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    content = content.replace(oldStr, newStr);
    fs.writeFileSync(file, content);
  }
}

// 1. DashboardLayout.tsx
replaceStr('src/components/layouts/DashboardLayout.tsx', 
  'navigate(PERSONAL_ACCOUNT_ROUTE, { replace: true })', 
  'navigate({ to: PERSONAL_ACCOUNT_ROUTE, replace: true })');

// 2. EditorTabs.tsx
replaceStr('src/features/editor/components/EditorTabs.tsx', 
  'setSearchParams(nextParams, { replace: true })', 
  'setSearchParams(Object.fromEntries(nextParams.entries()) as any)');
replaceStr('src/features/editor/components/EditorTabs.tsx', 
  'setSearchParams(nextParams, { replace: true })', 
  'setSearchParams(Object.fromEntries(nextParams.entries()) as any)');
replaceStr('src/features/editor/components/EditorTabs.tsx', 
  'new URLSearchParams(searchParams as any)', 
  'new URLSearchParams(searchParams?.entries ? searchParams.entries() : [])');

// 3. ChangesPage.tsx
replaceStr('src/features/projects/pages/ChangesPage.tsx', 
  'setSearchParams(nextParams, { replace: true })', 
  'setSearchParams(Object.fromEntries(nextParams.entries()) as any)');
replaceStr('src/features/projects/pages/ChangesPage.tsx', 
  'new URLSearchParams(searchParams as any)', 
  'new URLSearchParams(searchParams?.entries ? searchParams.entries() : [])');

// 4. ProjectPagesPage.tsx
replaceStr('src/features/projects/pages/ProjectPagesPage.tsx', 
  'setSearchParams(nextParams, { replace: true })', 
  'setSearchParams(Object.fromEntries(nextParams.entries()) as any)');
replaceStr('src/features/projects/pages/ProjectPagesPage.tsx', 
  'new URLSearchParams(searchParams as any)', 
  'new URLSearchParams(searchParams?.entries ? searchParams.entries() : [])');

console.log('Fixed params calls');
