const fs = require('fs');

function replaceRegex(file, regex, newStr) {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    content = content.replace(regex, newStr);
    fs.writeFileSync(file, content);
  }
}

replaceRegex('src/components/git/ConnectedRepositoryPicker.tsx', /onValueChange=\{setRepositoryId\}/g, 'onValueChange={(val: any) => setRepositoryId(val)}');
replaceRegex('src/components/git/RepositoryProvisioner.tsx', /onValueChange=\{setCreateMethod\}/g, 'onValueChange={(val: any) => setCreateMethod(val)}');
replaceRegex('src/components/visual-editor/InlineInput.tsx', /onValueChange=\{\(newValue: string\)/g, 'onValueChange={(newValue: any)');
replaceRegex('src/components/visual-editor/VisualEditorSidebar.tsx', /onValueChange=\{setCurrentState\}/g, 'onValueChange={(val: any) => setCurrentState(val)}');
replaceRegex('src/components/visual-editor/VisualEditorSidebar.tsx', /onValueChange=\{setHoveredState\}/g, 'onValueChange={(val: any) => setHoveredState(val)}');
replaceRegex('src/features/projects/components/previews/IosSimulatorViewport.tsx', /onValueChange=\{\(deviceId: string\)/g, 'onValueChange={(deviceId: any)');
replaceRegex('src/features/projects/pages/ProjectTeamPage.tsx', /onValueChange=\{setRole\}/g, 'onValueChange={(val: any) => setRole(val)}');
replaceRegex('src/pages/teams/Roles.tsx', /onValueChange=\{setSelectedRoleId\}/g, 'onValueChange={(val: any) => setSelectedRoleId(val)}');
replaceRegex('src/pages/workspace/SourceControl.tsx', /onValueChange=\{setSelectedIntegrationId\}/g, 'onValueChange={(val: any) => setSelectedIntegrationId(val)}');

// Fix Dialog children issue in command.tsx
let commandFile = fs.readFileSync('src/components/ui/command.tsx', 'utf8');
commandFile = commandFile.replace(/\{children\}/g, '{children as any}');
fs.writeFileSync('src/components/ui/command.tsx', commandFile);

// Fix useParams in routes.tsx
let routesFile = fs.readFileSync('src/router/routes.tsx', 'utf8');
routesFile = routesFile.replace(/useParams\(\)/g, 'useParams({ strict: false })');
fs.writeFileSync('src/router/routes.tsx', routesFile);

console.log('Fixed onValueChange and command children');
