const fs = require('fs');

function replaceStr(file, oldStr, newStr) {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    content = content.replace(oldStr, newStr);
    fs.writeFileSync(file, content);
  }
}

replaceStr('src/features/editor/components/EditorTabs.tsx', 
  'searchParams?.entries ? searchParams.entries() : []', 
  'searchParams?.entries ? searchParams.entries() as any : []');
replaceStr('src/features/editor/components/EditorTabs.tsx', 
  'searchParams?.entries ? searchParams.entries() : []', 
  'searchParams?.entries ? searchParams.entries() as any : []');
replaceStr('src/features/projects/pages/ChangesPage.tsx', 
  'searchParams?.entries ? searchParams.entries() : []', 
  'searchParams?.entries ? searchParams.entries() as any : []');
replaceStr('src/features/projects/pages/ProjectPagesPage.tsx', 
  'searchParams?.entries ? searchParams.entries() : []', 
  'searchParams?.entries ? searchParams.entries() as any : []');

console.log('Final TS fix');
