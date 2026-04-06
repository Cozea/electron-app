const fs = require('fs');
const glob = require('glob');

function replaceRegex(file, regex, newStr) {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    content = content.replace(regex, newStr);
    fs.writeFileSync(file, content);
  }
}

// 1. Fix useParams arguments
const paramsFiles = glob.sync('src/**/*.tsx').concat(glob.sync('src/**/*.ts'));
for (const file of paramsFiles) {
  if (!fs.existsSync(file)) continue;
  let content = fs.readFileSync(file, 'utf8');
  let changed = false;

  if (content.includes('useParams({ strict: false }) as any')) {
    content = content.replace(/useParams\(\{ strict: false \}\) as any/g, 'useParams()');
    changed = true;
  }
  if (content.includes('useParams({ strict: false })')) {
    content = content.replace(/useParams\(\{ strict: false \}\)/g, 'useParams()');
    changed = true;
  }

  // Also fix useSearch
  if (content.includes('useSearch({ strict: false })')) {
    content = content.replace(/useSearch\(\{ strict: false \}\)/g, 'useSearch()');
    changed = true;
  }

  // Select onValueChange
  if (content.includes('onValueChange=')) {
    content = content.replace(/onValueChange=\{\(value\) => ([^}]*?)\}/g, 'onValueChange={(value) => $1}');
  }

  if (changed) {
    fs.writeFileSync(file, content);
  }
}

// 2. Fix DashboardLayout.tsx
replaceRegex('src/components/layouts/DashboardLayout.tsx', /navigate\(\{ to: ([^,]+), replace: true \}\)/g, 'navigate($1, { replace: true })');

// 3. Fix useSearchParamsPolyfill.ts
let polyfill = fs.readFileSync('src/lib/useSearchParamsPolyfill.ts', 'utf8');
polyfill = polyfill.replace(/navigate\(\{\s*search: \(\(old: any\) => \{[\s\S]*?\}\) as any,\s*replace: true\s*\}\);/g, 
  `navigate({ search: ((old: any) => {
        const next = typeof updater === 'function' ? updater(old) : updater;
        return { ...old, ...next };
      }) as any } as any, { replace: true });`);
fs.writeFileSync('src/lib/useSearchParamsPolyfill.ts', polyfill);

// 4. Fix src/lib/router.tsx Navigate component
let routerTsx = fs.readFileSync('src/lib/router.tsx', 'utf8');
routerTsx = routerTsx.replace(/<TanstackNavigate \{\.\.\.\(props as never\)\} \/>/g, '<TanstackNavigate {...(props as any)} />');
fs.writeFileSync('src/lib/router.tsx', routerTsx);

// 5. Fix UI Dialog
replaceRegex('src/components/ui/dialog.tsx', /children,\s*showCloseButton/g, 'children, showCloseButton');
let dialogTsx = fs.readFileSync('src/components/ui/dialog.tsx', 'utf8');
dialogTsx = dialogTsx.replace(/React\.ComponentProps<typeof BaseDialog\.Popup> & \{/g, 'Omit<React.ComponentProps<typeof BaseDialog.Popup>, "children"> & {\n  children?: React.ReactNode;');
fs.writeFileSync('src/components/ui/dialog.tsx', dialogTsx);

// 6. Fix Base UI Select passing unknown to string
replaceRegex('src/components/visual-editor/InlineInput.tsx', /onValueChange=\{\(newValue\) =>/g, 'onValueChange={(newValue: any) =>');
replaceRegex('src/features/projects/components/previews/IosSimulatorViewport.tsx', /onValueChange=\{\(deviceId\) =>/g, 'onValueChange={(deviceId: any) =>');
replaceRegex('src/pages/teams/Roles.tsx', /onValueChange=\{\(value\) => setMode/g, 'onValueChange={(value: any) => setMode');
replaceRegex('src/features/projects/pages/ProjectTeamPage.tsx', /onValueChange=\{\(value\) => setRole/g, 'onValueChange={(value: any) => setRole');
replaceRegex('src/components/context-switcher.tsx', /onValueChange=\{\(value\) => \{/g, 'onValueChange={(value: any) => {');
replaceRegex('src/components/git/ConnectedRepositoryPicker.tsx', /onValueChange=\{setRepositoryId\}/g, 'onValueChange={(val: any) => setRepositoryId(val)}');
replaceRegex('src/components/git/RepositoryProvisioner.tsx', /onValueChange=\{setCreateMethod\}/g, 'onValueChange={(val: any) => setCreateMethod(val)}');
replaceRegex('src/components/visual-editor/VisualEditorSidebar.tsx', /onValueChange=\{setCurrentState\}/g, 'onValueChange={(val: any) => setCurrentState(val)}');
replaceRegex('src/components/visual-editor/VisualEditorSidebar.tsx', /onValueChange=\{setHoveredState\}/g, 'onValueChange={(val: any) => setHoveredState(val)}');
replaceRegex('src/pages/teams/Roles.tsx', /onValueChange=\{setSelectedRoleId\}/g, 'onValueChange={(val: any) => setSelectedRoleId(val)}');
replaceRegex('src/pages/workspace/SourceControl.tsx', /onValueChange=\{setSelectedIntegrationId\}/g, 'onValueChange={(val: any) => setSelectedIntegrationId(val)}');

// 7. Fix ProjectPreviewRouteBar
let routeBar = fs.readFileSync('src/features/projects/components/previews/ProjectPreviewRouteBar.tsx', 'utf8');
routeBar = routeBar.replace(/<PopoverAnchor asChild>/g, '<PopoverAnchor>');
routeBar = routeBar.replace(/<\/PopoverAnchor>/g, '</PopoverAnchor>');
routeBar = routeBar.replace(/onOpenAutoFocus=\{\(event\) => event\.preventDefault\(\)\}/g, '');
fs.writeFileSync('src/features/projects/components/previews/ProjectPreviewRouteBar.tsx', routeBar);

console.log('Fixes applied');
