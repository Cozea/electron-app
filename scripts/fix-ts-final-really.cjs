const fs = require('fs');

function replaceRegex(file, regex, newStr) {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    content = content.replace(regex, newStr);
    fs.writeFileSync(file, content);
  }
}

const files = [
  'src/features/editor/components/EditorTabs.tsx',
  'src/features/projects/pages/ChangesPage.tsx',
  'src/features/projects/pages/ProjectPagesPage.tsx'
];

for (const file of files) {
  replaceRegex(file, /import \{ ParamsPolyfill \} from '@\/lib\/ParamsPolyfill'/g, "import { useSearchParamsPolyfill } from '@/lib/useSearchParamsPolyfill'");
  replaceRegex(file, /ParamsPolyfill\(\)/g, "useSearchParamsPolyfill()");
}

// Fix DashboardLayout.tsx
// Expected 1 arguments, but got 2. Let's see what line 154 is doing.
let dash = fs.readFileSync('src/components/layouts/DashboardLayout.tsx', 'utf8');
dash = dash.replace(/navigate\(\{ to: "\/projects", replace: true \},\s*\{ replace: true \}\)/g, 'navigate({ to: "/projects", replace: true })');
dash = dash.replace(/navigate\(\{ to: "\/workspaces\/select", replace: true \},\s*\{ replace: true \}\)/g, 'navigate({ to: "/workspaces/select", replace: true })');
dash = dash.replace(/navigate\((['"`].*?['"`]),\s*\{.*replace:\s*true.*\}\)/g, 'navigate({ to: $1, replace: true })');
fs.writeFileSync('src/components/layouts/DashboardLayout.tsx', dash);
