import fs from 'fs';
import glob from 'glob';

// We will overwrite routes.tsx completely.
const files = glob.sync('src/**/*.{ts,tsx}');

for (const file of files) {
  if (file.includes('tanstackRouter.tsx') || file.includes('migrate-router.mjs') || file.includes('routes.tsx')) continue;

  let content = fs.readFileSync(file, 'utf8');
  let changed = false;

  // React Router DOM imports to Tanstack React Router
  if (content.includes("from '@tanstack/react-router'")) {
    // If it was partially migrated, fix API differences

    // Fix useNavigate
    // Tanstack: const navigate = useNavigate({ from: '/current' }) or strict: false
    // Usage: navigate({ to: '/path' })
    if (content.includes('navigate(') && !content.includes('navigate({ to:')) {
      content = content.replace(/navigate\((['"`].*?['"`])\)/g, 'navigate({ to: $1 })');
      content = content.replace(/navigate\((['"`].*?['"`]),\s*\{.*replace:\s*true.*\}\)/g, 'navigate({ to: $1, replace: true })');
      changed = true;
    }

    // Fix <Link to="..."> to <Link to="...">
    // Tanstack Link expects structured URLs if strictly typed, but works similarly to string paths.

    // Fix useLocation
    if (content.includes('useLocation()')) {
      // TanStack useLocation returns { pathname, search, ... } directly.
      changed = true;
    }

    // Fix useSearchParams -> useSearch
    if (content.includes('useSearchParams')) {
      content = content.replace(/useSearchParams/g, 'useSearch');
      // Warning: API differs vastly!
      changed = true;
    }

  }

  if (changed) {
    fs.writeFileSync(file, content);
  }
}
console.log('Migration script step 2 completed.');
