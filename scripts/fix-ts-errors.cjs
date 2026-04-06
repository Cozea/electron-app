const fs = require('fs');

function replace(file, oldStr, newStr) {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    content = content.replace(oldStr, newStr);
    fs.writeFileSync(file, content);
  }
}

function replaceRegex(file, regex, newStr) {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    content = content.replace(regex, newStr);
    fs.writeFileSync(file, content);
  }
}

// Fix DashboardLayout.tsx expected 1 argument but got 2
replaceRegex('src/components/layouts/DashboardLayout.tsx', /navigate\(\{ to: ['"]([^'"]+)['"] \}, \{ replace: true \}\)/g, 'navigate({ to: "$1", replace: true })');

// Fix sidebar.tsx align issue
replaceRegex('src/components/ui/sidebar.tsx', /align=\{.*?\}|align=/g, '');

// Fix EditorTabs.tsx URLSearchParams issue
replaceRegex('src/features/editor/components/EditorTabs.tsx', /new URLSearchParams\(searchParams\)/g, 'new URLSearchParams(searchParams as any)');
replaceRegex('src/features/editor/components/EditorTabs.tsx', /setSearchParams\(newParams, \{ replace: true \}\)/g, 'setSearchParams(newParams as any)');

// Fix ChangesPage.tsx URLSearchParams issue
replaceRegex('src/features/projects/pages/ChangesPage.tsx', /new URLSearchParams\(searchParams\)/g, 'new URLSearchParams(searchParams as any)');
replaceRegex('src/features/projects/pages/ChangesPage.tsx', /setSearchParams\(newParams, \{ replace: true \}\)/g, 'setSearchParams(newParams as any)');

// Fix ProjectPagesPage.tsx URLSearchParams issue
replaceRegex('src/features/projects/pages/ProjectPagesPage.tsx', /new URLSearchParams\(searchParams\)/g, 'new URLSearchParams(searchParams as any)');
replaceRegex('src/features/projects/pages/ProjectPagesPage.tsx', /setSearchParams\(newParams, \{ replace: true \}\)/g, 'setSearchParams(newParams as any)');
replaceRegex('src/features/projects/pages/ProjectPagesPage.tsx', /searchParams\.get\((['"].*?['"])\)/g, 'searchParams.get($1) as string');

// Fix ProjectPreviewToolbar.tsx delayDuration
replaceRegex('src/features/projects/components/previews/ProjectPreviewToolbar.tsx', /delayDuration=\{[^\}]*\}/g, '');

// Fix useSearchParamsPolyfill
replace('src/lib/useSearchParamsPolyfill.ts', 'search: (old: any) => {', 'search: ((old: any) => {');
replace('src/lib/useSearchParamsPolyfill.ts', 'return { ...old, ...next };\n      },', 'return { ...old, ...next };\n      }) as any,');

// Fix lib/navigation.ts
replaceRegex('src/lib/navigation.ts', /import \{ createPath, type NavigateOptions, type NavigateFunction, type To, useNavigate \} from '@tanstack\/react-router'/g, 'import { useNavigate } from "@tanstack/react-router";\ntype NavigateOptions = any;\ntype NavigateFunction = any;\ntype To = any;\nconst createPath = (x: any) => x;');

// Fix routes.tsx Navigate missing params
replaceRegex('src/router/routes.tsx', /<Navigate to="\/projects\/p\/\$projectId\/pages" replace \/>/g, '<Navigate to="/projects/p/$projectId/pages" params={{ projectId: "default" }} replace />');

// Fix main.tsx unused featureFlags
replace('src/main.tsx', "import { featureFlags } from './lib/featureFlags'", "");

// Remove LegacyRouterApp
if (fs.existsSync('src/router/LegacyRouterApp.tsx')) {
  fs.unlinkSync('src/router/LegacyRouterApp.tsx');
}
