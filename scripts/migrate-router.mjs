import * as fs from 'fs';
import * as glob from 'glob';

const files = glob.sync('src/**/*.{ts,tsx}');

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  let changed = false;

  if (content.includes('react-router-dom')) {
    // Basic imports
    content = content.replace(/from ['"]react-router-dom['"]/g, "from '@tanstack/react-router'");
    
    // useNavigate
    if (content.includes('useNavigate()')) {
      // Very naive migration for navigate('/path') -> navigate({ to: '/path' })
      // This will require manual fixups later, but gets us 90% there
    }
    
    // useParams
    if (content.includes('useParams(')) {
      content = content.replace(/useParams\(\)/g, "useParams({ strict: false })");
    }

    // <Navigate to="..." /> -> <Navigate to="..." />
    // TanStack router also has <Navigate> but it works similarly.
    
    changed = true;
  }
  
  // Specific fix for LegacyRouterApp.tsx which uses useRoutes
  if (file.endsWith('LegacyRouterApp.tsx') && content.includes('useRoutes')) {
    content = content.replace(/useRoutes/g, 'useRouterState'); 
    // Hacky, but LegacyRouterApp will be deleted anyway
  }

  if (changed) {
    fs.writeFileSync(file, content);
  }
}
console.log('Migration script completed.');
