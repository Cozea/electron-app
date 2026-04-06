const fs = require('fs');
const glob = require('glob');

const files = glob.sync('src/**/*.{ts,tsx}');

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  let changed = false;

  if (content.includes('useParams()')) {
    content = content.replace(/useParams\(\)/g, "useParams({ strict: false })");
    changed = true;
  }

  if (content.includes('useSearchParams')) {
    content = content.replace(/useSearchParams/g, 'useSearch');
    content = content.replace(/useSearch\(\)/g, "useSearch({ strict: false })");
    changed = true;
  }

  // Add missing type for children/asChild where appropriate, 
  // or fix standard Tooltip content 
  if (file.includes('Tooltip.tsx') || file.includes('tooltip.tsx')) {
     // Already fixed
  }

  // Remove `LegacyRouterApp` in main.tsx
  if (file.endsWith('main.tsx')) {
     content = content.replace(/<BrowserRouter>[\s\S]*?<\/BrowserRouter>/g, '<RouterProvider router={appRouter} />');
     content = content.replace(/import \{ BrowserRouter, RouterProvider \} from '@tanstack\/react-router'/g, 'import { RouterProvider } from "@tanstack/react-router"');
     content = content.replace(/import \{ LegacyRouterApp \} from '\.\/router\/LegacyRouterApp'/g, '');
     content = content.replace(/\{featureFlags\.dataRouter \? \(\s*<RouterProvider router=\{appRouter\} \/>\s*\) : \(\s*<RouterProvider router=\{appRouter\} \/>\s*\)\}/g, '<RouterProvider router={appRouter} />');
     changed = true;
  }

  if (changed) {
    fs.writeFileSync(file, content);
  }
}
console.log('Fixes applied');
